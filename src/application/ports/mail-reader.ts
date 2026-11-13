import type { MailProposal } from "../../domain/mail-citation.js";
import type { FunnelStage } from "../../domain/progress.js";
import type { ProposedTriage } from "../../domain/triage.js";

export interface MailInterpretation {
  proposal: MailProposal;
  intent: string;
  relation: string;
  evidence: string;
}

export interface MailTriageInput {
  subject: string;
  body: string;
  stage: FunnelStage | null;
  outbound: boolean;
}

export class MailReaderRateLimit extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("gemini rate limit");
    this.name = "MailReaderRateLimit";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface MailReader {
  propose(subject: string, body: string): Promise<MailInterpretation>;
  triage?(input: MailTriageInput): Promise<ProposedTriage>;
}
