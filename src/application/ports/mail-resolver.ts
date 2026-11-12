import type { MailCandidate } from "../../domain/mail-link.js";

export interface MailResolveInput {
  subject: string;
  body: string;
  candidates: readonly MailCandidate[];
}

export interface MailResolver {
  resolve(input: MailResolveInput): Promise<string | null>;
}
