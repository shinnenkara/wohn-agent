import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(loadSchemaSql());
  ensureListingColumns(db);
  ensureMailColumns(db);
  return db;
}

export function openReadOnlyDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA query_only = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

function loadSchemaSql(): string {
  const dir = fileURLToPath(new URL("./migrations/", import.meta.url));
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

const LISTING_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["address", "TEXT"],
  ["price_warm", "REAL"],
  ["extra_costs", "REAL"],
  ["deposit", "TEXT"],
  ["floor", "TEXT"],
  ["move_in", "TEXT"],
  ["description", "TEXT"],
  ["snapshot", "TEXT"],
  ["energy_class", "TEXT"],
  ["preview_image", "BLOB"],
];

const MAIL_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["message_id", "TEXT NOT NULL DEFAULT ''"],
  ["reply_to", "TEXT NOT NULL DEFAULT ''"],
];

function ensureMailColumns(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA table_info(mail)").all() as Array<{ name: string }>;
  if (rows.length === 0) {
    return;
  }
  const names = new Set(rows.map((row) => row.name));
  for (const [name, type] of MAIL_COLUMNS) {
    if (!names.has(name)) {
      db.exec(`ALTER TABLE mail ADD COLUMN ${name} ${type}`);
    }
  }
}

function ensureListingColumns(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA table_info(listings)").all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  for (const [name, type] of LISTING_COLUMNS) {
    if (!names.has(name)) {
      db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${type}`);
    }
  }
}
