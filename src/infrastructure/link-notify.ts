import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadRuntimeConfig } from "../adapters/config/env.js";
import { NOTIFY_CREDENTIALS_PATH } from "../adapters/notify/notify-credentials.js";
import { relayEndpoint } from "../adapters/notify/relay-notifier.js";

const LINK_TIMEOUT_MS = 5 * 60 * 1000;
const LINK_POLL_MS = 2_000;

const CreatedDeviceSchema = z.strictObject({
  deviceToken: z.string().min(1),
  startUrl: z.string().min(1),
});

const SessionSchema = z.strictObject({
  linked: z.boolean(),
});

export interface LinkNotifyOptions {
  notifyUrl: string;
  credentialsPath: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
}

export async function linkNotify(options: LinkNotifyOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? delay;
  const log = options.log ?? ((line: string) => process.stdout.write(line));
  const timeoutMs = options.timeoutMs ?? LINK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? LINK_POLL_MS;
  const now = options.now ?? Date.now;
  const created = await createDevice(options.notifyUrl, fetchImpl);
  log(`Open this link in Telegram and press Start:\n${created.startUrl}\n`);
  log("Waiting for Telegram...\n");
  const started = now();
  for (;;) {
    const linked = await readLinked(options.notifyUrl, created.deviceToken, fetchImpl);
    if (linked) {
      mkdirSync(dirname(options.credentialsPath), { recursive: true });
      writeFileSync(options.credentialsPath, `${JSON.stringify({ deviceToken: created.deviceToken }, null, 2)}\n`, "utf8");
      log("Connected. Alerts will go to that chat.\n");
      return;
    }
    if (now() - started >= timeoutMs) {
      throw new Error("Timed out waiting for Telegram. Run npm run link again.");
    }
    await sleep(pollMs);
  }
}

async function createDevice(notifyUrl: string, fetchImpl: typeof fetch): Promise<{ deviceToken: string; startUrl: string }> {
  const response = await fetchImpl(relayEndpoint(notifyUrl, "/v1/devices"), { method: "POST" });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: string };
      if (typeof body.detail === "string" && body.detail) {
        detail = `: ${body.detail}`;
      }
    } catch {
      detail = "";
    }
    throw new Error(`relay device registration failed with ${response.status}${detail}`);
  }
  const parsed = CreatedDeviceSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("relay device registration returned an unexpected body");
  }
  return parsed.data;
}

async function readLinked(notifyUrl: string, deviceToken: string, fetchImpl: typeof fetch): Promise<boolean> {
  const response = await fetchImpl(relayEndpoint(notifyUrl, "/v1/session"), {
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  if (response.status === 401) {
    throw new Error("relay rejected the device token");
  }
  if (!response.ok) {
    throw new Error(`relay session failed with ${response.status}`);
  }
  const parsed = SessionSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("relay session returned an unexpected body");
  }
  return parsed.data.linked;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  await linkNotify({ notifyUrl: config.notifyUrl, credentialsPath: NOTIFY_CREDENTIALS_PATH });
}

if (invokedDirectly()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
