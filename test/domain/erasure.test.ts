import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERASURE_AFTER_DAYS, erasureDue, erasureLetter } from "../../src/domain/erasure.js";

describe("erasure letter", () => {
  it("waits 30 days and names the apartment and the send date", () => {
    const sent = new Date("2026-11-12T16:00:00.000Z");
    const due = erasureDue(sent);
    assert.equal(ERASURE_AFTER_DAYS, 30);
    assert.equal(due.getTime() - sent.getTime(), 30 * 24 * 60 * 60 * 1000);
    const letter = erasureLetter({
      from: "Frau Müller <info@wbm.de>",
      address: "Badstraße 4",
      submittedAt: sent,
    });
    assert.match(letter, /Sehr geehrte Frau Müller/);
    assert.match(letter, /Art\. 17 DSGVO/);
    assert.match(letter, /Badstraße 4/);
    assert.match(letter, /12\.11\.2026/);
  });
});
