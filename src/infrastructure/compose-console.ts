import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { systemClock } from "../adapters/clock/system-clock.js";
import { SHARED_GOOGLE_URL, type GoogleConfig } from "../adapters/config/google-env.js";
import { createAuthorizer } from "../adapters/google/authorizer.js";
import { GmailDraftError, GmailDraftWriter } from "../adapters/google/gmail-draft.js";
import { GOOGLE_CREDENTIALS_PATH, loadGoogleCredentials } from "../adapters/google/google-credentials.js";
import { openDatabase } from "../adapters/sqlite/database.js";
import { SqliteMailStore } from "../adapters/sqlite/mail-store.js";
import type { DraftWriter } from "../application/ports/draft-writer.js";
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
  return {
    session: createConsoleSession({
      mail,
      drafts: draftWriter(),
      clock: systemClock,
      open: openBrowser,
    }),
    shutdown() {
      db.close();
    },
  };
}

function draftWriter(): DraftWriter {
  const credentials = loadGoogleCredentials(GOOGLE_CREDENTIALS_PATH);
  if (!credentials) {
    return {
      async createReply() {
        throw new GmailDraftError("Google is not connected. Run npm run login.");
      },
    };
  }
  const authorizer = createAuthorizer({
    googleUrl: SHARED_GOOGLE_URL,
    deviceToken: credentials.deviceToken,
    fetchImpl: fetch,
    now: () => systemClock.now(),
  });
  return new GmailDraftWriter(authorizer, fetch);
}

function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {
    process.stdout.write(`Open this URL:\n${url}\n`);
  });
  child.unref();
}
