import { DatabaseSync } from "node:sqlite";
import { stripQuotedReply } from "../domain/strip-reply.js";

interface MailTextRow {
  gmail_id: string;
  body_text: string;
  body_html: string;
  clean_delta_text: string;
}

export function repairStoredMailText(databasePath: string): number {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    if (!hasCleanText(db)) {
      return 0;
    }
    const rows = db
      .prepare("SELECT gmail_id, body_text, body_html, clean_delta_text FROM mail")
      .all() as MailTextRow[];
    const update = db.prepare("UPDATE mail SET clean_delta_text = ? WHERE gmail_id = ?");
    db.exec("BEGIN");
    try {
      let count = 0;
      for (const row of rows) {
        const next = stripQuotedReply(row.body_text, row.body_html);
        if (next === row.clean_delta_text) {
          continue;
        }
        update.run(next, row.gmail_id);
        count += 1;
      }
      db.exec("COMMIT");
      return count;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

function hasCleanText(db: DatabaseSync): boolean {
  const rows = db.prepare("PRAGMA table_info(mail)").all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return names.has("gmail_id") && names.has("body_text") && names.has("body_html") && names.has("clean_delta_text");
}
