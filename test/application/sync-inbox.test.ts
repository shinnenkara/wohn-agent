import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteAccountStore } from "../../src/adapters/sqlite/account-store.js";
import { openDatabase } from "../../src/adapters/sqlite/database.js";
import { SqliteListingRepository } from "../../src/adapters/sqlite/listing-repository.js";
import { SqliteListingRepository } from "../../src/adapters/sqlite/listing-repository.js";
import { SqliteMailStore } from "../../src/adapters/sqlite/mail-store.js";
import { SqliteProgressLog } from "../../src/adapters/sqlite/progress-log.js";
import { syncHasNews, syncInbox, MAIL_READINGS_PER_RUN, type SyncDependencies, type SyncOptions } from "../../src/application/sync-inbox.js";
import { toQueueRow } from "../../src/domain/mail-action.js";
import { MailReaderRateLimit, type MailInterpretation, type MailReader } from "../../src/application/ports/mail-reader.js";
import type { ProposedTriage } from "../../src/domain/triage.js";
import type { Alert } from "../../src/application/ports/notifier.js";
import type { Agenda, AgendaEvent, AgendaPage } from "../../src/application/ports/agenda.js";
import type { FetchedMail, Mailbox, MailListOptions } from "../../src/application/ports/mailbox.js";
import type { MailResolver } from "../../src/application/ports/mail-resolver.js";
import { FakeClock, discoverListing } from "../fakes.js";

class FakeMailbox implements Mailbox {
  history = "h-new";
  expired = false;
  failList = false;
  listed: FetchedMail[] = [];
  added: FetchedMail[] = [];
  readonly lists: Array<{ since: string; till: string | null }> = [];
  historyCalls = 0;

  async historyId(): Promise<string> {
    this.historyCalls += 1;
    return this.history;
  }

  readonly skips: Array<ReadonlySet<string> | undefined> = [];

