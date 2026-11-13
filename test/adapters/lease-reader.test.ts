import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GeminiLeaseReader } from "../../src/adapters/google/lease-reader.js";

describe("lease reader", () => {
  it("asks the lease model and keeps the cited amounts", async () => {
    let url = "";
    const fetchImpl: typeof fetch = async (input) => {
      url = String(input);
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    coldRentEur: 1200,
                    coldRentCitation: "1.200 Euro",
                    depositEur: 0,
                    depositCitation: "",
                    iban: "de89 3704 0044 0532 0130 00",
                    ibanCitation: "DE89 3704 0044 0532 0130 00",
                    renovationCitations: ["  spätestens  "],
                  }),
                },
              ],
            },
          },
        ],
      });
    };
    const facts = await new GeminiLeaseReader("key", "gemini-2.5-pro", fetchImpl).read("Vertrag");
    assert.match(url, /models\/gemini-2\.5-pro:generateContent/);
    assert.equal(facts.coldRentEur, 1200);
    assert.equal(facts.coldRentCitation, "1.200 Euro");
    assert.equal(facts.depositEur, null);
    assert.equal(facts.iban, "DE89370400440532013000");
    assert.deepEqual(facts.renovationCitations, ["spätestens"]);
  });
});
