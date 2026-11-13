import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bundleFilename, decideBundle, watermarkLine } from "../../src/domain/document-bundle.js";

const evening = new Date("2026-11-12T23:30:00.000Z");
const bytes = new Uint8Array([1, 2, 3]);

describe("document bundle", () => {
  it("stamps the landlord, the address, and the Berlin date", () => {
    assert.equal(
      watermarkLine("Frau Müller", "Badstraße 4", evening),
      "Nur zur Vorlage bei Frau Müller für Objekt Badstraße 4 – Datum: 2026-11-13",
    );
    assert.equal(bundleFilename("Badstraße 4/5"), "Bewerbungsmappe_Badstraße_45.pdf");
  });

  it("drops phase A documents and names only what will be attached", () => {
    const decision = decideBundle({
      requested: ["SCHUFA_BONITAETSCHECK", "WBS"],
      files: [{ code: "WBS", bytes }],
      dskViolation: true,
      from: "info@wbm.de",
      address: "",
      subject: "Unterlagen Badstraße",
      body: "Bitte die Schufa.",
      now: evening,
    });
    assert.equal(decision.ok, true);
    if (!decision.ok) {
      return;
    }
    assert.deepEqual(decision.files, ["WBS"]);
    assert.deepEqual(decision.refused, ["SCHUFA_BONITAETSCHECK"]);
    assert.match(decision.notice, /SCHUFA_BONITAETSCHECK/);
    assert.match(decision.watermark, /den Vermieter/);
    assert.match(decision.watermark, /Unterlagen Badstraße/);
    assert.match(decision.body, /WBS/);
    assert.equal(decision.body.includes("SCHUFA"), false);
  });

  it("stops when a requested file is missing", () => {
    const decision = decideBundle({
      requested: ["PAYSLIPS_3M", "WBS"],
      files: [
        { code: "PAYSLIPS_3M", bytes: null },
        { code: "WBS", bytes },
      ],
      dskViolation: false,
      from: "WBM <info@wbm.de>",
      address: "Badstraße 4",
      subject: "",
      body: "",
      now: evening,
    });
    assert.equal(decision.ok, false);
    if (decision.ok) {
      return;
    }
    assert.match(decision.notice, /payslips_3m_redacted\.pdf/);
  });

  it("does not build a pdf when every requested document is refused", () => {
    const decision = decideBundle({
      requested: ["ID_FRONT_BACK", "BANK_STATEMENT_REDACTED"],
      files: [],
      dskViolation: true,
      from: "WBM <info@wbm.de>",
      address: "Badstraße 4",
      subject: "",
      body: "",
      now: evening,
    });
    assert.equal(decision.ok, false);
    if (decision.ok) {
      return;
    }
    assert.match(decision.notice, /data-minimization/);
    assert.match(decision.notice, /ID_FRONT_BACK/);
  });
});
