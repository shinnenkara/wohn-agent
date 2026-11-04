import type { DatabaseSync } from "node:sqlite";
import type { SelectorCache } from "../../application/ports/selector-cache.js";
import { DomainError } from "../../domain/domain-error.js";
import {
  isActionMethod,
  type SelectorCacheEntry,
} from "../../domain/selector-cache-entry.js";

interface SelectorRow {
  action_key: string;
  instruction: string;
  selector: string;
  method: string;
  fail_count: number | null;
  updated_at: string;
}

export class SqliteSelectorCache implements SelectorCache {
  constructor(private readonly db: DatabaseSync) {}

  get(actionKey: string): SelectorCacheEntry | null {
    const row = this.db
      .prepare("SELECT * FROM selector_cache WHERE action_key = ?")
      .get(actionKey) as SelectorRow | undefined;
    return row ? toEntry(row) : null;
  }

  upsert(entry: SelectorCacheEntry): void {
    this.db
      .prepare(`
        INSERT INTO selector_cache (
          action_key, instruction, selector, method, fail_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(action_key) DO UPDATE SET
          instruction = excluded.instruction,
          selector = excluded.selector,
          method = excluded.method,
          fail_count = excluded.fail_count,
          updated_at = excluded.updated_at
      `)
      .run(
        entry.actionKey,
        entry.instruction,
        entry.selector,
        entry.method,
        entry.failCount,
        entry.updatedAt.toISOString(),
      );
  }

  invalidate(actionKey: string): void {
    this.db.prepare("DELETE FROM selector_cache WHERE action_key = ?").run(actionKey);
  }

  recordFailure(actionKey: string): void {
    this.db
      .prepare(
        "UPDATE selector_cache SET fail_count = fail_count + 1, updated_at = ? WHERE action_key = ?",
      )
      .run(new Date().toISOString(), actionKey);
  }
}

function toEntry(row: SelectorRow): SelectorCacheEntry {
  if (!isActionMethod(row.method)) {
    throw new DomainError(`Unknown selector method ${row.method}`);
  }
  return {
    actionKey: row.action_key,
    instruction: row.instruction,
    selector: row.selector,
    method: row.method,
    failCount: row.fail_count ?? 0,
    updatedAt: new Date(row.updated_at),
  };
}
