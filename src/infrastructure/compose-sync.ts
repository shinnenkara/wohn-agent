import { SHARED_GOOGLE_URL, type GoogleConfig } from "../adapters/config/google-env.js";
import { systemClock } from "../adapters/clock/system-clock.js";
import { createAuthorizer } from "../adapters/google/authorizer.js";
import { CalendarAgenda } from "../adapters/google/calendar-client.js";
import { GOOGLE_CREDENTIALS_PATH, loadGoogleCredentials } from "../adapters/google/google-credentials.js";
import { GeminiMailReader } from "../adapters/google/gemini-reader.js";
import { GmailMailbox } from "../adapters/google/gmail-client.js";
import { SqliteAccountStore } from "../adapters/sqlite/account-store.js";
import { openDatabase } from "../adapters/sqlite/database.js";
import { SqliteMailStore } from "../adapters/sqlite/mail-store.js";
import { SqliteProgressLog } from "../adapters/sqlite/progress-log.js";
import { syncInbox, type SyncResult } from "../application/sync-inbox.js";
import { syncSince } from "../domain/google-window.js";

export interface SyncApplication {
  backfilled: number;
  run(since?: Date): Promise<SyncResult>;
  shutdown(): void;
}

export function composeSync(config: GoogleConfig): SyncApplication {
  const credentials = loadGoogleCredentials(GOOGLE_CREDENTIALS_PATH);
  if (!credentials) {
    throw new Error("Google is not connected. Run npm run login.");
  }
  const db = openDatabase(config.databasePath);
  const accounts = new SqliteAccountStore(db);
  const progress = new SqliteProgressLog(db);
  const backfilled = progress.backfillListings(systemClock.now());
  const authorizer = createAuthorizer({
    googleUrl: SHARED_GOOGLE_URL,
    deviceToken: credentials.deviceToken,
    fetchImpl: fetch,
    now: () => systemClock.now(),
  });
  const reader = config.geminiApiKey
    ? new GeminiMailReader(config.geminiApiKey, config.geminiModel, fetch)
    : null;
  return {
    backfilled,
    run(since?: Date) {
      return syncInbox(
        {
          accounts,
          mailbox: new GmailMailbox(authorizer, fetch),
          agenda: new CalendarAgenda(authorizer, fetch),
          mail: new SqliteMailStore(db),
          progress,
          reader,
          clock: systemClock,
          model: config.geminiModel,
        },
        {
          since: since ?? syncSince(systemClock.now()),
          till: null,
          updateCursors: true,
          mailCap: -1,
          eventCap: -1,
        },
      );
    },
    shutdown() {
      db.close();
    },
  };
}
