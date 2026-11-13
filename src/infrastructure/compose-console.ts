import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { systemClock } from "../adapters/clock/system-clock.js";
import { SHARED_GOOGLE_URL, type GoogleConfig } from "../adapters/config/google-env.js";
import { loadProfile } from "../adapters/config/load-profile.js";
import { createAuthorizer } from "../adapters/google/authorizer.js";
import { GmailAttachmentSource } from "../adapters/google/gmail-attachments.js";
import { GmailDraftError, GmailDraftWriter } from "../adapters/google/gmail-draft.js";
import { GeminiLeaseReader } from "../adapters/google/lease-reader.js";
import { GOOGLE_CREDENTIALS_PATH, loadGoogleCredentials } from "../adapters/google/google-credentials.js";
import { notoSansBytes } from "../adapters/pdf/font-file.js";
import { PdfLibFormFiller } from "../adapters/pdf/form-filler.js";
import { PdfLibCompiler } from "../adapters/pdf/pdf-compiler.js";
import { extractPdfText } from "../adapters/pdf/pdf-text.js";
import { openDatabase } from "../adapters/sqlite/database.js";
import { SqliteMailStore } from "../adapters/sqlite/mail-store.js";
import { SqliteProgressLog } from "../adapters/sqlite/progress-log.js";
import { FsDocumentVault } from "../adapters/vault/fs-document-vault.js";
import type { DraftWriter } from "../application/ports/draft-writer.js";
import type { LeaseFactReader } from "../application/ports/lease-reader.js";
import type { MailAttachmentSource } from "../application/ports/mail-attachments.js";
import type { ApplicantProfile } from "../domain/applicant-profile.js";
import { createConsoleSession, type ConsoleSession } from "./console-loop.js";

export interface ConsoleApplication {
  session: ConsoleSession;
  shutdown(): void;
}

export function composeConsole(config: GoogleConfig): ConsoleApplication {
  if (config.databasePath === ":memory:" || !existsSync(config.databasePath)) {
    throw new Error("No apartment database yet. Run npm run dev or npm run sync first.");
  }
  const db = openDatabase(config.databasePath);
  const mail = new SqliteMailStore(db);
  const google = googleClient();
  const font = notoSansBytes();
  return {
    session: createConsoleSession({
      mail,
      progress: new SqliteProgressLog(db),
      drafts: google.drafts,
      clock: systemClock,
      documents: {
        vault: new FsDocumentVault(vaultDir(config.databasePath)),
        compiler: new PdfLibCompiler(font),
      },
      disclosure: {
        attachments: google.attachments,
        forms: new PdfLibFormFiller(font),
        profile: loadApplicant(),
      },
      lease: {
        reader: leaseReader(config),
        extractText: extractPdfText,
      },
    }),
    shutdown() {
      db.close();
    },
  };
}

function googleClient(): { drafts: DraftWriter; attachments: MailAttachmentSource } {
  const credentials = loadGoogleCredentials(GOOGLE_CREDENTIALS_PATH);
  if (!credentials) {
    const disconnected = async (): Promise<never> => {
      throw new GmailDraftError("Google is not connected. Run npm run login.");
    };
    return {
      drafts: { createReply: disconnected },
      attachments: { listPdfs: disconnected, download: disconnected },
    };
  }
  const authorizer = createAuthorizer({
    googleUrl: SHARED_GOOGLE_URL,
    deviceToken: credentials.deviceToken,
    fetchImpl: fetch,
    now: () => systemClock.now(),
  });
  return {
    drafts: new GmailDraftWriter(authorizer, fetch),
    attachments: new GmailAttachmentSource(authorizer, fetch),
  };
}

function leaseReader(config: GoogleConfig): LeaseFactReader | null {
  if (!config.geminiApiKey) {
    return null;
  }
  return new GeminiLeaseReader(config.geminiApiKey, config.leaseModel, fetch);
}

function loadApplicant(): ApplicantProfile | null {
  const path = process.env.APPLICANT_PROFILE_PATH?.trim() || "./applicant_profile.json";
  try {
    return loadProfile(path);
  } catch {
    return null;
  }
}

function vaultDir(databasePath: string): string {
  const override = process.env.VAULT_DIR?.trim();
  if (override) {
    return override;
  }
  return join(dirname(databasePath), "vault");
}
