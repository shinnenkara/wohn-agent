import type { Alert, Notifier } from "../../application/ports/notifier.js";

export function relayEndpoint(notifyUrl: string, path: string): string {
  const url = new URL(notifyUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export class RelayNotifier implements Notifier {
  constructor(
    private readonly notifyUrl: string,
    private readonly deviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async notify(alert: Alert): Promise<void> {
    const response = await this.fetchImpl(relayEndpoint(this.notifyUrl, "/v1/alerts"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.deviceToken}`,
      },
      body: JSON.stringify(alert),
    });
    if (!response.ok) {
      throw new Error(`relay alert failed with ${response.status}`);
    }
  }
}
