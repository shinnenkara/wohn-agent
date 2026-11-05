import type { DatabaseSync } from "node:sqlite";
import { loadProfile } from "../adapters/config/load-profile.js";
import type { RuntimeConfig } from "../adapters/config/env.js";
import { systemClock } from "../adapters/clock/system-clock.js";
import { NoopControl } from "../adapters/control/noop-control.js";
import { SqliteEventLog } from "../adapters/sqlite/event-log.js";
import { openDatabase } from "../adapters/sqlite/database.js";
import { SqliteListingRepository } from "../adapters/sqlite/listing-repository.js";
import { SqliteProgressLog } from "../adapters/sqlite/progress-log.js";
import { SqliteSelectorCache } from "../adapters/sqlite/selector-cache-repository.js";
import { createGeminiClassifier } from "../adapters/stagehand/rules-then-gemini-classifier.js";
import { StagehandBrowserSession } from "../adapters/stagehand/stagehand-browser.js";
import { createNotifier } from "../adapters/notify/create-notifier.js";
import { loadNotifyCredentials, NOTIFY_CREDENTIALS_PATH } from "../adapters/notify/notify-credentials.js";
import type { ControlChannel } from "../application/ports/control-channel.js";
import type { LoopDependencies } from "../application/run-agent-loop.js";
import { systemRandom } from "../domain/timing.js";
import { createLogger } from "./logger.js";

export interface Application {
  loop: LoopDependencies;
  control: ControlChannel;
  shutdown(): Promise<void>;
}

export async function compose(config: RuntimeConfig): Promise<Application> {
  const db = openDatabase(config.databasePath);
  try {
    return composeWith(config, db);
  } catch (error) {
    db.close();
    throw error;
  }
}

export function composeWith(config: RuntimeConfig, db: DatabaseSync): Application {
  const logger = createLogger(config.appEnv);
  const profile = loadProfile(config.applicantProfilePath);
  const control = new NoopControl();
  const credentials = config.notifyUrl ? loadNotifyCredentials(NOTIFY_CREDENTIALS_PATH) : null;
  const progress = new SqliteProgressLog(db);
  const backfilled = progress.backfillListings(systemClock.now());
  if (backfilled > 0) {
    logger.info("backfilled apartment progress", { count: backfilled });
  }
  const browser = new StagehandBrowserSession({
    cdpUrl: config.chromeCdpUrl,
    apiKey: config.googleApiKey,
    modelName: config.modelName,
  });
  const loop: LoopDependencies = {
    browser,
    listings: new SqliteListingRepository(db),
    selectors: new SqliteSelectorCache(db),
    events: new SqliteEventLog(db),
    notifier: createNotifier(logger, config.notifyUrl, credentials),
    classifier: createGeminiClassifier({
      apiKey: config.googleApiKey,
      modelName: config.modelName,
    }),
    control,
    clock: systemClock,
    random: systemRandom,
    logger,
    profile,
    maxApplicationsPerCycle: config.maxApplicationsPerCycle,
    dryRun: config.dryRun,
    overnightRun: config.overnightRun,
    progress,
  };
  return {
    loop,
    control,
    async shutdown() {
      await control.stop();
      await browser.disconnect();
      db.close();
    },
  };
}
