import type { Logger } from "../../application/ports/logger.js";
import type { Notifier } from "../../application/ports/notifier.js";
import { FanoutNotifier } from "./fanout-notifier.js";
import { LoggingNotifier } from "./logging-notifier.js";
import type { NotifyCredentials } from "./notify-credentials.js";
import { RelayNotifier } from "./relay-notifier.js";

export const TELEGRAM_OFF_MESSAGE = "Telegram is off. Run npm run link.";

export function createNotifier(
  logger: Logger,
  notifyUrl: string,
  credentials: NotifyCredentials | null,
  fetchImpl: typeof fetch = fetch,
): Notifier {
  const logging = new LoggingNotifier(logger);
  if (notifyUrl && credentials) {
    return new FanoutNotifier([logging, new RelayNotifier(notifyUrl, credentials.deviceToken, fetchImpl)]);
  }
  if (notifyUrl) {
    logger.info(TELEGRAM_OFF_MESSAGE);
  }
  return logging;
}
