import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteAccountStore } from "../../src/adapters/sqlite/account-store.js";
import { openDatabase } from "../../src/adapters/sqlite/database.js";
import { SqliteListingRepository } from "../../src/adapters/sqlite/listing-repository.js";
import { SqliteMailStore } from "../../src/adapters/sqlite/mail-store.js";
import { SqliteProgressLog } from "../../src/adapters/sqlite/progress-log.js";
import { syncHasNews, syncInbox, type SyncDependencies, type SyncOptions } from "../../src/application/sync-inbox.js";
import { MailReaderRateLimit, type MailInterpretation, type MailReader } from "../../src/application/ports/mail-reader.js";
import type { Alert } from "../../src/application/ports/notifier.js";
import type { Agenda, AgendaEvent, AgendaPage } from "../../src/application/ports/agenda.js";
import type { FetchedMail, Mailbox } from "../../src/application/ports/mailbox.js";
import type { MailResolver } from "../../src/application/ports/mail-resolver.js";
import { FakeClock, discoverListing } from "../fakes.js";

class FakeMailbox implements Mailbox {
  history = "h-new";
  expired = false;
  listed: FetchedMail[] = [];
  added: FetchedMail[] = [];
  readonly lists: Array<{ since: string; till: string | null }> = [];
  historyCalls = 0;

  async historyId(): Promise<string> {
    this.historyCalls += 1;
    return this.history;
  }

  async listSince(since: Date, till: Date | null): Promise<FetchedMail[]> {
    this.lists.push({ since: since.toISOString(), till: till ? till.toISOString() : null });
    return this.listed;
  }

  async addedSince(): Promise<{ mails: FetchedMail[]; latestId: string; expired: boolean }> {
    return { mails: this.added, latestId: "h-next", expired: this.expired };
  }
}

class FakeAgenda implements Agenda {
  expired = false;
  listed: AgendaEvent[] = [];
  changed: AgendaEvent[] = [];
  nextToken: string | null = "sync-1";
  listCalls = 0;

  async listSince(): Promise<AgendaPage> {
    this.listCalls += 1;
    return { events: this.listed, nextToken: this.nextToken, expired: false };
  }

  async changes(): Promise<AgendaPage> {
    if (this.expired) {
      return { events: [], nextToken: null, expired: true };
    }
    return { events: this.changed, nextToken: "sync-2", expired: false };
  }
}

function mail(patch: Partial<FetchedMail>): FetchedMail {
  return {
    id: "m1",
    threadId: "t1",
    from: "ImmoScout24 <myscout@immobilienscout24.de>",
    subject: "Anfrage versendet",
    sentAt: "2026-10-02T12:00:00.000Z",
    text: "Objekt 171599833\n13357 Berlin",
    html: "",
    replyTo: "",
    messageId: "",
    inReplyTo: "",
    references: "",
    calendarPart: false,
    ...patch,
  };
}

function options(patch?: Partial<SyncOptions>): SyncOptions {
  return {
    since: new Date("2026-10-01T00:00:00.000Z"),
    till: null,
    updateCursors: true,
    mailCap: -1,
    eventCap: -1,
    ...patch,
  };
}

function setup(): {
  deps: SyncDependencies;
  mailbox: FakeMailbox;
  agenda: FakeAgenda;
  clock: FakeClock;
  db: ReturnType<typeof openDatabase>;
  close(): void;
} {
  const db = openDatabase(":memory:");
  const clock = new FakeClock();
  const accounts = new SqliteAccountStore(db);
  accounts.saveLogin({
    email: "a@example.com",
    connectedAt: clock.now(),
  });
  const mailbox = new FakeMailbox();
  const agenda = new FakeAgenda();
  const deps: SyncDependencies = {
    accounts,
    mailbox,
    agenda,
    mail: new SqliteMailStore(db),
    progress: new SqliteProgressLog(db),
    reader: null,
    resolver: null,
    clock,
    model: "gemini-3.5-flash-lite",
    notifier: null,
  };
  return { deps, mailbox, agenda, clock, db, close: () => db.close() };
}

