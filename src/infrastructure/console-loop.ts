import type { DraftWriter } from "../application/ports/draft-writer.js";
import type { MailStore } from "../application/ports/mail-store.js";
import type { Clock } from "../application/ports/clock.js";
import type { ApplicantProfile } from "../domain/applicant-profile.js";
import type { DocumentVault } from "../application/ports/document-vault.js";
import type { FormFiller } from "../application/ports/form-filler.js";
import type { LeaseFactReader } from "../application/ports/lease-reader.js";
import type { MailAttachmentSource } from "../application/ports/mail-attachments.js";
import type { PdfCompiler } from "../application/ports/pdf-compiler.js";
import type { ProgressLog } from "../application/ports/progress-log.js";
import { noteDocumentCompleted } from "../application/queue-erasure.js";
import { stageOutgoing } from "../application/stage-documents.js";
import { gmailDraftUrl } from "../domain/gmail-url.js";
import { sortQueue, toQueueRow, type QueueRow } from "../domain/mail-action.js";
import { mailboxAddress } from "../domain/mail-reply.js";
import { declineOutcome } from "../domain/progress.js";

export type DraftVariant = "accept" | "other" | "decline";

export interface ConsoleSession {
  queue(now: Date): QueueRow[];
  setStatus(id: number, status: "IN_PROGRESS" | "COMPLETED"): void;
  quarantine(id: number, scoutId: string): void;
  createDraft(id: number, variant: DraftVariant): Promise<{ url: string; notice: string }>;
  now(): Date;
}

export function createConsoleSession(input: {
  mail: MailStore;
  progress: ProgressLog;
  drafts: DraftWriter;
  clock: Clock;
  documents: { vault: DocumentVault; compiler: PdfCompiler };
  disclosure: { attachments: MailAttachmentSource; forms: FormFiller; profile: ApplicantProfile | null };
  lease: { reader: LeaseFactReader | null; extractText(bytes: Uint8Array): Promise<string> };
}): ConsoleSession {
  return {
    queue(now) {
      input.mail.promoteDueErasure(now);
      const busy = input.mail.busyIntervals();
      return sortQueue(input.mail.listOpenActions().map((row) => toQueueRow(row, busy, now)));
    },
    setStatus(id, status) {
      input.mail.setActionStatus(id, status);
      if (status === "COMPLETED") {
        noteDocumentCompleted(input.mail, id, input.clock.now());
      }
    },
    quarantine(id, scoutId) {
      if (scoutId !== "") {
        input.mail.quarantineScout(scoutId, input.clock.now());
        input.mail.blockOpenActions(scoutId);
        return;
      }
      input.mail.setActionStatus(id, "BLOCKED_SCAM");
    },
    async createDraft(id, variant) {
      const action = input.mail.listOpenActions().find((row) => row.id === id);
      if (!action) {
        throw new Error("That action is no longer open.");
      }
      const letter = replyLetter(action, variant);
      if (letter.trim() === "") {
        throw new Error("This action has no reply text.");
      }
      const source = input.mail.replySource(action.mailId);
      if (!source) {
        throw new Error("That mail is no longer stored.");
      }
      const to = mailboxAddress(source.replyTo, source.from);
      if (!to) {
        throw new Error("This mail has no reply address.");
      }
      const messageId = source.messageId.trim();
      const staged = await stageOutgoing({
        action: { ...action, draftResponseText: letter },
        vault: input.documents.vault,
        compiler: input.documents.compiler,
        attachments: input.disclosure.attachments,
        forms: input.disclosure.forms,
        profile: input.disclosure.profile,
        lease: input.lease.reader,
        mail: input.mail,
        extractText: input.lease.extractText,
        now: input.clock.now(),
      });
      if (!staged.ok) {
        throw new Error(staged.notice);
      }
      const created = await input.drafts.createReply({
        threadId: source.threadId,
        to,
        subject: source.subject,
        body: staged.body,
        inReplyTo: messageId || source.inReplyTo.trim(),
        references: replyReferences(source.references, messageId),
        attachment: staged.attachment,
      });
      if (variant === "decline") {
        const outcome = declineOutcome(action.intentCode);
        if (outcome && action.scoutId !== "") {
          input.progress.setOutcome(action.scoutId, outcome, input.clock.now());
        }
      }
      return { url: gmailDraftUrl(created.messageId, source.email), notice: staged.notice };
    },
    now: () => input.clock.now(),
  };
}

function replyLetter(
  action: { draftResponseText: string; otherBody: string; declineBody: string },
  variant: DraftVariant,
): string {
  if (variant === "other") {
    return action.otherBody;
  }
  if (variant === "decline") {
    return action.declineBody;
  }
  return action.draftResponseText;
}

function replyReferences(references: string, messageId: string): string {
  const parts = references.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  if (messageId !== "" && !parts.includes(messageId)) {
    parts.push(messageId);
  }
  return parts.join(" ");
}
