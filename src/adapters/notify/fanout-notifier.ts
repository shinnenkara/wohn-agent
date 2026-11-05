import type { Alert, Notifier } from "../../application/ports/notifier.js";

export class FanoutNotifier implements Notifier {
  constructor(private readonly notifiers: readonly Notifier[]) {}

  async notify(alert: Alert): Promise<void> {
    for (const notifier of this.notifiers) {
      await notifier.notify(alert);
    }
  }
}