function openApplied(
  db: ReturnType<typeof openDatabase>,
  deps: SyncDependencies,
  scoutId: string,
  address: string,
  priceCold: number,
): void {
  const listing = discoverListing(scoutId)
    .withDetails({
      title: "Altbau",
      contactName: null,
      priceCold,
      rooms: 2,
      areaSqm: 50,
      address,
      isPlusOnly: false,
    })
    .startApplying()
    .markApplied(new Date("2026-10-15T10:00:00.000Z"));
  new SqliteListingRepository(db).save(listing);
  deps.progress.note({
    scoutId,
    next: "applied",
    source: "apply",
    evidenceId: scoutId,
    at: new Date("2026-10-15T10:00:00.000Z"),
  });
}

describe("sync inbox", () => {
  it("does not move cursors when import leaves them in place", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.listed = [mail({})];
      const result = await syncInbox(deps, options({ updateCursors: false, till: new Date("2026-10-07T00:00:00.000Z") }));
      assert.equal(result.mail, 1);
      assert.equal(deps.accounts.load()?.gmailHistoryId, null);
      assert.equal(deps.accounts.load()?.calendarSyncToken, null);
      assert.equal(mailbox.historyCalls, 0);
      assert.equal(deps.progress.stageOf("171599833"), "applied");
    } finally {
      close();
    }
  });

  it("does not advance a listing for a saved search", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.listed = [
        mail({
          id: "search",
          subject: "Neuer Suchauftrag wurde angelegt",
          text: "Link: https://www.immobilienscout24.de/expose/171641591",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(result.mail, 1);
      assert.equal(deps.progress.stageOf("171641591"), null);
    } finally {
      close();
    }
  });

  it("snapshots history on the first sync and falls back when history expires", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.listed = [mail({})];
      await syncInbox(deps, options());
      assert.equal(deps.accounts.load()?.gmailHistoryId, "h-new");
      assert.equal(mailbox.historyCalls, 1);

      mailbox.expired = true;
      mailbox.history = "h-after";
      mailbox.listed = [];
      await syncInbox(deps, options());
      assert.equal(mailbox.lists.at(-1)?.since, "2026-10-02T12:00:00.000Z");
      assert.equal(deps.accounts.load()?.gmailHistoryId, "h-after");
    } finally {
      close();
    }
  });

  it("refetches the calendar when the sync token expires", async () => {
    const { deps, agenda, close } = setup();
    try {
      agenda.nextToken = "sync-1";
      await syncInbox(deps, options());
      assert.equal(deps.accounts.load()?.calendarSyncToken, "sync-1");
      agenda.expired = true;
      agenda.listed = [
        {
          id: "e1",
          title: "Viewing",
          description: "https://www.immobilienscout24.de/expose/171599833",
          start: "2026-11-12T18:00:00+01:00",
          end: "2026-11-12T18:30:00+01:00",
          place: "Berlin",
        },
      ];
      agenda.nextToken = "sync-3";
      const result = await syncInbox(deps, options());
      assert.equal(agenda.listCalls, 2);
      assert.equal(result.events, 1);
      assert.equal(deps.progress.stageOf("171599833"), "scheduled");
      assert.equal(deps.accounts.load()?.calendarSyncToken, "sync-3");
    } finally {
      close();
    }
  });

  it("stores mail from other senders and keeps a later thread reply", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.listed = [
        mail({ id: "cal", subject: "Invitation: viewing", from: "calendar-notification@google.com", calendarPart: true }),
        mail({ id: "other", from: "landlord@example.com", threadId: "t-unknown", text: "hello" }),
        mail({ id: "notice", threadId: "t-keep" }),
        mail({
          id: "reply",
          threadId: "t-keep",
          from: "Landlord <landlord@example.com>",
          subject: "Re: Wohnung",
          text: "Can you visit?",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(result.mail, 3);
      assert.equal(deps.mail.listUnlinkedMail(20).some((item) => item.id === "other"), true);
      assert.equal(deps.progress.stageOf("171599833"), "in_conversation");
      assert.equal(deps.progress.listTransitions()[0]?.toStage, "in_conversation");
      assert.equal(syncHasNews(result), true);
      assert.equal(syncHasNews({ mail: 0, events: 0, proposals: 0, drafts: 0, waiting: 1, advanced: 0 }), false);
    } finally {
      close();
    }
  });

  it("stops on a rate limit without storing a reading", async () => {
    const { deps, mailbox, close } = setup();
    const reader: MailReader = {
      async propose() {
        throw new MailReaderRateLimit(1000);
      },
    };
    deps.reader = reader;
    try {
      mailbox.listed = [
        mail({
          id: "u1",
          from: "info@immobilienscout24.de",
          subject: "Hinweis",
          text: "Objekt 171599833 bitte prüfen",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(result.proposals, 0);
      assert.equal(result.waiting, 1);
      assert.equal(deps.mail.pendingWithoutReading().length, 1);
    } finally {
      close();
    }
  });

  it("uses a cited visit to offer a viewing and then schedule the matching event", async () => {
    const { deps, mailbox, agenda, close } = setup();
    deps.reader = {
      async propose() {
        throw new Error("rules cover this viewing");
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "u2",
          from: "info@immobilienscout24.de",
          subject: "Hinweis zum Termin",
          text: "Objekt 171599833\nBesichtigung Badstr. 54 am 12. November 2026",
        }),
      ];
      agenda.listed = [
        {
          id: "view-1",
          title: "Besichtigung",
          description: "",
          start: "2026-11-12T17:00:00.000Z",
          end: "2026-11-12T17:30:00.000Z",
          place: "Badstr. 54, Berlin",
        },
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(result.proposals, 1);
      assert.equal(deps.progress.stageOf("171599833"), "scheduled");
      assert.deepEqual(
        deps.progress.listTransitions().map((hop) => hop.toStage),
        ["scheduled"],
      );
      assert.equal(deps.mail.openTopic("171599833")?.topic, "viewing");
      assert.equal(deps.mail.openTopic("171599833")?.relation, "close");
    } finally {
      close();
    }
  });

  it("drafts landlord mail before an unclassified reading and keeps the same document topic", async () => {
    const { deps, mailbox, close } = setup();
    const seen: string[] = [];
    const alerts: Alert[] = [];
    deps.notifier = {
      async notify(alert) {
        alerts.push(alert);
      },
    };
    deps.reader = {
      async propose(subject): Promise<MailInterpretation> {
        seen.push(subject);
        return {
          proposal: { address: null, visit: null, contact: null },
          intent: "unknown",
          relation: "",
          evidence: "",
        };
      },
    };
    try {
      mailbox.listed = [
        mail({ id: "note", threadId: "td" }),
        mail({
          id: "docs",
          threadId: "td",
          from: "Scout <anbieter.x@nachrichten.immobilienscout24.de>",
          replyTo: "Reply <back@nachrichten.immobilienscout24.de>",
          subject: "Neue Nachricht",
          sentAt: "2026-10-03T12:00:00.000Z",
          text: "Bitte senden Sie die SCHUFA.",
        }),
        mail({
          id: "more",
          threadId: "td",
          from: "Scout <anbieter.x@nachrichten.immobilienscout24.de>",
          replyTo: "Reply <back@nachrichten.immobilienscout24.de>",
          subject: "Re: Neue Nachricht",
          sentAt: "2026-10-04T12:00:00.000Z",
          text: "Es fehlt noch die Schufa-Auskunft.",
        }),
        mail({
          id: "ask",
          threadId: "td",
          from: "Landlord <landlord@example.com>",
          subject: "Frage",
          sentAt: "2026-10-05T12:00:00.000Z",
          text: "Eine Frage ohne Stichwort",
        }),
        mail({
          id: "hint",
          threadId: "td",
          from: "info@immobilienscout24.de",
          subject: "Hinweis",
          sentAt: "2026-10-02T12:00:00.000Z",
          text: "Objekt 171599833 bitte nochmal schauen",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.deepEqual(seen, ["Frage", "Hinweis"]);
      assert.equal(result.drafts, 2);
      assert.equal(deps.progress.stageOf("171599833"), "in_conversation");
      assert.equal(deps.mail.openTopic("171599833")?.topic, "documents");
      assert.equal(deps.mail.openTopic("171599833")?.relation, "continue");
      assert.equal(alerts.length, 2);
      const first = alerts[0];
      assert.equal(first?.type, "MAIL_DRAFT");
      if (first?.type === "MAIL_DRAFT") {
        const compose = new URL(first.composeUrl);
        assert.equal(compose.searchParams.get("to"), "back@nachrichten.immobilienscout24.de");
        assert.equal(compose.searchParams.get("body")?.includes("Unterlagen"), true);
        assert.equal(first.messageUrl.includes("docs"), true);
      }
    } finally {
      close();
    }
  });

  it("uses a model visit when the rules do not recognise the mail", async () => {
    const { deps, mailbox, agenda, close } = setup();
    deps.reader = {
      async propose(): Promise<MailInterpretation> {
        return {
          proposal: {
            address: null,
            contact: null,
            visit: { when: "12. November 2026", place: "Badstr. 54", citation: "Badstr. 54" },
          },
          intent: "viewing_confirm",
          relation: "close",
          evidence: "Badstr. 54",
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "plain",
          from: "info@immobilienscout24.de",
          subject: "Hinweis",
          text: "Objekt 171599833\nTreffpunkt Badstr. 54 am 12. November 2026",
        }),
      ];
      agenda.listed = [
        {
          id: "view-2",
          title: "Besichtigung",
          description: "",
          start: "2026-11-12T17:00:00.000Z",
          end: "2026-11-12T17:30:00.000Z",
          place: "Badstr. 54, Berlin",
        },
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(result.proposals, 1);
      assert.equal(result.drafts, 1);
      assert.equal(deps.progress.stageOf("171599833"), "scheduled");
    } finally {
      close();
    }
  });

  it("links an Immomio mail by expose id and ignores an id that is only quoted", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.listed = [
        mail({
          id: "portal",
          threadId: "t-portal",
          from: "Booking <booking@immomio.de>",
          subject: "Termin",
          text: "Objekt 171599833\nIhr Termin steht.",
        }),
        mail({
          id: "quoted",
          threadId: "t-quoted",
          from: "Landlord <landlord@example.com>",
          subject: "Re: Wohnung",
          text: "Der Termin ist bestätigt.\n\nAm 1. November 2026 schrieb Vermieter:\nObjekt 171599834",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(result.mail, 2);
      assert.equal(deps.progress.stageOf("171599833"), "in_conversation");
      assert.equal(deps.progress.stageOf("171599834"), null);
      assert.equal(deps.mail.listUnlinkedMail(20).some((item) => item.id === "quoted"), true);
    } finally {
      close();
    }
  });

  it("links a later message from the same thread and a reply that cites a stored message id", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.listed = [
        mail({
          id: "child",
          threadId: "t-other",
          from: "Booking <booking@immomio.de>",
          subject: "Slot",
          messageId: "<child@immomio.de>",
          inReplyTo: "<notice@immobilienscout24.de>",
          text: "Bitte bestätigen Sie den Slot.",
        }),
        mail({
          id: "notice",
          threadId: "t-keep",
          messageId: "<notice@immobilienscout24.de>",
        }),
        mail({
          id: "follow",
          threadId: "t-keep",
          from: "Booking <booking@immomio.de>",
          subject: "Weiter",
          text: "Wir haben den Slot.",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      const card = deps.progress.listApartments("in_conversation").find((item) => item.scoutId === "171599833");
      assert.equal(card?.mails.length, 3);
    } finally {
      close();
    }
  });

  it("links one apartment by street and zip, and leaves two rents unlinked", async () => {
    const { deps, mailbox, db, close } = setup();
    try {
      openApplied(db, deps, "171599833", "Badstraße 54, 13357 Berlin", 800);
      openApplied(db, deps, "171599834", "Hauptstraße 2, 10115 Berlin", 800);
      mailbox.listed = [
        mail({
          id: "street",
          from: "Info <info@degewo.de>",
          threadId: "t-street",
          subject: "Besichtigung",
          text: "Bitte kommen Sie in die Badstraße 54, 13357 Berlin.",
        }),
        mail({
          id: "rent",
          from: "Info <info@degewo.de>",
          threadId: "t-rent",
          subject: "Miete",
          text: "Die Kaltmiete beträgt 800 €.",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(deps.progress.stageOf("171599833"), "in_conversation");
      assert.equal(deps.progress.stageOf("171599834"), "applied");
      assert.equal(deps.mail.listUnlinkedMail(20).some((item) => item.id === "rent"), true);
      const card = deps.progress.listApartments("in_conversation").find((item) => item.scoutId === "171599833");
      assert.match(card?.mails[0]?.cleanText ?? "", /Badstraße 54/);
    } finally {
      close();
    }
  });

  it("asks the model only for unresolved mail and stops after five picks", async () => {
    const { deps, mailbox, db, close } = setup();
    const seen: string[] = [];
    const resolver: MailResolver = {
      async resolve(input) {
        seen.push(input.subject);
        return input.subject === "Pick" ? "171599833" : null;
      },
    };
    deps.resolver = resolver;
    try {
      openApplied(db, deps, "171599833", "Badstraße 54, 13357 Berlin", 900);
      mailbox.listed = [
        mail({
          id: "pick",
          from: "a@gmail.com",
          threadId: "t-pick",
          subject: "Pick",
          sentAt: "2026-10-02T12:00:00.000Z",
          text: "Welche Wohnung meinen Sie?",
        }),
        ...["m1", "m2", "m3", "m4", "m5"].map((id, index) =>
          mail({
            id,
            from: "a@gmail.com",
            threadId: `t-${id}`,
            subject: id,
            sentAt: `2026-10-0${index + 3}T12:00:00.000Z`,
            text: "hello",
          }),
        ),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(seen.length, 5);
      assert.equal(deps.progress.stageOf("171599833"), "in_conversation");
      assert.equal(result.waiting >= 1, true);
    } finally {
      close();
    }
  });

  it("classifies the new sentence and not the quoted document request", async () => {
    const { deps, mailbox, close } = setup();
    const seen: string[] = [];
    deps.reader = {
      async propose(subject) {
        seen.push(subject);
        return { proposal: { address: null, visit: null, contact: null }, intent: "documents", relation: "start", evidence: "SCHUFA" };
      },
    };
    try {
      mailbox.listed = [
        mail({ id: "notice", threadId: "t-keep" }),
        mail({
          id: "thanks",
          threadId: "t-keep",
          from: "Landlord <landlord@example.com>",
          subject: "Re: Wohnung",
          text: "Vielen Dank für Ihre Anfrage.\n\nAm 1. November 2026 schrieb Vermieter:\nBitte senden Sie die SCHUFA.",
          html: "<div>Vielen Dank für Ihre Anfrage.</div><div class=\"gmail_quote\"><blockquote>Bitte senden Sie die SCHUFA.</blockquote></div>",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.deepEqual(seen, []);
      assert.equal(result.drafts, 0);
      assert.equal(result.proposals, 1);
    } finally {
      close();
    }
  });
});
