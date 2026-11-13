import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankForReading, readingFirst, sameAccount } from "../../src/domain/reading-order.js";

describe("reading order", () => {
  it("puts housing mail ahead of a newsletter and keeps the earlier order inside each group", () => {
    assert.equal(sameAccount("Oleksii <a@example.com>", "A@Example.com"), true);
    assert.equal(sameAccount("Hello <hello@healthygamer.gg>", "a@example.com"), false);
    assert.equal(
      readingFirst({
        from: "noreply@immobilienscout24.de",
        kind: "unclassified",
        scoutId: "",
        accountEmail: null,
        addressSignal: false,
      }),
      true,
    );
    assert.equal(
      readingFirst({
        from: "Hello <hello@healthygamer.gg>",
        kind: "landlord",
        scoutId: "",
        accountEmail: "a@example.com",
        addressSignal: false,
      }),
      false,
    );
    assert.equal(
      readingFirst({
        from: "Hello <hello@healthygamer.gg>",
        kind: "landlord",
        scoutId: "171599833",
        accountEmail: null,
        addressSignal: false,
      }),
      true,
    );
    const ranked = rankForReading(
      [
        { id: "news", from: "Hello <hello@healthygamer.gg>", kind: "landlord" as const, scoutId: "", cleanText: "goals" },
        { id: "bounce", from: "noreply@immobilienscout24.de", kind: "unclassified" as const, scoutId: "", cleanText: "nicht zugestellt" },
        { id: "street", from: "a@gmail.com", kind: "landlord" as const, scoutId: "", cleanText: "Badstrasse 54, 13357 Berlin" },
      ],
      {
        accountEmail: "a@example.com",
        candidates: [{ scoutId: "171599833", title: "Altbau", address: "Badstraße 54, 13357 Berlin", priceCold: 900 }],
      },
    );
    assert.deepEqual(ranked.map((item) => item.id), ["bounce", "street", "news"]);
  });
});