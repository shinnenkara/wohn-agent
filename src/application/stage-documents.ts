import type { ApplicantProfile } from "../domain/applicant-profile.js";
import { decideBundle, orderedDocuments } from "../domain/document-bundle.js";
import { auditLease, ibansIn, leaseTextUsable, NO_LEASE_TEXT, scorecardText } from "../domain/lease-audit.js";
import { isPhaseADocument } from "../domain/triage.js";
import type { MailStore, OpenMailAction } from "./ports/mail-store.js";
import type { DocumentVault } from "./ports/document-vault.js";
import type { FormFiller } from "./ports/form-filler.js";
import type { LeaseFactReader } from "./ports/lease-reader.js";
import type { MailAttachmentSource } from "./ports/mail-attachments.js";
import type { PdfCompiler } from "./ports/pdf-compiler.js";
import type { ReplyAttachment } from "./ports/draft-writer.js";

export type StageResult =
  | { ok: false; notice: string }
  | { ok: true; body: string; attachment?: ReplyAttachment; notice: string };

export async function stageOutgoing(input: {
  action: OpenMailAction;
  vault: DocumentVault;
  compiler: PdfCompiler;
  attachments: MailAttachmentSource;
  forms: FormFiller;
  profile: ApplicantProfile | null;
  lease: LeaseFactReader | null;
  mail: MailStore;
  extractText(bytes: Uint8Array): Promise<string>;
  now: Date;
}): Promise<StageResult> {
  if (input.action.actionCode === "SEND_DOCUMENTS") {
    return stageDocuments(input);
  }
  if (input.action.actionCode === "SEND_DISCLOSURE") {
    return stageDisclosure(input);
  }
  if (input.action.actionCode === "REVIEW_CONTRACT") {
    return stageContract(input);
  }
  if (input.action.draftResponseText.trim() === "") {
    return { ok: false, notice: "This action has no reply text." };
  }
  return { ok: true, body: input.action.draftResponseText, notice: "" };
}

async function stageDocuments(input: {
  action: OpenMailAction;
  vault: DocumentVault;
  compiler: PdfCompiler;
  now: Date;
}): Promise<StageResult> {
  const requested = orderedDocuments(input.action.requestedDocuments);
  if (requested.length === 0) {
    if (input.action.draftResponseText.trim() === "") {
      return { ok: false, notice: "This action has no reply text." };
    }
    return { ok: true, body: input.action.draftResponseText, notice: "No document list was stored." };
  }
  const kept = input.action.dskViolation ? requested.filter((code) => !isPhaseADocument(code)) : requested;
  const decision = decideBundle({
    requested,
    files: input.vault.read(kept),
    dskViolation: input.action.dskViolation,
    from: input.action.from,
    address: input.action.address,
    subject: input.action.subject,
    body: input.action.body,
    now: input.now,
  });
  if (!decision.ok) {
    return decision;
  }
  const pdf = await input.compiler.mergeAndWatermark(decision.bytes, decision.watermark);
  return {
    ok: true,
    body: decision.body,
    attachment: { filename: decision.filename, content: pdf },
    notice: decision.notice,
  };
}

async function stageDisclosure(input: {
  action: OpenMailAction;
  attachments: MailAttachmentSource;
  forms: FormFiller;
  profile: ApplicantProfile | null;
}): Promise<StageResult> {
  if (input.action.draftResponseText.trim() === "") {
    return { ok: false, notice: "This action has no reply text." };
  }
  const textOnly = { ok: true as const, body: input.action.draftResponseText };
  let pdfs;
  try {
    pdfs = await input.attachments.listPdfs(input.action.mailId);
  } catch (error) {
    return { ...textOnly, notice: message(error) };
  }
  const first = pdfs[0];
  if (!first) {
    return { ...textOnly, notice: "The form was not filled." };
  }
  if (!input.profile) {
    return { ...textOnly, notice: "The form was not filled. No applicant profile is set." };
  }
  try {
    const bytes = await input.attachments.download(input.action.mailId, first.attachmentId);
    const filled = await input.forms.fill(bytes, input.profile);
    if (!filled.pdf) {
      return { ...textOnly, notice: "The form was not filled." };
    }
    const filename = first.filename.toLowerCase().endsWith(".pdf") ? first.filename : "Selbstauskunft.pdf";
    const notice = filled.flagged.length > 0 ? `Left blank: ${filled.flagged.join(", ")}.` : "";
    return { ok: true, body: input.action.draftResponseText, attachment: { filename, content: filled.pdf }, notice };
  } catch (error) {
    return { ...textOnly, notice: message(error) };
  }
}

async function stageContract(input: {
  action: OpenMailAction;
  attachments: MailAttachmentSource;
  lease: LeaseFactReader | null;
  mail: MailStore;
  extractText(bytes: Uint8Array): Promise<string>;
  now: Date;
}): Promise<StageResult> {
  const notice = await leaseNotice(input);
  if (input.action.draftResponseText.trim() === "") {
    return { ok: false, notice };
  }
  return { ok: true, body: input.action.draftResponseText, notice };
}

async function leaseNotice(input: {
  action: OpenMailAction;
  attachments: MailAttachmentSource;
  lease: LeaseFactReader | null;
  mail: MailStore;
  extractText(bytes: Uint8Array): Promise<string>;
  now: Date;
}): Promise<string> {
  const stored = input.mail.loadScorecard(input.action.mailId);
  if (stored) {
    return stored;
  }
  let pdfs;
  try {
    pdfs = await input.attachments.listPdfs(input.action.mailId);
  } catch (error) {
    return message(error);
  }
  if (pdfs.length === 0) {
    return "No contract PDF was attached.";
  }
  if (!input.lease) {
    return "Lease was not read. No model key is set.";
  }
  try {
    const parts: string[] = [];
    for (const pdf of pdfs) {
      const bytes = await input.attachments.download(input.action.mailId, pdf.attachmentId);
      parts.push(await input.extractText(bytes));
    }
    const text = parts.join("\n");
    if (!leaseTextUsable(text)) {
      input.mail.saveScorecard(input.action.mailId, NO_LEASE_TEXT, input.now);
      return NO_LEASE_TEXT;
    }
    const facts = await input.lease.read(text);
    const prior = ibansIn(input.mail.apartmentText(input.action.scoutId, input.action.mailId));
    const textCard = scorecardText(auditLease(facts, text, prior));
    input.mail.saveScorecard(input.action.mailId, textCard, input.now);
    return textCard;
  } catch (error) {
    return message(error);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The draft could not be prepared.";
}
