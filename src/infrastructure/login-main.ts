import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { systemClock } from "../adapters/clock/system-clock.js";
import { loadGoogleConfig, SHARED_GOOGLE_URL } from "../adapters/config/google-env.js";
import { GOOGLE_CREDENTIALS_PATH, googleEndpoint } from "../adapters/google/google-credentials.js";
import { SqliteAccountStore } from "../adapters/sqlite/account-store.js";
import { openDatabase } from "../adapters/sqlite/database.js";

const LINK_TIMEOUT_MS = 5 * 60 * 1000;
const LINK_POLL_MS = 2_000;

const CreatedDeviceSchema = z.strictObject({
  deviceToken: z.string().min(1),
  startUrl: z.string().min(1),
});

const SessionSchema = z.union([
  z.strictObject({ linked: z.literal(false), email: z.null() }),
  z.strictObject({ linked: z.literal(true), email: z.string().min(1) }),
]);

export interface LinkGoogleOptions {
  googleUrl: string;
  credentialsPath: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  open?: (url: string) => void;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  saveAccount: (email: string) => void;
}

export async function linkGoogle(options: LinkGoogleOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? delay;
  const log = options.log ?? ((line: string) => process.stdout.write(line));
  const open = options.open ?? openBrowser;
  const timeoutMs = options.timeoutMs ?? LINK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? LINK_POLL_MS;
  const now = options.now ?? Date.now;
  const created = await createDevice(options.googleUrl, fetchImpl);
  log(`Open this page and sign in with Google:\n${created.startUrl}\n`);
  log("Waiting for Google...\n");
  open(created.startUrl);
  const started = now();
  for (;;) {
    const session = await readSession(options.googleUrl, created.deviceToken, fetchImpl);
    if (session.linked) {
      options.saveAccount(session.email);
      mkdirSync(dirname(options.credentialsPath), { recursive: true });
      writeFileSync(
        options.credentialsPath,
        `${JSON.stringify({ deviceToken: created.deviceToken }, null, 2)}\n`,
        "utf8",
      );
      log(`Connected ${session.email}\n`);
      return;
    }
    if (now() - started >= timeoutMs) {
      throw new Error("Timed out waiting for Google. Run npm run login again.");
    }
    await sleep(pollMs);
  }
}

async function createDevice(
  googleUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ deviceToken: string; startUrl: string }> {
  const response = await fetchImpl(googleEndpoint(googleUrl, "/v1/devices"), { method: "POST" });
  if (!response.ok) {
    throw new Error(`google login registration failed with ${response.status}`);
  }
  const parsed = CreatedDeviceSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("google login registration returned an unexpected body");
  }
  return parsed.data;
}

async function readSession(
  googleUrl: string,
  deviceToken: string,
  fetchImpl: typeof fetch,
): Promise<{ linked: true; email: string } | { linked: false; email: null }> {
  const response = await fetchImpl(googleEndpoint(googleUrl, "/v1/session"), {
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  if (response.status === 401) {
    throw new Error("google login rejected the device token");
  }
  if (!response.ok) {
    throw new Error(`google login session failed with ${response.status}`);
  }
  const parsed = SessionSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("google login session returned an unexpected body");
  }
  return parsed.data;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {
    process.stdout.write(`Open this URL to log in:\n${url}\n`);
  });
  child.unref();
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  const config = loadGoogleConfig();
  await linkGoogle({
    googleUrl: SHARED_GOOGLE_URL,
    credentialsPath: GOOGLE_CREDENTIALS_PATH,
    saveAccount(email) {
      const db = openDatabase(config.databasePath);
      try {
        new SqliteAccountStore(db).saveLogin({ email, connectedAt: systemClock.now() });
      } finally {
        db.close();
      }
    },
  });
}

if (invokedDirectly()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
