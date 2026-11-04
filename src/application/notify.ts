import { errorMessage } from "./error-message.js";
import type { Logger } from "./ports/logger.js";
import type { Alert, Notifier } from "./ports/notifier.js";

export async function notifySafely(
  notifier: Notifier,
  logger: Logger,
  alert: Alert,
): Promise<void> {
  try {
    await notifier.notify(alert);
  } catch (error) {
    logger.error("alert failed", { type: alert.type, message: errorMessage(error) });
  }
}
