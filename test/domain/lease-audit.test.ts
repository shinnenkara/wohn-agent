import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditLease, emptyLeaseFacts, ibansIn, scorecardText, type ProposedLeaseFacts } from "../../src/domain/lease-audit.js";

const contract = [
  "Die Nettokaltmiete beträgt 1.200 Euro.",
  "Die Kaution beträgt 4.000 Euro.",
  "Die Miete erhöht sich gemäß Indexmiete.",
  "Staffelmiete 900 € ab 2027.",
  "Der Vertrag ist befristet bis 2028, Grund: weil es uns passt.",
  "IBAN DE89 3704 0044 0532 0130 00.",
  "Schönheitsreparaturen sind spätestens alle 3 Jahre fällig.",
  "Der Möblierungszuschlag beträgt 50 Euro monatlich bei einem Möbelwert von 3.600 Euro.",
  "Die Wohnung wird unrenoviert übergeben und der Mieter muss streichen.",
].join("\n");

function facts(patch: Partial<ProposedLeaseFacts> = {}): ProposedLeaseFacts {
  return {
    ...emptyLeaseFacts(),
    coldRentEur: 1200,
    coldRentCitation: "1.200 Euro",
    indexCitation: "gemäß Indexmiete",
    staffelSteps: [{ amount: "900 € ab 2027", citation: "Staffelmiete 900 € ab 2027" }],
    fixedTermCitation: "befristet bis 2028",
    fixedTermReason: "weil es uns passt",
    furnitureSurchargeEur: 50,
    furnitureSurchargeCitation: "50 Euro",
    furnitureValueEur: 3600,
    furnitureValueCitation: "3.600 Euro",
    depositEur: 4000,
    depositCitation: "4.000 Euro",
    iban: "DE89 3704 0044 0532 0130 00",
    ibanCitation: "DE89 3704 0044 0532 0130 00",
    renovationCitations: [
      "Schönheitsreparaturen sind spätestens alle 3 Jahre fällig.",
      "Die Wohnung wird unrenoviert übergeben und der Mieter muss streichen.",
    ],
    ...patch,
  };
}

describe("lease audit", () => {
  it("flags uncapped index rent, an invalid fixed term, the deposit, a foreign mismatch, rigid repairs, and furniture", () => {
    const card = scorecardText(
      auditLease(facts(), contract, ["DE44 5001 0517 5407 3249 31"]),
    );
    assert.match(card, /Indexmiete ohne Obergrenze/);
    assert.match(card, /Staffelmiete: 900 € ab 2027/);
    assert.match(card, /Befristung ohne gesetzlichen Grund/);
    assert.match(card, /Kaution 4000 € liegt über 3 × 1200 €/);
    assert.match(card, /weicht von DE44500105175407324931/);
    assert.match(card, /Starre Schönheitsreparaturen/);
    assert.match(card, /unrenovierter Übergabe/);
    assert.match(card, /Möblierungszuschlag 50 € über der 10-Jahres-Abschreibung von 30 €/);
    assert.match(card, /Rüge innerhalb von 30 Monaten/);
    assert.match(card, /Mietpreisbremse: nicht geprüft/);
  });

  it("keeps a lawful deposit, a cited legal reason, and a matching IBAN", () => {
    const card = scorecardText(
      auditLease(
        facts({
          depositEur: 3600,
          depositCitation: "3.600 Euro",
          indexCitation: "",
          staffelSteps: [],
          fixedTermReason: "Eigenbedarf",
          furnitureSurchargeEur: null,
          furnitureSurchargeCitation: "",
          furnitureValueEur: null,
          furnitureValueCitation: "",
          renovationCitations: ["spätestens am Freitag"],
        }),
        `${contract}\nEigenbedarf\n3.600 Euro\nspätestens am Freitag`,
        ["DE89370400440532013000"],
      ),
    );
    assert.match(card, /Befristung: Eigenbedarf/);
    assert.match(card, /Kaution innerhalb von 3 Nettokaltmieten/);
    assert.match(card, /IBAN stimmt mit früheren Mails überein/);
    assert.equal(card.includes("Starre Schönheitsreparaturen"), false);
    assert.equal(card.includes("Indexmiete"), false);
  });

  it("drops amounts the contract does not cite and leaves the deposit check undone", () => {
    const card = scorecardText(
      auditLease(
        facts({
          coldRentCitation: "nicht im Vertrag",
          depositCitation: "nicht im Vertrag",
          iban: "GB29NWBK60161331926819",
          ibanCitation: "GB29 NWBK 6016 1331 9268 19",
          furnitureValueCitation: "",
          indexCitation: "gemäß Indexmiete",
          capCitation: "höchstens 3 Prozent",
        }),
        `${contract}\nGB29 NWBK 6016 1331 9268 19\nhöchstens 3 Prozent`,
        [],
      ),
    );
    assert.match(card, /Indexmiete mit genannter Obergrenze/);
    assert.match(card, /Kaution: nicht geprüft/);
    assert.match(card, /keine deutsche IBAN/);
    assert.match(card, /ohne Abschreibungsgrundlage/);
    assert.equal(card.includes("liegt über"), false);
  });

  it("reads an IBAN out of earlier mail without swallowing the next word", () => {
    assert.deepEqual(ibansIn("Bitte an DE89 3704 0044 0532 0130 00 danke"), ["DE89370400440532013000"]);
  });
});
