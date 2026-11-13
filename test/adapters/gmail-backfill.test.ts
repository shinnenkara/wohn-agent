import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GmailMailbox } from "../../src/adapters/google/gmail-client.js";

describe("gmail backfill", () => {
  it("waits out a rate limit and skips a message that is already stored", async () => {
    const waits: number[] = [];
    let blocked = true;
    const mailbox = new GmailMailbox(
      { async accessToken() { return "token"; } },
      async (input) => {
        const url = String(input);
        if (url.includes("/messages?")) {
          return Response.json({ messages: [{ id: "kept" }, { id: "fresh" }] });
        }
        if (url.includes("/messages/fresh") && blocked) {
          blocked = false;
          return Response.json(
            { error: { errors: [{ reason: "rateLimitExceeded", message: "Quota exceeded" }] } },
            { status: 403 },
          );
        }
        const id = url.includes("fresh") ? "fresh" : "kept";
        return Response.json(letter(id));
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    const batches: string[][] = [];
    const lines: string[] = [];
    const listed = await mailbox.listSince(new Date("2026-10-01T00:00:00.000Z"), null, {
      skip: new Set(["kept"]),
      onBatch: async (mails) => {
        batches.push(mails.map((mail) => mail.id));
      },
      onProgress: (line) => {
        lines.push(line);
      },
    });
    assert.deepEqual(listed, []);
    assert.deepEqual(batches, [["fresh"]]);
    assert.deepEqual(waits, [60_000]);
    assert.deepEqual(lines, [
      "Listing Gmail messages since 2026-10-01.",
      "Listed 2 messages. 1 already stored. 1 to download.",
      "Gmail quota reached. Pausing 60s.",
      "Stored 1 messages (1 of 1).",
    ]);
  });
});

function letter(id: string) {
  return {
    id,
    threadId: "t",
    internalDate: "0",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "a@b.c" },
        { name: "Subject", value: "Hi" },
      ],
      body: { data: Buffer.from("Hi").toString("base64url") },
    },
  };
}
