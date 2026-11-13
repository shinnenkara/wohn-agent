import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentVault, VaultRead } from "../../application/ports/document-vault.js";
import { VAULT_FILES } from "../../domain/document-bundle.js";
import type { DocumentCode } from "../../domain/triage.js";

export class FsDocumentVault implements DocumentVault {
  constructor(private readonly directory: string) {}

  read(codes: readonly DocumentCode[]): VaultRead[] {
    return codes.map((code) => ({ code, bytes: readVaultFile(this.directory, VAULT_FILES[code]) }));
  }
}

function readVaultFile(directory: string, name: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(join(directory, name)));
  } catch {
    return null;
  }
}
