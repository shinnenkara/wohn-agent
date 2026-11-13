import type { DocumentCode } from "../../domain/triage.js";

export interface VaultRead {
  code: DocumentCode;
  bytes: Uint8Array | null;
}

export interface DocumentVault {
  read(codes: readonly DocumentCode[]): VaultRead[];
}
