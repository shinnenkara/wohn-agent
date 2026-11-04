import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
  return db;
}

function loadSchemaSql(): string {
  const url = new URL("./migrations/001_init.sql", import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}
