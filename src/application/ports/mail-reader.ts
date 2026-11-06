import type { MailProposal } from "../../domain/mail-citation.js";

export interface MailInterpretation {
  proposal: MailProposal;
  intent: string;
  relation: string;
  evidence: string;
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
}
