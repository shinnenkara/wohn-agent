import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GmailDraftError, GmailDraftWriter } from "../../src/adapters/google/gmail-draft.js";
import type { Authorizer } from "../../src/adapters/google/authed-get.js";
import type { ConsoleSession } from "../../src/infrastructure/console-loop.js";
import { runTask } from "../../src/infrastructure/task-route.js";
import type { QueueRow } from "../../src/domain/mail-action.js";

describe("gmail draft", () => {
  it("posts a reply mime on the thread", async () => {
    const forces: boolean[] = [];
    const authorizer: Authorizer = {
      async accessToken(force) {
        forces.push(force === true);
        return "token";
      },
    };
    let seen: { url: string; authorization: string; body: string } | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      seen = {
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        body: String(init?.body),
      };
      return Response.json({ id: "r1", message: { id: "msg-9", threadId: "thread-1" } });
    };
    const created = await new GmailDraftWriter(authorizer, fetchImpl).createReply({
      threadId: "thread-1",
      to: "info@wbm.de",
      subject: "Besichtigung",
      body: "Gerne zur Besichtigung.",
      inReplyTo: "<m@example.com>",
      references: "<old@example.com> <m@example.com>",
    });
    assert.equal(created.messageId, "msg-9");
    assert.equal(seen?.url, "https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    assert.equal(seen?.authorization, "Bearer token");
    assert.deepEqual(forces, [false]);
    const payload = JSON.parse(seen?.body ?? "{}") as { message?: { threadId?: string; raw?: string } };
    assert.equal(payload.message?.threadId, "thread-1");
    const mime = Buffer.from(payload.message?.raw ?? "", "base64url").toString("utf8");
    assert.match(mime, /In-Reply-To: <m@example.com>/);
    assert.match(mime, /References: <old@example.com> <m@example.com>/);
    assert.match(mime, /Subject: Re: Besichtigung/);
    const encoded = mime.split("\r\n\r\n")[1] ?? "";
    assert.equal(Buffer.from(encoded.replace(/\s+/g, ""), "base64").toString("utf8"), "Gerne zur Besichtigung.");
  });

  it("posts the draft with a pdf attachment and never calls send", async () => {
    const authorizer: Authorizer = { async accessToken() { return "token"; } };
    let url = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      url = String(input);
      const payload = JSON.parse(String(init?.body)) as { message?: { raw?: string } };
      const mime = Buffer.from(payload.message?.raw ?? "", "base64url").toString("utf8");
      assert.match(mime, /multipart\/mixed/);
      assert.match(mime, /Content-Type: application\/pdf/);
      assert.match(mime, /filename\*=UTF-8''Bewerbungsmappe_Badstra%C3%9Fe\.pdf/);
      const encoded = mime.split("Content-Transfer-Encoding: base64").at(-1) ?? "";
      const pdf = Buffer.from(encoded.replace(/--wohn_[\s\S]*$/, "").replace(/\s+/g, ""), "base64");
      assert.equal(pdf.subarray(0, 4).toString("utf8"), "%PDF");
      return Response.json({ message: { id: "msg-pdf" } });
    };
    const created = await new GmailDraftWriter(authorizer, fetchImpl).createReply({
      threadId: "thread-1",
      to: "info@wbm.de",
      subject: "Unterlagen",
      body: "Gerne sende ich Ihnen die Unterlagen (WBS).",
      inReplyTo: "<m@example.com>",
      references: "",
      attachment: { filename: "Bewerbungsmappe_Badstraße.pdf", content: Buffer.from("%PDF-1.4") },
    });
    assert.equal(created.messageId, "msg-pdf");
    assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    assert.equal(url.includes("messages/send"), false);
  });

  it("tells the operator to log in again when Gmail refuses the draft", async () => {
    const authorizer: Authorizer = { async accessToken() { return "token"; } };
    const fetchImpl: typeof fetch = async () => new Response("no", { status: 403 });
    await assert.rejects(
      () =>
        new GmailDraftWriter(authorizer, fetchImpl).createReply({
          threadId: "thread-1",
          to: "info@wbm.de",
          subject: "Besichtigung",
          body: "Gerne.",
          inReplyTo: "<m@example.com>",
          references: "",
        }),
      (error: unknown) => error instanceof GmailDraftError && /npm run login/.test(error.message),
    );
  });
});

