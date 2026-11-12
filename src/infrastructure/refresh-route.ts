import { DatabaseSync } from "node:sqlite";
import { SqliteExposeRefresh } from "../adapters/sqlite/expose-refresh.js";
import type { SqliteProgressLog } from "../adapters/sqlite/progress-log.js";
import { lacksExposeFacts } from "../domain/listing.js";

export interface RefreshResponse {
  status: number;
  type: string;
  body: string;
}

export function queueExposeRefresh(
  progress: SqliteProgressLog,
  databasePath: string,
  id: string,
  at: Date,
): RefreshResponse {
  if (!/^\d{6,}$/.test(id)) {
    return text(400, "Unknown apartment");
  }
  const facts = progress.exposeFacts(id);
  if (!facts) {
    return text(404, "Unknown apartment");
  }
  if (!lacksExposeFacts(facts)) {
    return text(409, "This listing already has expose facts.");
  }
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const queued = new SqliteExposeRefresh(db).enqueue(id, at);
    if (!queued) {
      return text(503, "The refresh queue is not in this database yet. Run the agent or sync once, then try again.");
    }
  } finally {
    db.close();
  }
  return { status: 200, type: "application/json; charset=utf-8", body: JSON.stringify({ queued: true }) };
}

function text(status: number, body: string): RefreshResponse {
  return { status, type: "text/plain; charset=utf-8", body };
}
