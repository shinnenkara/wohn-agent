import type { ProposedLeaseFacts } from "../../domain/lease-audit.js";

export interface LeaseFactReader {
  read(contractText: string): Promise<ProposedLeaseFacts>;
}
