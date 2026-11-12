import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { loadDotEnv } from "../adapters/config/dotenv.js";
import { openReadOnlyDatabase } from "../adapters/sqlite/database.js";
import { SqliteMailStore } from "../adapters/sqlite/mail-store.js";
import { SqliteProgressLog } from "../adapters/sqlite/progress-log.js";
import { buildFlow } from "../domain/funnel.js";
import { isFunnelStage } from "../domain/progress.js";
import { linkUnlinkedMail } from "./link-route.js";
import { queueExposeRefresh } from "./refresh-route.js";
import { repairStoredAddresses } from "./repair-addresses.js";
import { repairStoredMailText } from "./repair-mail-text.js";
import { progressPage } from "./ui-page.js";

const PORT = 8787;

function main(): void {
  loadDotEnv();
  const databasePath = process.env.DATABASE_PATH?.trim() || "./data/wohn-agent.db";
  if (databasePath === ":memory:" || !existsSync(databasePath)) {
    process.stderr.write("No apartment database yet. Run npm run dev or npm run sync first.\n");
    process.exitCode = 1;
    return;
  }
  correctStoredAddresses(databasePath);
  correctStoredMail(databasePath);
  const db = openReadOnlyDatabase(databasePath);
  if (!hasProgressTable(db)) {
    db.close();
    process.stderr.write(
      "This database has no progress tables yet. Run npm run dev or npm run sync once, then npm run ui again.\n",
    );
    process.exitCode = 1;
    return;
  }
  const progress = new SqliteProgressLog(db);
  const mail = new SqliteMailStore(db);
  const server = createServer((request, response) => {
    void route(request, response, progress, mail, databasePath).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      if (!response.headersSent) {
        send(response, 500, "text/plain; charset=utf-8", "Could not read apartment progress.");
      }
    });
  });
  server.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`Apartment progress at http://127.0.0.1:${PORT}\n`);
  });
  const stop = () => {
    server.close();
    db.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  progress: SqliteProgressLog,
  mail: SqliteMailStore,
  databasePath: string,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/api/apartments/refresh") {
    refreshApartment(response, progress, databasePath, url.searchParams.get("id") ?? "");
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/unlinked/link") {
    await linkRequest(request, response, databasePath);
    return;
  }
  if (request.method !== "GET") {
    send(response, 405, "text/plain; charset=utf-8", "Method not allowed");
    return;
  }
  if (url.pathname === "/") {
    send(response, 200, "text/html; charset=utf-8", progressPage());
    return;
  }
  if (url.pathname === "/api/flow") {
    sendJson(response, buildFlow(progress.listStages(), progress.listTransitions()));
    return;
  }
  if (url.pathname === "/api/apartments/image") {
    const id = url.searchParams.get("id") ?? "";
    if (!/^\d{6,}$/.test(id)) {
      send(response, 400, "text/plain; charset=utf-8", "Unknown apartment");
      return;
    }
    const image = progress.readPreviewImage(id);
    if (!image) {
      send(response, 404, "text/plain; charset=utf-8", "No image");
      return;
    }
    response.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
    response.end(image);
    return;
  }
  if (url.pathname === "/api/apartments") {
    const stage = url.searchParams.get("stage") ?? "";
    if (!isFunnelStage(stage)) {
      send(response, 400, "text/plain; charset=utf-8", "Unknown stage");
      return;
    }
    sendJson(response, progress.listApartments(stage));
    return;
  }
  if (url.pathname === "/api/unlinked") {
    sendJson(response, {
      mail: mail.listUnlinkedMail(20),
      events: mail.listUnlinkedEvents(20),
    });
    return;
  }
  send(response, 404, "text/plain; charset=utf-8", "Not found");
}

async function linkRequest(request: IncomingMessage, response: ServerResponse, databasePath: string): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    send(response, 400, "text/plain; charset=utf-8", "Unknown mail");
    return;
  }
  const record = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const gmailId = typeof record.gmailId === "string" ? record.gmailId.trim() : "";
  const scoutId = typeof record.scoutId === "string" ? record.scoutId.trim() : "";
  const result = linkUnlinkedMail(databasePath, gmailId, scoutId, new Date());
  send(response, result.status, result.type, result.body);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 8192) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function refreshApartment(
  response: ServerResponse,
  progress: SqliteProgressLog,
  databasePath: string,
  id: string,
): void {
  const result = queueExposeRefresh(progress, databasePath, id, new Date());
  send(response, result.status, result.type, result.body);
}

function correctStoredAddresses(databasePath: string): void {
  try {
    const count = repairStoredAddresses(databasePath);
    if (count > 0) {
      const label = count === 1 ? "address" : "addresses";
      process.stdout.write(`Corrected ${count} apartment ${label}.\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not correct stored addresses: ${message}\n`);
  }
}

function correctStoredMail(databasePath: string): void {
  try {
    const count = repairStoredMailText(databasePath);
    if (count > 0) {
      const label = count === 1 ? "message" : "messages";
      process.stdout.write(`Corrected ${count} stored ${label}.\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not correct stored messages: ${message}\n`);
  }
}

function hasProgressTable(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'progress'").get();
  return row !== undefined;
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

function sendJson(response: ServerResponse, body: unknown): void {
  send(response, 200, "application/json; charset=utf-8", JSON.stringify(body));
}

main();
