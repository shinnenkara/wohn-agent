import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gmailDraftUrl, gmailInboxUrl } from "../../src/domain/gmail-url.js";
import { commandsFrom, effectFor, renderConsole, shouldBell } from "../../src/domain/console-screen.js";
import {
  planActions,
  queueBadges,
  sortQueue,
  templateFor,
  toQueueRow,
  type QueueRow,
} from "../../src/domain/mail-action.js";
import { citedSlotStart } from "../../src/domain/mail-reply.js";
import type { KeptIntent, IntentCode } from "../../src/domain/triage.js";

function intent(code: IntentCode, link = ""): KeptIntent {
  return {
    code,
    confidence: 1,
    summary: code,
    metadata: {
      citation: code,
      actionDeepLink: link || null,
      linkCitation: link || null,
      requestedDocuments: [],
      proposedSlots: [],
    },
    dskViolation: false,
  };
}

function row(patch: Partial<QueueRow> & Pick<QueueRow, "id" | "priority" | "deadlineAt">): QueueRow {
  return {
    scoutId: "171599833",
    title: "Open booking link",
    label: "Badstraße 54",
    status: "PENDING",
    badges: [],
    actionUrl: "https://portal.example/book",
    draftResponseText: "Gerne.",
    ...patch,
  };
}

