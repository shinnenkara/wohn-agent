import type { DatabaseSync } from "node:sqlite";
import { SqliteListingRepository } from "../adapters/sqlite/listing-repository.js";
import { SqliteMailStore } from "../adapters/sqlite/mail-store.js";
import { SqliteProgressLog } from "../adapters/sqlite/progress-log.js";
import { openDatabase } from "../adapters/sqlite/database.js";
import { assignMail } from "../application/assign-mail.js";

export interface LinkResponse {
  status: number;
  type: string;
  body: string;
}

export function linkUnlinkedMail(databasePath: string, gmailId: string, scoutId: string, at: Date): LinkResponse {
  if (!/^[\w-]{1,128}$/.test(gmailId)) {
    return text(400, "Unknown mail");
  }
  if (!/^\d{5,}$/.test(scoutId)) {
    return text(400, "Unknown apartment");
  }
  const db = openDatabase(databasePath);
  try {
    return linkIn(db, gmailId, scoutId, at);
  } finally {
    db.close();
  }
}

function linkIn(db: DatabaseSync, gmailId: string, scoutId: string, at: Date): LinkResponse {
  const listings = new SqliteListingRepository(db);
  if (!listings.findById(scoutId)) {
    return text(404, "Unknown apartment");
  }
  const mail = new SqliteMailStore(db);
  const row = mail.findMail(gmailId);
  if (!row || row.scoutId) {
    return text(404, "Unknown mail");
  }
  const progress = new SqliteProgressLog(db);
  const moved = assignMail(
    { mail, progress, clock: { now: () => at, sleep: async () => undefined } },
    {
      gmailId: row.gmailId,
      threadId: row.threadId,
      from: row.from,
      subject: row.subject,
      kind: row.kind,
      scoutId,
      method: "manual",
    },
  );
  return {
    status: 200,
    type: "application/json; charset=utf-8",
    body: JSON.stringify({ linked: true, advanced: moved > 0 }),
  };
}

function text(status: number, body: string): LinkResponse {
  return { status, type: "text/plain; charset=utf-8", body };
}
