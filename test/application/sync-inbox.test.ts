import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteAccountStore } from "../../src/adapters/sqlite/account-store.js";
import { openDatabase } from "../../src/adapters/sqlite/database.js";
import { SqliteMailStore } from "../../src/adapters/sqlite/mail-store.js";
import { SqliteProgressLog } from "../../src/adapters/sqlite/progress-log.js";
import { syncInbox, type SyncDependencies, type SyncOptions } from "../../src/application/sync-inbox.js";
import { MailReaderRateLimit, type MailReader } from "../../src/application/ports/mail-reader.js";
import type { Agenda, AgendaEvent, AgendaPage } from "../../src/application/ports/agenda.js";
import type { FetchedMail, Mailbox } from "../../src/application/ports/mailbox.js";
import { FakeClock } from "../fakes.js";

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

function setup(): { deps: SyncDependencies; mailbox: FakeMailbox; agenda: FakeAgenda; clock: FakeClock; close(): void } {
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
    clock,
    model: "gemini-3.5-flash-lite",
  };
  return { deps, mailbox, agenda, clock, close: () => db.close() };
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

  it("skips calendar notices and unrelated senders, and keeps a later thread reply", async () => {
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
      assert.equal(result.mail, 2);
      assert.equal(deps.progress.stageOf("171599833"), "in_conversation");
      assert.equal(deps.progress.listTransitions()[0]?.toStage, "in_conversation");
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
      assert.equal(deps.mail.unclassifiedWithoutReading().length, 1);
    } finally {
      close();
    }
  });

  it("uses a cited visit to offer a viewing and then schedule the matching event", async () => {
    const { deps, mailbox, agenda, close } = setup();
    deps.reader = {
      async propose() {
        return {
          address: null,
          contact: null,
          visit: { when: "12. November 2026", place: "Badstr. 54", citation: "Badstr. 54" },
        };
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
    } finally {
      close();
    }
  });
});
