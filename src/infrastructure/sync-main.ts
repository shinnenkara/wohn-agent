import { loadGoogleConfig } from "../adapters/config/google-env.js";
import { formatSyncResult } from "../application/sync-inbox.js";
import { formatDay, parseSinceFlag } from "../domain/google-window.js";
import { composeSync } from "./compose-sync.js";

async function main(): Promise<void> {
  const since = parseSinceFlag(process.argv);
  const app = composeSync(loadGoogleConfig());
  try {
    if (since) {
      process.stdout.write(`Since ${formatDay(since)}.\n`);
    }
    if (app.backfilled > 0) {
      process.stdout.write(`Backfilled ${app.backfilled} apartments.\n`);
    }
    const result = await app.run(since ?? undefined);
    process.stdout.write(`${formatSyncResult(result)}\n`);
  } finally {
    app.shutdown();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
