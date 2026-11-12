import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GmailDraftError, GmailDraftWriter } from "../../src/adapters/google/gmail-draft.js";
import type { Authorizer } from "../../src/adapters/google/authed-get.js";
import { performConsoleEffect, type ConsoleSession } from "../../src/infrastructure/console-loop.js";

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

describe("console effects", () => {
  it("opens a draft and leaves the status alone when Gmail refuses", async () => {
    const opened: string[] = [];
    const statuses: string[] = [];
    const session: ConsoleSession = {
      queue: () => [],
      open(url) {
        opened.push(url);
      },
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
    const message = await performConsoleEffect(session, { kind: "draft", id: 4 });
    assert.equal(message, "Gmail refused the draft. Run npm run login.");
    assert.deepEqual(opened, []);
    assert.deepEqual(statuses, []);

    const ready: ConsoleSession = {
      ...session,
      async createDraft() {
        return "https://mail.google.com/mail/u/0/#drafts?compose=msg-9";
      },
    };
    assert.equal(await performConsoleEffect(ready, { kind: "draft", id: 4 }), "");
    assert.deepEqual(opened, ["https://mail.google.com/mail/u/0/#drafts?compose=msg-9"]);
    assert.deepEqual(statuses, ["4:IN_PROGRESS"]);
  });
});
