import fontkit from "@pdf-lib/fontkit";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
  type PDFField,
} from "pdf-lib";
import type { FormFiller, FormFillResult } from "../../application/ports/form-filler.js";
import type { ApplicantProfile } from "../../domain/applicant-profile.js";
import { disclosurePlan } from "../../domain/disclosure-form.js";

export class PdfLibFormFiller implements FormFiller {
  constructor(private readonly fontBytes: Uint8Array) {}

  async fill(pdf: Uint8Array, profile: ApplicantProfile): Promise<FormFillResult> {
    const doc = await PDFDocument.load(pdf);
    const form = doc.getForm();
    const fields = form.getFields();
    if (fields.length === 0) {
      return { pdf: null, flagged: [], unknown: [], filled: [] };
    }
    const plan = new Map(disclosurePlan(fields.map((field) => field.getName()), profile).fields.map((field) => [field.name, field]));
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(this.fontBytes, { subset: true });
    const flagged: string[] = [];
    const unknown: string[] = [];
    const filled: string[] = [];
    for (const field of fields) {
      const item = plan.get(field.getName());
      if (!item || item.action === "skip") {
        unknown.push(field.getName());
        continue;
      }
      if (item.action === "blank") {
        flagged.push(field.getName());
        continue;
      }
      try {
        writeField(field, item.value);
        filled.push(field.getName());
      } catch {
        unknown.push(field.getName());
      }
    }
    form.updateFieldAppearances(font);
    form.flatten();
    return { pdf: await doc.save(), flagged, unknown, filled };
  }
}

function writeField(field: PDFField, value: string): void {
  if (field instanceof PDFTextField) {
    field.setText(value);
    return;
  }
  if (field instanceof PDFCheckBox) {
    if (value === "Ja" || value === "TRUE") {
      field.check();
      return;
    }
    field.uncheck();
    return;
  }
  if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
    field.select(value);
    return;
  }
  throw new Error("unsupported field");
}
