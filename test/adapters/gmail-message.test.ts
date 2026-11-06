import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readGmailMessage } from "../../src/adapters/google/gmail-message.js";

describe("gmail message", () => {
  it("reads the text part and a calendar attachment", () => {
    const parsed = readGmailMessage({
      id: "m1",
      threadId: "t1",
      internalDate: "1760000000000",
      payload: {
        headers: [
          { name: "From", value: "ImmoScout24 <myscout@immobilienscout24.de>" },
          { name: "Reply-To", value: "Reply <back@example.com>" },
          { name: "Message-ID", value: "<m1@example.com>" },
          { name: "Subject", value: "Anfrage versendet" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("Objekt 171599833", "utf8").toString("base64url") } },
          { mimeType: "text/calendar", body: { data: Buffer.from("BEGIN:VCALENDAR", "utf8").toString("base64url") } },
        ],
      },
    });
    assert.equal(parsed.text, "Objekt 171599833");
    assert.equal(parsed.calendarPart, true);
    assert.equal(parsed.from.includes("myscout@"), true);
    assert.equal(parsed.replyTo, "Reply <back@example.com>");
    assert.equal(parsed.messageId, "<m1@example.com>");
    assert.equal(parsed.sentAt, new Date(1760000000000).toISOString());
  });
});