describe("task actions", () => {
  it("returns the draft url and leaves the status alone when Gmail refuses", async () => {
    const statuses: string[] = [];
    const session: ConsoleSession = {
      queue: () => [taskRow()],
      setStatus(id, status) {
        statuses.push(`${id}:${status}`);
      },
      quarantine() {
        return undefined;
      },
      async createDraft() {
        throw new GmailDraftError("Gmail refused the draft. Run npm run login.");
      },
      now: () => new Date("2026-11-12T16:00:00.000Z"),
    };
    const refused = await runTask(session, "draft", 4);
    assert.equal(refused.status, 400);
    assert.equal(refused.body, "Gmail refused the draft. Run npm run login.");
    assert.deepEqual(statuses, []);

    const ready: ConsoleSession = {
      ...session,
      async createDraft() {
        return { url: "https://mail.google.com/mail/u/0/#drafts?compose=msg-9", notice: "Refused before a viewing: SCHUFA_BONITAETSCHECK." };
      },
    };
    const created = await runTask(ready, "draft", 4);
    assert.equal(created.status, 200);
    assert.deepEqual(JSON.parse(created.body), {
      url: "https://mail.google.com/mail/u/0/#drafts?compose=msg-9",
      notice: "Refused before a viewing: SCHUFA_BONITAETSCHECK.",
    });
    assert.deepEqual(statuses, ["4:IN_PROGRESS"]);
  });

  it("opens a link, completes a task, and quarantines the row's apartment", async () => {
    const statuses: string[] = [];
    const quarantined: string[] = [];
    const session: ConsoleSession = {
      queue: () => [taskRow(), { ...taskRow(), id: 8, scoutId: "", actionUrl: "" }],
      setStatus(id, status) {
        statuses.push(`${id}:${status}`);
      },
      quarantine(id, scoutId) {
        quarantined.push(`${id}:${scoutId}`);
      },
      async createDraft() {
        return { url: "", notice: "" };
      },
      now: () => new Date("2026-11-12T16:00:00.000Z"),
    };
    const opened = await runTask(session, "open", 4);
    assert.equal(opened.status, 200);
    assert.equal(JSON.parse(opened.body).url, "https://portal.example/book");
    const missing = await runTask(session, "open", 8);
    assert.equal(missing.status, 400);
    assert.equal(missing.body, "This action has no link.");
    const done = await runTask(session, "done", 4);
    assert.equal(done.status, 200);
    const scam = await runTask(session, "scam", 4);
    assert.equal(scam.status, 200);
    const blocked = await runTask(session, "scam", 8);
    assert.equal(blocked.status, 200);
    const gone = await runTask(session, "done", 9);
    assert.equal(gone.status, 404);
    assert.equal(gone.body, "That action is no longer open.");
    assert.deepEqual(statuses, ["4:IN_PROGRESS", "4:COMPLETED"]);
    assert.deepEqual(quarantined, ["4:171599833", "8:"]);
  });

  it("leaves another time open and completes a decline", async () => {
    const variants: string[] = [];
    const statuses: string[] = [];
    const session: ConsoleSession = {
      queue: () => [taskRow()],
      setStatus(id, status) {
        statuses.push(`${id}:${status}`);
      },
      quarantine() {
        return undefined;
      },
      async createDraft(_id, variant) {
        variants.push(variant);
        return { url: "https://mail.example/draft", notice: "" };
      },
      now: () => new Date("2026-11-12T16:00:00.000Z"),
    };
    const other = await runTask(session, "other", 4);
    assert.equal(other.status, 200);
    const declined = await runTask(session, "decline", 4);
    assert.equal(declined.status, 200);
    assert.deepEqual(variants, ["other", "decline"]);
    assert.deepEqual(statuses, ["4:IN_PROGRESS", "4:COMPLETED"]);
  });
});

function taskRow(): QueueRow {
  return {
    id: 4,
    scoutId: "171599833",
    priority: "P1_HIGH",
    deadlineAt: "2026-11-12T17:00:00.000Z",
    title: "Answer viewing proposal",
    label: "Badstraße 54",
    status: "PENDING",
    badges: [],
    actionUrl: "https://portal.example/book",
    draftResponseText: "Gerne.",
    otherBody: "",
    declineBody: "",
    declineLabel: "Decline",
    reason: "",
  };
}
