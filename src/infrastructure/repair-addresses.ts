import { DatabaseSync } from "node:sqlite";
import { addressFrom, looksLikeAddress } from "../adapters/stagehand/parse-listing-text.js";

interface AddressRow {
  scout_id: string;
  address: string | null;
  snapshot: string | null;
}

export function repairStoredAddresses(databasePath: string): number {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    if (!hasAddressColumns(db)) {
      return 0;
    }
    const rows = db
      .prepare(
        `SELECT scout_id, address, snapshot
         FROM listings
         WHERE snapshot IS NOT NULL AND trim(snapshot) != ''`,
      )
      .all() as AddressRow[];
    const update = db.prepare(`UPDATE listings SET address = ? WHERE scout_id = ?`);
    db.exec("BEGIN");
    try {
      let count = 0;
      for (const row of rows) {
        if (looksLikeAddress(row.address ?? "")) {
          continue;
        }
        const next = addressFrom(row.snapshot ?? "");
        if (!next || next === row.address) {
          continue;
        }
        update.run(next, row.scout_id);
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

function hasAddressColumns(db: DatabaseSync): boolean {
  const rows = db.prepare("PRAGMA table_info(listings)").all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return names.has("scout_id") && names.has("address") && names.has("snapshot");
}
