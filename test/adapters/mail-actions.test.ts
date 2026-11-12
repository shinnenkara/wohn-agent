import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../../src/adapters/sqlite/database.js";
import { SqliteMailStore } from "../../src/adapters/sqlite/mail-store.js";
import { materializeActions } from "../../src/application/materialize-actions.js";
import type { StoredMail } from "../../src/application/ports/mail-store.js";
import { ACTION_TEMPLATES } from "../../src/domain/mail-action.js";
import type { KeptIntent, IntentCode } from "../../src/domain/triage.js";

function intent(code: IntentCode): KeptIntent {
  return {
    code,
    confidence: 1,
    summary: code,
    metadata: {
      citation: code,
      actionDeepLink: "https://portal.example/book",
      linkCitation: "https://portal.example/book",
      requestedDocuments: [],
      proposedSlots: [{ text: "12. November 2026, 18:00 Uhr", citation: "12. November 2026, 18:00 Uhr" }],
    },
    dskViolation: false,
  };
}

function mail(id: string, scoutId: string): StoredMail {
  return {
    gmailId: id,
    threadId: "thread-1",
    from: "WBM <info@wbm.de>",
    replyTo: "info@wbm.de",
    messageId: "<m@example.com>",
    subject: "Besichtigung",
    sentAt: "2026-11-12T16:00:00.000Z",
    text: "Bitte buchen Sie https://portal.example/book",
    html: "",
    cleanText: "Bitte buchen Sie https://portal.example/book",
    inReplyTo: "",
    references: "<old@example.com>",
    linkMethod: "",
    kind: "landlord",
    scoutId,
  };
}

describe("action store", () => {
  it("seeds the same templates the domain uses", () => {
    const db = openDatabase(":memory:");
    try {
      const rows = db
        .prepare(
          `SELECT code, intent_code, title_template, sla_minutes, console_hotkey
           FROM action_templates ORDER BY code`,
        )
        .all() as Array<{
        code: string;
        intent_code: string;
        title_template: string;
        sla_minutes: number;
        console_hotkey: string;
      }>;
      const expected = [...ACTION_TEMPLATES]
        .map((template) => ({
          code: template.code,
          intent_code: template.intentCode,
          title_template: template.titleTemplate,
          sla_minutes: template.slaMinutes,
          console_hotkey: template.consoleHotkey,
        }))
        .sort((left, right) => left.code.localeCompare(right.code));
      assert.deepEqual(
        rows.map((row) => ({
          code: row.code,
          intent_code: row.intent_code,
          title_template: row.title_template,
          sla_minutes: row.sla_minutes,
          console_hotkey: row.console_hotkey,
        })),
        expected,
      );
    } finally {
      db.close();
    }
  });

  it("leaves an in-progress action open when an earlier task is superseded", () => {
    const db = openDatabase(":memory:");
    const store = new SqliteMailStore(db);
    const now = new Date("2026-11-12T16:00:00.000Z");
    try {
      store.insertMail(mail("proposal", "171599833"), now);
      store.insertMail(mail("confirm", "171599833"), now);
      assert.equal(
        store.insertAction({
          scoutId: "171599833",
          mailId: "proposal",
          intentCode: "APPT_PROPOSAL",
          actionCode: "ANSWER_PROPOSAL",
          status: "NOTIFIED",
          priority: "P0_CRITICAL",
          actionUrl: "https://mail.example/proposal",
          draftResponseText: "Gerne.",
          deadlineAt: "2026-11-12T16:30:00.000Z",
          createdAt: now,
        }),
        true,
      );
      assert.equal(
        store.insertAction({
          scoutId: "171599833",
          mailId: "proposal",
          intentCode: "APPT_PROPOSAL",
          actionCode: "ANSWER_PROPOSAL",
          status: "PENDING",
          priority: "P0_CRITICAL",
          actionUrl: "https://mail.example/proposal",
          draftResponseText: "Gerne.",
          deadlineAt: "2026-11-12T16:30:00.000Z",
          createdAt: now,
        }),
        false,
      );
      const open = store.listActions()[0];
      assert.ok(open);
      store.setActionStatus(open.id, "IN_PROGRESS");
      store.insertAction({
        scoutId: "171599833",
        mailId: "older",
        intentCode: "PORTAL_INVITE_LINK",
        actionCode: "OPEN_PORTAL",
        status: "PENDING",
        priority: "P0_CRITICAL",
        actionUrl: "https://portal.example/book",
        draftResponseText: "",
        deadlineAt: "2026-11-12T16:15:00.000Z",
        createdAt: now,
      });
      store.supersedeOpen("171599833", "confirm");
      const actions = store.listActions();
      assert.equal(actions.find((action) => action.mailId === "proposal")?.status, "IN_PROGRESS");
      assert.equal(actions.find((action) => action.mailId === "older")?.status, "SUPERSEDED");
      const shown = store.listOpenActions();
      assert.equal(shown.length, 1);
      assert.equal(shown[0]?.title, "Answer viewing proposal");
      assert.equal(shown[0]?.from.includes("wbm.de"), true);
    } finally {
      db.close();
    }
  });

  it("does not enqueue a quarantined apartment", () => {
    const db = openDatabase(":memory:");
    const store = new SqliteMailStore(db);
    const now = new Date("2026-11-12T16:00:00.000Z");
    try {
      store.insertMail(mail("portal", "171599833"), now);
      store.quarantineScout("171599833", now);
      materializeActions(store, {
        scoutId: "171599833",
        mailId: "portal",
        sentAt: "2026-11-12T16:00:00.000Z",
        accountEmail: "a@example.com",
        draftBody: "",
        decision: {
          intents: [intent("PORTAL_INVITE_LINK")],
          riskLevel: "SAFE",
          redFlags: [],
          priority: "P0_CRITICAL",
          notify: true,
          blocked: false,
          draft: null,
        },
        createdAt: now,
      });
      assert.equal(store.listActions().length, 0);
      assert.equal(store.isQuarantined(""), false);
    } finally {
      db.close();
    }
  });
});
