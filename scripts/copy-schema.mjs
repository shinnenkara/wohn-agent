import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/adapters/sqlite/migrations", { recursive: true });
cpSync(
  "src/adapters/sqlite/migrations/001_init.sql",
  "dist/adapters/sqlite/migrations/001_init.sql",
);
