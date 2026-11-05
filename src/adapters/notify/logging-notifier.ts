import type { Logger } from "../../application/ports/logger.js";
import type { Alert, Notifier } from "../../application/ports/notifier.js";
import { formatAlert } from "./format-alert.js";

export class LoggingNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}

  async notify(alert: Alert): Promise<void> {
    this.logger.info(formatAlert(alert), { type: alert.type });
  }
}
