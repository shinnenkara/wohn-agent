import { documentsDraft, senderName } from "./mail-reply.js";
import { berlinParts } from "./timing.js";
import { DOCUMENT_CODES, isDocumentCode, isPhaseADocument, type DocumentCode } from "./triage.js";

export const VAULT_FILES: Record<DocumentCode, string> = {
  SCHUFA_BONITAETSCHECK: "schufa_bonitaetscheck.pdf",
  PAYSLIPS_3M: "payslips_3m_redacted.pdf",
  BANK_STATEMENT_REDACTED: "bank_salary_redacted.pdf",
  TAX_ASSESSMENT: "tax_assessment.pdf",
  ID_FRONT_BACK: "id_watermarked_optional.pdf",
  MIETSCHULDENFREIHEIT: "mietschuldenfreiheit.pdf",
  WBS: "wbs.pdf",
  ARBEITSVERTRAG: "arbeitsvertrag.pdf",
  BUERGSCHAFT: "buergschaft.pdf",
};

export const DOCUMENT_LABELS: Record<DocumentCode, string> = {
  SCHUFA_BONITAETSCHECK: "SCHUFA-Bonitätscheck",
  PAYSLIPS_3M: "Gehaltsnachweise",
  BANK_STATEMENT_REDACTED: "Kontoauszug",
  TAX_ASSESSMENT: "Steuerbescheid",
  ID_FRONT_BACK: "Ausweiskopie",
  MIETSCHULDENFREIHEIT: "Mietschuldenfreiheit",
  WBS: "WBS",
  ARBEITSVERTRAG: "Arbeitsvertrag",
  BUERGSCHAFT: "Bürgschaft",
};

export interface BundleFile {
  code: DocumentCode;
  bytes: Uint8Array | null;
}

export interface BundleReady {
  ok: true;
  files: DocumentCode[];
  bytes: Uint8Array[];
  refused: DocumentCode[];
  watermark: string;
  filename: string;
  body: string;
  notice: string;
}

export interface BundleBlocked {
  ok: false;
  refused: DocumentCode[];
  missing: DocumentCode[];
  notice: string;
}

export function documentLabel(code: string): string {
  return isDocumentCode(code) ? DOCUMENT_LABELS[code] : "";
}

export function orderedDocuments(requested: readonly string[]): DocumentCode[] {
  const wanted = new Set(requested.filter(isDocumentCode));
  return DOCUMENT_CODES.filter((code) => wanted.has(code));
}

export function watermarkLine(landlord: string, address: string, now: Date): string {
  const parts = berlinParts(now);
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  return `Nur zur Vorlage bei ${landlord} für Objekt ${address} – Datum: ${date}`;
}

export function bundleFilename(address: string): string {
  const cleaned = address.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return `Bewerbungsmappe_${(cleaned || "Wohnung").replace(/ /g, "_")}.pdf`;
}

export function decideBundle(input: {
  requested: readonly string[];
  files: readonly BundleFile[];
  dskViolation: boolean;
  from: string;
  address: string;
  subject: string;
  body: string;
  now: Date;
}): BundleReady | BundleBlocked {
  const requested = orderedDocuments(input.requested);
  const refused = input.dskViolation ? requested.filter(isPhaseADocument) : [];
  const kept = requested.filter((code) => !refused.includes(code));
  const present = new Map(input.files.map((file) => [file.code, file.bytes]));
  const missing = kept.filter((code) => {
    const bytes = present.get(code);
    return !bytes || bytes.length === 0;
  });
  const refusedNotice = refused.length > 0 ? `Refused before a viewing: ${refused.join(", ")}.` : "";
  if (kept.length === 0) {
    return {
      ok: false,
      refused,
      missing,
      notice: joinNotice(refusedNotice, "Nothing left to attach after the data-minimization check."),
    };
  }
  if (missing.length > 0) {
    const names = missing.map((code) => VAULT_FILES[code]).join(", ");
    return { ok: false, refused, missing, notice: joinNotice(refusedNotice, `Missing vault file: ${names}.`) };
  }
  const address = input.address.trim() || input.subject.trim() || "die Wohnung";
  const landlord = senderName(input.from).trim() || "den Vermieter";
  const labels = kept.map((code) => DOCUMENT_LABELS[code]);
  return {
    ok: true,
    files: kept,
    bytes: kept.map((code) => present.get(code) as Uint8Array),
    refused,
    watermark: watermarkLine(landlord, address, input.now),
    filename: bundleFilename(address),
    body: documentsDraft(senderName(input.from), labels, input.body),
    notice: refusedNotice,
  };
}

function joinNotice(left: string, right: string): string {
  return [left, right].filter(Boolean).join(" ");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