describe("mail actions", () => {
  it("maps actionable intents and skips silent ones", () => {
    assert.equal(templateFor("PORTAL_INVITE_LINK")?.code, "OPEN_PORTAL");
    assert.equal(templateFor("APPT_PROPOSAL")?.slaMinutes, 30);
    assert.equal(templateFor("IS24_AUTO_ACK"), null);
    assert.equal(templateFor("LANDLORD_WAIT_ACK"), null);
    assert.equal(templateFor("REJECTION"), null);
  });

  it("supersedes earlier work for a confirmation and adds nothing for a rejection", () => {
    const confirmation = planActions({
      scoutId: "171599833",
      mailId: "confirm",
      sentAt: "2026-11-12T16:00:00.000Z",
      accountEmail: "a@example.com",
      draftBody: "Ich bestätige.",
      blocked: false,
      intents: [intent("APPT_CONFIRMATION")],
    });
    assert.equal(confirmation.supersede, true);
    assert.equal(confirmation.actions[0]?.actionCode, "CONFIRM_APPT");
    assert.equal(confirmation.actions[0]?.deadlineAt, "2026-11-12T17:00:00.000Z");
    assert.equal(confirmation.actions[0]?.actionUrl, gmailInboxUrl("confirm", "a@example.com"));

    const rejection = planActions({
      scoutId: "171599833",
      mailId: "no",
      sentAt: "2026-11-12T18:00:00.000Z",
      accountEmail: null,
      draftBody: "",
      blocked: false,
      intents: [intent("REJECTION")],
    });
    assert.equal(rejection.supersede, true);
    assert.deepEqual(rejection.actions, []);

    const blocked = planActions({
      scoutId: "171599833",
      mailId: "trap",
      sentAt: "2026-11-12T18:00:00.000Z",
      accountEmail: null,
      draftBody: "",
      blocked: true,
      intents: [intent("APPT_CONFIRMATION", "https://phish.example/pay"), intent("SCAM_SUSPECTED")],
    });
    assert.equal(blocked.supersede, false);
    assert.deepEqual(
      blocked.actions.map((action) => action.actionCode),
      ["REVIEW_SCAM"],
    );
    assert.equal(blocked.actions[0]?.actionUrl.includes("phish.example"), false);
  });

  it("keeps a portal link and sorts by priority then deadline", () => {
    const planned = planActions({
      scoutId: "",
      mailId: "portal",
      sentAt: "2026-10-02T12:00:00.000Z",
      accountEmail: "a@example.com",
      draftBody: "",
      blocked: false,
      intents: [intent("PORTAL_INVITE_LINK", "https://portal.immomio.de/invite/abc")],
    });
    assert.equal(planned.supersede, false);
    assert.equal(planned.actions[0]?.actionUrl, "https://portal.immomio.de/invite/abc");
    assert.equal(planned.actions[0]?.priority, "P0_CRITICAL");
    assert.equal(planned.actions[0]?.deadlineAt, "2026-10-02T12:15:00.000Z");
    assert.deepEqual(
      sortQueue([
        { id: 2, priority: "P1_HIGH", deadlineAt: "2026-01-01T00:00:00.000Z" },
        { id: 1, priority: "P0_CRITICAL", deadlineAt: "2026-01-02T00:00:00.000Z" },
        { id: 3, priority: "P0_CRITICAL", deadlineAt: "2026-01-01T00:00:00.000Z" },
      ]).map((item) => item.id),
      [3, 1, 2],
    );
  });

  it("badges WBM landlords and overlapping slots", () => {
    assert.equal(queueBadges({ from: "WBM <info@wbm.de>", subject: "", body: "" }, [], new Date()).includes("WBM"), true);
    assert.equal(
      queueBadges(
        { from: "Hausverwaltung", subject: "", body: "Die Wohnungsbaugesellschaft Berlin-Mitte schreibt." },
        [],
        new Date(),
      ).includes("WBM"),
      true,
    );
    assert.equal(queueBadges({ from: "Ada", subject: "Schwabing", body: "bwbm" }, [], new Date()).length, 0);

    const now = new Date("2026-11-01T10:00:00.000Z");
    const start = citedSlotStart("12. November 2026, 18:00 Uhr", now);
    assert.ok(start);
    const busy = [
      {
        start: new Date(start.getTime() - 30 * 60_000).toISOString(),
        end: new Date(start.getTime() + 30 * 60_000).toISOString(),
      },
    ];
    const badges = queueBadges(
      { from: "Ada", subject: "", body: "", slotText: "12. November 2026, 18:00 Uhr" },
      busy,
      now,
    );
    assert.deepEqual(badges, ["CONFLICT"]);
    assert.equal(queueBadges({ from: "Ada", subject: "", body: "", slotText: "nächste Woche" }, busy, now).length, 0);
    assert.equal(gmailDraftUrl("msg-9", "a@example.com").includes("#drafts?compose=msg-9"), true);
  });

  it("renders the selected row and maps keys to a status", () => {
    const now = new Date("2026-11-12T16:00:00.000Z");
    const open = row({
      id: 7,
      priority: "P0_CRITICAL",
      deadlineAt: "2026-11-12T16:14:00.000Z",
      badges: ["WBM", "CONFLICT"],
    });
    const screen = renderConsole({ rows: [open], selected: 0, now, notice: "" });
    assert.equal(screen.includes("> 14m"), true);
    assert.equal(screen.includes("P0"), true);
    assert.equal(screen.includes("WBM CONFLICT"), true);
    assert.equal(screen.includes("o open"), true);
    assert.equal(renderConsole({ rows: [], selected: 0, now, notice: "" }).includes("No open actions."), true);

    assert.deepEqual(commandsFrom("\x1b[A\x1b[Bq"), ["up", "down", "q"]);
    assert.equal(effectFor("c", [open], 0).effect.kind, "complete");
    assert.deepEqual(effectFor("o", [open], 0).effect, { kind: "open", id: 7, url: open.actionUrl });
    assert.equal(effectFor("s", [open], 0).effect.kind, "quarantine");
    assert.equal(effectFor("d", [open], 0).effect.kind, "draft");
    assert.equal(effectFor("d", [{ ...open, draftResponseText: "" }], 0).effect.kind, "note");
    assert.equal(effectFor("q", [open], 0).effect.kind, "quit");
    assert.equal(effectFor("down", [open, { ...open, id: 8 }], 0).selected, 1);
    assert.equal(shouldBell(false, new Set(), [open]), false);
    assert.equal(shouldBell(true, new Set(), [open]), true);
    assert.equal(shouldBell(true, new Set([7]), [open]), false);
    const shown = toQueueRow(
      {
        id: 7,
        scoutId: "171599833",
        priority: "P0_CRITICAL",
        deadlineAt: open.deadlineAt,
        title: "Open booking link",
        address: "",
        subject: "Besichtigung",
        status: "PENDING",
        actionUrl: open.actionUrl,
        draftResponseText: "Gerne.",
        from: "info@wbm.de",
        body: "Bitte kommen Sie.",
        slotText: "",
      },
      [],
      now,
    );
    assert.equal(shown.label, "Besichtigung");
    assert.deepEqual(shown.badges, ["WBM"]);
  });
});
