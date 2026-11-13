import { erasureDue, erasureLetter } from "../domain/erasure.js";
import { gmailInboxUrl } from "../domain/gmail-url.js";
import type { MailStore } from "./ports/mail-store.js";

const DOCUMENT_ACTIONS = new Set(["SEND_DOCUMENTS", "SEND_DISCLOSURE"]);

export function noteDocumentCompleted(mail: MailStore, actionId: number, at: Date): void {
  const action = mail.listActions().find((row) => row.id === actionId);
  if (!action || action.scoutId === "" || !DOCUMENT_ACTIONS.has(action.actionCode)) {
    return;
  }
  mail.recordSubmission(action.scoutId, action.mailId, at);
  const rejection = mail.rejectionMailId(action.scoutId);
  if (rejection) {
    queueErasure(mail, { scoutId: action.scoutId, rejectionMailId: rejection, now: at });
  }
}

export function noteRejection(mail: MailStore, scoutId: string, mailId: string, at: Date): void {
  queueErasure(mail, { scoutId, rejectionMailId: mailId, now: at });
}

export function queueErasure(
  mail: MailStore,
  input: { scoutId: string; rejectionMailId: string; now: Date },
): void {
  if (input.scoutId === "" || mail.hasErasure(input.scoutId)) {
    return;
  }
  const submission = mail.submissionOf(input.scoutId);
  if (!submission) {
    return;
  }
  const completedAt = new Date(submission.completedAt);
  const source = mail.replySource(input.rejectionMailId);
  mail.insertAction({
    scoutId: input.scoutId,
    mailId: input.rejectionMailId,
    intentCode: "REQUEST_ERASURE",
    actionCode: "REQUEST_ERASURE",
    status: "SCHEDULED",
    priority: "P3_SILENT",
    actionUrl: gmailInboxUrl(input.rejectionMailId, source?.email ?? null),
    draftResponseText: erasureLetter({
      from: source?.from ?? "",
      address: mail.listingAddress(input.scoutId),
      submittedAt: completedAt,
    }),
    deadlineAt: erasureDue(completedAt).toISOString(),
    createdAt: input.now,
  });
}
