import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { PdfLibFormFiller } from "../../src/adapters/pdf/form-filler.js";
import { notoSansBytes } from "../../src/adapters/pdf/font-file.js";
import { PdfLibCompiler } from "../../src/adapters/pdf/pdf-compiler.js";
import { extractPdfText } from "../../src/adapters/pdf/pdf-text.js";
import { FsDocumentVault } from "../../src/adapters/vault/fs-document-vault.js";
import { sampleProfile } from "../fakes.js";

describe("pdf tools", () => {
  it("merges requested files and stamps the watermark on every page", async () => {
    const compiler = new PdfLibCompiler(notoSansBytes());
    const merged = await compiler.mergeAndWatermark(
      [await page("Schufa"), await page("WBS")],
      "Nur zur Vorlage bei Frau Müller für Objekt Badstraße 4 – Datum: 2026-11-13",
    );
    const text = await extractPdfText(merged);
    assert.match(text, /Schufa/);
    assert.match(text, /WBS/);
    assert.match(text, /Badstraße 4/);
    assert.match(text, /Frau Müller/);
  });

  it("fills allowed fields, leaves prohibited fields blank, and reports them", async () => {
    const form = await PDFDocument.create();
    const sheet = form.addPage();
    const fields = form.getForm();
    fields.createTextField("Vorname").addToPage(sheet, { x: 50, y: 700, width: 200, height: 24 });
    fields.createTextField("Familienstand").addToPage(sheet, { x: 50, y: 660, width: 200, height: 24 });
    fields.createTextField("Staatsangehörigkeit").addToPage(sheet, { x: 50, y: 620, width: 200, height: 24 });
    const source = await form.save();
    const profile = sampleProfile();
    profile.formData = { ...profile.formData, firstName: "Max" };
    const filled = await new PdfLibFormFiller(notoSansBytes()).fill(source, profile);
    assert.deepEqual(filled.flagged, ["Familienstand"]);
    assert.deepEqual(filled.filled, ["Vorname"]);
    assert.ok(filled.pdf);
    const text = await extractPdfText(filled.pdf);
    assert.match(text, /Max/);
    assert.equal(/verheiratet|ledig/i.test(text), false);
  });

  it("reads a vault file and reports a missing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "vault-"));
    writeFileSync(join(dir, "wbs.pdf"), Buffer.from("%PDF"));
    const vault = new FsDocumentVault(dir);
    const reads = vault.read(["WBS", "PAYSLIPS_3M"]);
    assert.equal(reads[0]?.bytes?.length, 4);
    assert.equal(reads[1]?.bytes, null);
  });
});

async function page(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const sheet = doc.addPage();
  sheet.drawText(label, { x: 50, y: 700, size: 24 });
  return doc.save();
}
