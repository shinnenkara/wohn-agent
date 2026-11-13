import type { MailStore } from "./ports/mail-store.js";
import { planActions } from "../domain/mail-action.js";
import { decisionFromStored, type TriageDecision } from "../domain/triage.js";
import { noteRejection } from "./queue-erasure.js";

export function materializeActions(
  mail: MailStore,
  input: {
    scoutId: string;
    mailId: string;
    sentAt: string;
    accountEmail: string | null;
    draftBody: string;
    decision: TriageDecision;
    createdAt: Date;
  },
): void {
  if (input.scoutId !== "" && mail.isQuarantined(input.scoutId)) {
    return;
  }
  const planned = planActions({
    scoutId: input.scoutId,
    mailId: input.mailId,
    sentAt: input.sentAt,
    accountEmail: input.accountEmail,
    draftBody: input.draftBody,
    blocked: input.decision.blocked,
    intents: input.decision.intents,
  });
  if (planned.supersede) {
    mail.supersedeOpen(input.scoutId, input.mailId);
  }
  for (const action of planned.actions) {
    mail.insertAction({
      ...action,
      status: "PENDING",
      createdAt: input.createdAt,
    });
  }
  if (!input.decision.blocked && input.scoutId !== "" && input.decision.intents.some((intent) => intent.code === "REJECTION")) {
    noteRejection(mail, input.scoutId, input.mailId, input.createdAt);
  }
}

export function applyStoredTriage(
  mail: MailStore,
  input: { gmailId: string; scoutId: string; at: Date },
): void {
  mail.attachActions(input.gmailId, input.scoutId);
  const stored = mail.loadStoredTriage(input.gmailId);
  if (!stored) {
    return;
  }
  materializeActions(mail, {
    scoutId: input.scoutId,
    mailId: input.gmailId,
    sentAt: mail.sentAt(input.gmailId) ?? input.at.toISOString(),
    accountEmail: mail.replySource(input.gmailId)?.email ?? null,
    draftBody: stored.draftBody,
    decision: decisionFromStored(stored),
    createdAt: input.at,
  });
}