  async listSince(since: Date, till: Date | null, options?: MailListOptions): Promise<FetchedMail[]> {
    this.lists.push({ since: since.toISOString(), till: till ? till.toISOString() : null });
    this.skips.push(options?.skip);
    if (this.failList) {
      throw new Error("backfill stopped");
    }
    const mails = this.listed.filter((item) => !options?.skip?.has(item.id));
    if (options?.onBatch) {
      await options.onBatch(mails);
      return [];
    }
    return mails;
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
    listings: new SqliteListingRepository(db),
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
      assert.equal(alerts.length, 4);
      assert.equal(alerts.filter((alert) => alert.type === "MAIL_TRIAGE").length, 2);
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

  it("stores two cited intents and still drafts the document request", async () => {
    const { deps, mailbox, db, close } = setup();
    openApplied(db, deps, "171599833", "Badstraße 54, 13357 Berlin", 900);
    const alerts: Alert[] = [];
    deps.notifier = { async notify(alert) { alerts.push(alert); } };
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(): Promise<ProposedTriage> {
        return {
          intents: [
            {
              code: "PORTAL_INVITE_LINK",
              confidence: 1,
              summary: "Immomio invite",
              citation: "https://portal.immomio.de/invite/abc",
              deepLink: "https://portal.immomio.de/invite/abc",
              linkCitation: "https://portal.immomio.de/invite/abc",
              requestedDocuments: [],
              proposedSlots: [],
            },
            {
              code: "DOC_PACKAGE_REQ",
              confidence: 1,
              summary: "payslips",
              citation: "Gehaltsnachweise",
              deepLink: "",
              linkCitation: "",
              requestedDocuments: ["PAYSLIPS_3M"],
              proposedSlots: [],
            },
          ],
          redFlags: [],
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "bundle",
          from: "Verwaltung <haus@example.com>",
          subject: "Unterlagen",
          text: "Objekt 171599833\nBitte senden Sie drei Gehaltsnachweise.\nhttps://portal.immomio.de/invite/abc",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      const stored = deps.mail.loadTriage("bundle");
      assert.equal(result.drafts, 1);
      assert.equal(stored?.riskLevel, "SAFE");
      assert.deepEqual(stored?.codes, ["DOC_PACKAGE_REQ", "PORTAL_INVITE_LINK"]);
      assert.equal(alerts.some((alert) => alert.type === "MAIL_DRAFT"), true);
      assert.equal(alerts.some((alert) => alert.type === "MAIL_TRIAGE"), false);
      const card = deps.progress.listApartments("in_conversation").find((item) => item.scoutId === "171599833");
      const shown = card?.mails.find((item) => item.id === "bundle");
      assert.deepEqual(shown?.intents, ["DOC_PACKAGE_REQ", "PORTAL_INVITE_LINK"]);
      assert.equal(shown?.linkHost, "portal.immomio.de");
      assert.equal(shown?.linksAreText, false);
      assert.equal(shown?.documents.includes("PAYSLIPS_3M"), true);
    } finally {
      close();
    }
  });

  it("keeps the draft when a scam flag is not cited", async () => {
    const { deps, mailbox, db, close } = setup();
    openApplied(db, deps, "171599833", "Badstraße 54, 13357 Berlin", 900);
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(): Promise<ProposedTriage> {
        return {
          intents: [
            {
              code: "DOC_PACKAGE_REQ",
              confidence: 1,
              summary: "payslips",
              citation: "Gehaltsnachweise",
              deepLink: "",
              linkCitation: "",
              requestedDocuments: ["PAYSLIPS_3M"],
              proposedSlots: [{ text: "Montag 18 Uhr", citation: "not in the mail" }],
            },
          ],
          redFlags: [{ code: "UPFRONT_PAYMENT_OR_FEE", citation: "wire the deposit now" }],
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "soft",
          from: "Verwaltung <haus@example.com>",
          subject: "Unterlagen",
          text: "Objekt 171599833\nBitte senden Sie drei Gehaltsnachweise.",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(result.drafts, 1);
      assert.equal(deps.mail.loadTriage("soft")?.riskLevel, "SAFE");
      assert.deepEqual(deps.mail.loadTriage("soft")?.flags, []);
      assert.equal(deps.progress.stageOf("171599833"), "in_conversation");
    } finally {
      close();
    }
  });

  it("skips the draft and the viewing advance on a cited upfront fee", async () => {
    const { deps, mailbox, db, close } = setup();
    openApplied(db, deps, "171599833", "Badstraße 54, 13357 Berlin", 900);
    const alerts: Alert[] = [];
    deps.notifier = { async notify(alert) { alerts.push(alert); } };
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(): Promise<ProposedTriage> {
        return {
          intents: [
            {
              code: "APPT_CONFIRMATION",
              confidence: 1,
              summary: "viewing",
              citation: "Besichtigung Badstr. 54 am 12. November 2026",
              deepLink: "https://phish.example/pay",
              linkCitation: "https://phish.example/pay",
              requestedDocuments: [],
              proposedSlots: [{ text: "12. November 2026", citation: "12. November 2026" }],
            },
          ],
          redFlags: [{ code: "UPFRONT_PAYMENT_OR_FEE", citation: "500 €" }],
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "trap",
          from: "Agent <agent@example.com>",
          subject: "Besichtigung",
          text: "Objekt 171599833\nBitte überweisen Sie 500 € vorab.\nBesichtigung Badstr. 54 am 12. November 2026\nhttps://phish.example/pay",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(result.drafts, 0);
      assert.equal(result.proposals, 1);
      assert.equal(deps.progress.stageOf("171599833"), "in_conversation");
      assert.equal(deps.mail.loadTriage("trap")?.riskLevel, "CRITICAL_SCAM_BLOCK");
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0]?.type, "MAIL_TRIAGE");
      const card = deps.progress.listApartments("in_conversation").find((item) => item.scoutId === "171599833");
      const shown = card?.mails.find((item) => item.id === "trap");
      assert.equal(shown?.linksAreText, true);
      assert.equal(shown?.draft, "");
    } finally {
      close();
    }
  });

  it("queues a portal invite and skips a receipt", async () => {
    const { deps, mailbox, close } = setup();
    const alerts: Alert[] = [];
    deps.notifier = { async notify(alert) { alerts.push(alert); } };
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(): Promise<ProposedTriage> {
        return {
          intents: [
            {
              code: "PORTAL_INVITE_LINK",
              confidence: 1,
              summary: "Immomio invite",
              citation: "https://portal.immomio.de/invite/abc",
              deepLink: "https://portal.immomio.de/invite/abc",
              linkCitation: "https://portal.immomio.de/invite/abc",
              requestedDocuments: [],
              proposedSlots: [],
            },
          ],
          redFlags: [],
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "ack",
          from: "Haus <haus@example.com>",
          subject: "Eingang",
          sentAt: "2026-10-02T11:00:00.000Z",
          text: "Wir haben Ihre Anfrage erhalten.",
        }),
        mail({
          id: "portal",
          from: "Portal <haus@example.com>",
          subject: "Termin",
          sentAt: "2026-10-02T12:00:00.000Z",
          text: "Bitte buchen Sie https://portal.immomio.de/invite/abc",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      const actions = deps.mail.listActions();
      assert.equal(actions.length, 1);
      assert.equal(actions[0]?.actionCode, "OPEN_PORTAL");
      assert.equal(actions[0]?.mailId, "portal");
      assert.equal(actions[0]?.status, "NOTIFIED");
      assert.equal(actions[0]?.actionUrl, "https://portal.immomio.de/invite/abc");
      assert.equal(actions[0]?.deadlineAt, "2026-10-02T12:15:00.000Z");
      const triage = alerts.find((alert) => alert.type === "MAIL_TRIAGE");
      assert.equal(triage?.type === "MAIL_TRIAGE" ? triage.actionUrl : "", "https://portal.immomio.de/invite/abc");
    } finally {
      close();
    }
  });

  it("leaves the portal pending when the alert fails", async () => {
    const { deps, mailbox, close } = setup();
    deps.notifier = {
      async notify() {
        throw new Error("down");
      },
    };
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(): Promise<ProposedTriage> {
        return {
          intents: [
            {
              code: "PORTAL_INVITE_LINK",
              confidence: 1,
              summary: "Immomio invite",
              citation: "https://portal.immomio.de/invite/abc",
              deepLink: "https://portal.immomio.de/invite/abc",
              linkCitation: "https://portal.immomio.de/invite/abc",
              requestedDocuments: [],
              proposedSlots: [],
            },
          ],
          redFlags: [],
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "portal",
          from: "Portal <haus@example.com>",
          subject: "Termin",
          text: "Bitte buchen Sie https://portal.immomio.de/invite/abc",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(deps.mail.listActions()[0]?.status, "PENDING");
    } finally {
      close();
    }
  });

  it("supersedes a proposal when the appointment is confirmed and then rejected", async () => {
    const { deps, mailbox, db, close } = setup();
    openApplied(db, deps, "171599833", "Badstraße 54, 13357 Berlin", 900);
    deps.notifier = { async notify() { return undefined; } };
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(input): Promise<ProposedTriage> {
        const code = input.subject === "Bestätigt" ? "APPT_CONFIRMATION" : "APPT_PROPOSAL";
        return {
          intents: [
            {
              code,
              confidence: 1,
              summary: code,
              citation: "12. November 2026, 18:00 Uhr",
              deepLink: "",
              linkCitation: "",
              requestedDocuments: [],
              proposedSlots: [{ text: "12. November 2026, 18:00 Uhr", citation: "12. November 2026, 18:00 Uhr" }],
            },
          ],
          redFlags: [],
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "proposal",
          from: "Haus <haus@example.com>",
          subject: "Terminvorschlag",
          sentAt: "2026-11-12T10:00:00.000Z",
          text: "Objekt 171599833\nKönnen Sie am 12. November 2026, 18:00 Uhr zur Besichtigung kommen?",
        }),
        mail({
          id: "confirm",
          from: "Haus <haus@example.com>",
          subject: "Bestätigt",
          sentAt: "2026-11-12T11:00:00.000Z",
          text: "Objekt 171599833\nWir bestätigen die Besichtigung am 12. November 2026, 18:00 Uhr.",
        }),
        mail({
          id: "reject",
          from: "Haus <haus@example.com>",
          subject: "Absage",
          sentAt: "2026-11-12T12:00:00.000Z",
          text: "Objekt 171599833\nDie Wohnung ist leider bereits vergeben.",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      const actions = deps.mail.listActions();
      assert.deepEqual(
        actions.map((action) => [action.mailId, action.actionCode, action.status]),
        [
          ["proposal", "ANSWER_PROPOSAL", "SUPERSEDED"],
          ["confirm", "CONFIRM_APPT", "SUPERSEDED"],
        ],
      );
      assert.equal(actions.some((action) => action.mailId === "reject"), false);
    } finally {
      close();
    }
  });

  it("reads ImmoScout mail before older newsletters and stops before a sixth newsletter", async () => {
    const { deps, mailbox, close } = setup();
    const seen: string[] = [];
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(input): Promise<ProposedTriage> {
        seen.push(input.subject);
        return { intents: [], redFlags: [], relevance: "unrelated" };
      },
    };
    try {
      const news = ["n1", "n2", "n3", "n4", "n5"].map((id, index) =>
        mail({
          id,
          from: "Healthy Gamer <hello@healthygamer.gg>",
          threadId: `t-${id}`,
          subject: `Newsletter ${id}`,
          sentAt: `2026-10-0${index + 1}T12:00:00.000Z`,
          text: "Keep giving up on your goals?",
        }),
      );
      mailbox.listed = [
        ...news,
        mail({
          id: "bounce",
          from: "noreply@immobilienscout24.de",
          threadId: "t-bounce",
          subject: "Ihre Nachricht konnte nicht zugestellt werden",
          sentAt: "2026-10-12T16:18:54.000Z",
          text: "Die Nachricht konnte nicht zugestellt werden.",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(seen[0], "Ihre Nachricht konnte nicht zugestellt werden");
      assert.equal(seen.includes("Newsletter n5"), false);
      assert.equal(seen.length, 5);
      const hidden = deps.mail.listUnlinkedMail(20);
      assert.equal(hidden.some((item) => item.id === "bounce"), false);
      const shown = deps.mail.listUnlinkedMail(20, true);
      assert.equal(shown.find((item) => item.id === "bounce")?.relevance, "unrelated");
      assert.equal(shown.find((item) => item.id === "n5")?.read, false);
    } finally {
      close();
    }
  });

  it("does not draft a reply to the connected account", async () => {
    const { deps, mailbox, close } = setup();
    let outbound = false;
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(input): Promise<ProposedTriage> {
        outbound = input.outbound;
        return {
          intents: [
            {
              code: "REJECTION",
              confidence: 0.8,
              summary: "cancellation",
              citation: "Absage",
              deepLink: "",
              linkCitation: "",
              requestedDocuments: [],
              proposedSlots: [],
            },
          ],
          redFlags: [],
          relevance: "unrelated",
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "mine",
          from: "Oleksii Kharchenko <a@example.com>",
          threadId: "t-mine",
          subject: "Absage des Besichtigungstermins",
          text: "Ich sage den Termin ab.",
        }),
      ];
      const result = await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(outbound, true);
      assert.equal(result.drafts, 0);
      assert.equal(deps.mail.listActions().length, 0);
      const row = deps.mail.listUnlinkedMail(20).find((item) => item.id === "mine");
      assert.equal(row?.relevance, "possible");
      assert.equal(row?.judgments[0]?.code, "REJECTION");
      assert.equal(row?.judgments[0]?.confidence, 0.8);
    } finally {
      close();
    }
  });

  it("stores the raw triage and the confirmed decision on the listing", async () => {
    const { deps, mailbox, db, close } = setup();
    openApplied(db, deps, "171599833", "Badstraße 54, 13357 Berlin", 900);
    deps.reader = {
      async propose() {
        throw new Error("triage replaces the single intent reading");
      },
      async triage(): Promise<ProposedTriage> {
        return {
          intents: [
            {
              code: "DOC_PACKAGE_REQ",
              confidence: 1,
              summary: "payslips",
              citation: "Gehaltsnachweise",
              deepLink: "",
              linkCitation: "",
              requestedDocuments: ["PAYSLIPS_3M"],
              proposedSlots: [],
            },
          ],
          redFlags: [],
        };
      },
    };
    try {
      mailbox.listed = [
        mail({
          id: "bundle",
          from: "Verwaltung <haus@example.com>",
          subject: "Unterlagen",
          text: "Objekt 171599833\nBitte senden Sie drei Gehaltsnachweise.",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      const stored = deps.mail.judgmentsForMail("bundle");
      assert.equal(stored.length, 1);
      const row = stored[0];
      assert.equal(row?.scoutId, "171599833");
      assert.equal(row?.source, "mail_triage");
      assert.equal(row?.branch, "model");
      assert.equal(row?.model, "gemini-3.5-flash-lite");
      assert.equal(row?.stage, "in_conversation");
      assert.equal(row?.error, "");
      const proposal = JSON.parse(row?.proposalJson ?? "") as { intents: Array<{ code: string }> };
      assert.equal(proposal.intents[0]?.code, "DOC_PACKAGE_REQ");
      const decision = JSON.parse(row?.decisionJson ?? "") as {
        riskLevel: string;
        intents: Array<{ code: string; citation: string; requestedDocuments: string[] }>;
      };
      assert.equal(decision.riskLevel, "SAFE");
      assert.equal(decision.intents[0]?.code, "DOC_PACKAGE_REQ");
      assert.equal(decision.intents[0]?.citation, "Gehaltsnachweise");
      const card = deps.progress.listApartments("in_conversation").find((item) => item.scoutId === "171599833");
      const shown = card?.mails.find((item) => item.id === "bundle");
      assert.equal(shown?.judgmentBranch, "model");
      assert.equal(shown?.judgmentCitation, "Gehaltsnachweise");
      const action = deps.mail.listOpenActions().find((item) => item.mailId === "bundle");
      assert.ok(action);
      assert.equal(toQueueRow(action, [], deps.clock.now()).reason, "model · Gehaltsnachweise");
    } finally {
      close();
    }
  });

  it("stores a rules fallback with an empty model once the read cap is spent", async () => {
    const { deps, mailbox, close } = setup();
    let reads = 0;
    deps.reader = {
      async propose() {
        throw new Error("triage is used first");
      },
      async triage(): Promise<ProposedTriage> {
        reads += 1;
        return { intents: [], redFlags: [] };
      },
    };
    try {
      const fillers = Array.from({ length: MAIL_READINGS_PER_RUN }, (_, index) =>
        mail({
          id: `fill-${index}`,
          threadId: `t-fill-${index}`,
          from: "Landlord <haus@example.com>",
          subject: "Hinweis",
          sentAt: `2026-10-02T12:0${index}:00.000Z`,
          text: "Guten Tag.",
        }),
      );
      mailbox.listed = [
        ...fillers,
        mail({
          id: "view",
          threadId: "t-view",
          from: "Landlord <haus@example.com>",
          subject: "Termin",
          sentAt: "2026-10-02T12:06:00.000Z",
          text: "Die Besichtigung ist möglich. https://portal.example/slot",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      assert.equal(reads, MAIL_READINGS_PER_RUN);
      const stored = deps.mail.judgmentsForMail("view");
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.source, "rules");
      assert.equal(stored[0]?.branch, "rules_fallback");
      assert.equal(stored[0]?.model, "");
      const decision = JSON.parse(stored[0]?.decisionJson ?? "") as { intents: Array<{ code: string }> };
      assert.equal(decision.intents.some((intent) => intent.code === "APPT_PROPOSAL"), true);
    } finally {
      close();
    }
  });

  it("copies the listing id onto judgments when an unlinked mail is linked", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.listed = [
        mail({
          id: "ack",
          threadId: "t-ack",
          from: "Landlord <haus@example.com>",
          subject: "Eingang",
          text: "Wir haben Ihre Anfrage erhalten.",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      const before = deps.mail.judgmentsForMail("ack");
      assert.equal(before.length, 1);
      assert.equal(before[0]?.scoutId, "");
      assert.equal(before[0]?.branch, "rules");
      assert.equal(deps.mail.linkMessage("ack", "171599833", "manual"), true);
      assert.equal(deps.mail.judgmentsForMail("ack")[0]?.scoutId, "171599833");
    } finally {
      close();
    }
  });

  it("records a send confirmation as an applied listing and not a scam", async () => {
    const { deps, mailbox, close } = setup();
    const kept = discoverListing("111111111").filterOut("too small");
    deps.listings.save(kept);
    const open = discoverListing("222222222");
    deps.listings.save(open);
    try {
      mailbox.listed = [
        mail({
          id: "sent",
          from: "ImmoScout24 <noreply@immobilienscout24.de>",
          subject: "Ihre persönliche Vorstellung beim Anbieter",
          text: [
            "Ihre Kontaktaufnahme wurde erfolgreich verschickt.",
            "https://www.immobilienscout24.de/expose/65352507",
            "Heesenstr. XX,",
            "40549 Düsseldorf",
            "Über eine virtuelle Besichtigung würde ich mich freuen.",
            "Ein Wohnberechtigungsschein (WBS) liegt vor.",
            "SCHUFA-BonitätsCheck anfordern",
          ].join("\n"),
        }),
        mail({
          id: "kept",
          from: "ImmoScout24 <noreply@immobilienscout24.de>",
          subject: "Ihre persönliche Vorstellung beim Anbieter",
          text: "Ihre Kontaktaufnahme wurde erfolgreich verschickt.\nhttps://www.immobilienscout24.de/expose/111111111",
        }),
        mail({
          id: "open",
          from: "ImmoScout24 <noreply@immobilienscout24.de>",
          subject: "Ihre persönliche Vorstellung beim Anbieter",
          text: "Ihre Kontaktaufnahme wurde erfolgreich verschickt.\nhttps://www.immobilienscout24.de/expose/222222222",
        }),
      ];
      await syncInbox(deps, options({ updateCursors: false }));
      const created = deps.listings.findById("65352507");
      assert.equal(created?.status, "APPLIED");
      assert.equal(created?.address, "Heesenstr. XX, 40549 Düsseldorf");
      assert.equal(deps.listings.findById("111111111")?.status, "FILTERED_OUT");
      assert.equal(deps.listings.findById("222222222")?.status, "APPLIED");
      assert.equal(deps.progress.stageOf("65352507"), "applied");
      assert.equal(deps.mail.judgmentsForMail("sent").length, 0);
      assert.equal(deps.mail.listOpenActions().some((row) => row.mailId === "sent"), false);
    } finally {
      close();
    }
  });

  it("stores a backfill batch before the next one and skips ids already stored", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.listed = [mail({ id: "old" }), mail({ id: "new" })];
      const first = await syncInbox(deps, options());
      assert.equal(first.mail, 2);
      assert.equal(deps.accounts.load()?.gmailHistoryId, "h-new");
      mailbox.expired = true;
      mailbox.listed = [mail({ id: "old" }), mail({ id: "new" }), mail({ id: "later", threadId: "t-later" })];
      const second = await syncInbox(deps, options());
      assert.equal(second.mail, 1);
      assert.equal(mailbox.skips.at(-1)?.has("old"), true);
      assert.equal(mailbox.skips.at(-1)?.has("new"), true);
      assert.equal(deps.accounts.load()?.gmailHistoryId, "h-new");
    } finally {
      close();
    }
  });

  it("does not save a history cursor when the backfill stops", async () => {
    const { deps, mailbox, close } = setup();
    try {
      mailbox.failList = true;
      mailbox.listed = [mail({})];
      await assert.rejects(() => syncInbox(deps, options()), /backfill stopped/);
      assert.equal(deps.accounts.load()?.gmailHistoryId, null);
      assert.equal(deps.mail.storedGmailIds().size, 0);
    } finally {
      close();
    }
  });
});
