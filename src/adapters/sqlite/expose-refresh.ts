import type { DatabaseSync } from "node:sqlite";
import type { ExposeRefreshQueue } from "../../application/ports/expose-refresh.js";

export class SqliteExposeRefresh implements ExposeRefreshQueue {
  constructor(private readonly db: DatabaseSync) {}

  enqueue(scoutId: string, at: Date): boolean {
    if (!this.tableExists()) {
      return false;
    }
    this.db
      .prepare(
        `INSERT INTO expose_refresh (scout_id, state, detail, requested_at)
         VALUES (?, 'queued', '', ?)
         ON CONFLICT(scout_id) DO UPDATE SET
           state = 'queued',
           detail = '',
           requested_at = excluded.requested_at`,
      )
      .run(scoutId, at.toISOString());
    return true;
  }

  next(): string | null {
    if (!this.tableExists()) {
      return null;
    }
    const row = this.db
      .prepare(
        "SELECT scout_id FROM expose_refresh WHERE state = 'queued' ORDER BY requested_at, scout_id LIMIT 1",
      )
      .get() as { scout_id: string } | undefined;
    return row?.scout_id ?? null;
  }

  finish(scoutId: string): void {
    if (!this.tableExists()) {
      return;
    }
    this.db.prepare("DELETE FROM expose_refresh WHERE scout_id = ?").run(scoutId);
  }

  fail(scoutId: string, detail: string): void {
    if (!this.tableExists()) {
      return;
    }
    this.db
      .prepare("UPDATE expose_refresh SET state = 'failed', detail = ? WHERE scout_id = ?")
      .run(detail.slice(0, 200), scoutId);
  }

  private tableExists(): boolean {
    const row = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'expose_refresh'").get();
    return row !== undefined;
  }
}
