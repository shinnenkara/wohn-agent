import type { MailStore } from "./ports/mail-store.js";
import { planActions } from "../domain/mail-action.js";
import type { TriageDecision } from "../domain/triage.js";

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
}
