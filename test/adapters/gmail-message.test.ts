import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listPdfParts, readGmailMessage } from "../../src/adapters/google/gmail-message.js";

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
          { name: "In-Reply-To", value: "<parent@example.com>" },
          { name: "References", value: "<root@example.com> <parent@example.com>" },
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
    assert.equal(parsed.inReplyTo, "<parent@example.com>");
    assert.equal(parsed.references, "<root@example.com> <parent@example.com>");
    assert.equal(parsed.sentAt, new Date(1760000000000).toISOString());
  });

  it("lists pdf parts and keeps inline bytes", () => {
    const parts = listPdfParts({
      payload: {
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("Hallo", "utf8").toString("base64url") } },
          {
            mimeType: "application/pdf",
            filename: "Mietvertrag.pdf",
            body: { attachmentId: "att-1" },
          },
          {
            mimeType: "application/octet-stream",
            filename: "Nebenkosten.pdf",
            body: { data: Buffer.from("%PDF", "utf8").toString("base64url") },
          },
        ],
      },
    });
    assert.equal(parts.length, 2);
    assert.equal(parts[0]?.attachmentId, "att-1");
    assert.equal(parts[1]?.filename, "Nebenkosten.pdf");
    assert.match(parts[1]?.attachmentId ?? "", /^inline:/);
  });
});
