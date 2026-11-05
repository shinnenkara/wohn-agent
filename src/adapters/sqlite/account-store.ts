import type { DatabaseSync } from "node:sqlite";
import type { AccountStore, GoogleAccount } from "../../application/ports/account-store.js";

interface AccountRow {
  email: string;
  token_json: string;
  gmail_history_id: string | null;
  calendar_sync_token: string | null;
}

export class SqliteAccountStore implements AccountStore {
  constructor(private readonly db: DatabaseSync) {}

  load(): GoogleAccount | null {
    const row = this.db
      .prepare(
        "SELECT email, token_json, gmail_history_id, calendar_sync_token FROM google_account WHERE id = 1",
      )
      .get() as AccountRow | undefined;
    if (!row) {
      return null;
    }
    return {
      email: row.email,
      tokenJson: row.token_json,
      gmailHistoryId: row.gmail_history_id,
      calendarSyncToken: row.calendar_sync_token,
    };
  }

  saveLogin(input: { email: string; tokenJson: string; connectedAt: Date }): void {
    this.db
      .prepare(
        `INSERT INTO google_account (id, email, token_json, connected_at, gmail_history_id, calendar_sync_token)
         VALUES (1, ?, ?, ?, NULL, NULL)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           token_json = excluded.token_json,
           connected_at = excluded.connected_at`,
      )
      .run(input.email, input.tokenJson, input.connectedAt.toISOString());
  }

  saveToken(tokenJson: string): void {
    this.db.prepare("UPDATE google_account SET token_json = ? WHERE id = 1").run(tokenJson);
  }

  saveGmailHistory(historyId: string): void {
    this.db.prepare("UPDATE google_account SET gmail_history_id = ? WHERE id = 1").run(historyId);
  }

  saveCalendarToken(token: string): void {
    this.db.prepare("UPDATE google_account SET calendar_sync_token = ? WHERE id = 1").run(token);
  }
}
