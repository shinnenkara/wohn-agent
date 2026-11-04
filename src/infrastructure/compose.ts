import type { DatabaseSync } from "node:sqlite";
import { loadProfile } from "../adapters/config/load-profile.js";
import type { RuntimeConfig } from "../adapters/config/env.js";
import { systemClock } from "../adapters/clock/system-clock.js";
import { SqliteEventLog } from "../adapters/sqlite/event-log.js";
import { openDatabase } from "../adapters/sqlite/database.js";
import { SqliteListingRepository } from "../adapters/sqlite/listing-repository.js";
import { SqliteSelectorCache } from "../adapters/sqlite/selector-cache-repository.js";
import { createGeminiClassifier } from "../adapters/stagehand/rules-then-gemini-classifier.js";
import { StagehandBrowserSession } from "../adapters/stagehand/stagehand-browser.js";
import { TelegramControl } from "../adapters/telegram/telegram-notifier.js";
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
  const telegram = new TelegramControl(config.telegramBotToken, config.telegramChatId, fetch, logger);
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
    notifier: telegram,
    classifier: createGeminiClassifier({
      apiKey: config.googleApiKey,
      modelName: config.modelName,
    }),
    control: telegram,
    clock: systemClock,
    random: systemRandom,
    logger,
    profile,
    maxApplicationsPerCycle: config.maxApplicationsPerCycle,
    dryRun: config.dryRun,
    overnightRun: config.overnightRun,
  };
  return {
    loop,
    control: telegram,
    async shutdown() {
      await telegram.stop();
      await browser.disconnect();
      db.close();
    },
  };
}
