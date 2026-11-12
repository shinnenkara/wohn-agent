import { loadGoogleConfig } from "../adapters/config/google-env.js";
import { formatSyncResult, SYNC_WATCH_MS, syncHasNews } from "../application/sync-inbox.js";
import { formatDay, parseSinceFlag } from "../domain/google-window.js";
import { composeSync, type SyncApplication } from "./compose-sync.js";

async function main(): Promise<void> {
  const since = parseSinceFlag(process.argv);
  const watch = process.argv.includes("--watch");
  const app = composeSync(loadGoogleConfig());
  if (since) {
    process.stdout.write(`Since ${formatDay(since)}.\n`);
  }
  if (app.backfilled > 0) {
    process.stdout.write(`Backfilled ${app.backfilled} apartments.\n`);
  }
  if (watch) {
    await runWatch(app, since ?? undefined);
    return;
  }
  try {
    const result = await app.run(since ?? undefined);
    process.stdout.write(`${formatSyncResult(result)}\n`);
  } finally {
    app.shutdown();
  }
}

async function runWatch(app: SyncApplication, since: Date | undefined): Promise<void> {
  let running = false;
  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    app.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const tick = async () => {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      const result = await app.run(since);
      if (syncHasNews(result)) {
        process.stdout.write(`${formatSyncResult(result)}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(() => {
    void tick();
  }, SYNC_WATCH_MS);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
