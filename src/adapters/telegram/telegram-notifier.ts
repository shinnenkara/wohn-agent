import type { ControlChannel } from "../../application/ports/control-channel.js";
import type { Logger } from "../../application/ports/logger.js";
import type { Alert, Notifier } from "../../application/ports/notifier.js";

export const CAPTCHA_ALERT_TEXT =
  "🚨 CAPTCHA triggered on ImmoScout24. Loop paused. Solve it in the local Chrome window to resume.";

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number } };
}

interface TelegramResponse {
  ok: boolean;
  result?: TelegramUpdate[];
}

export function formatAlert(alert: Alert): string {
  switch (alert.type) {
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED on ImmoScout24. Log in again in the local Chrome window to resume.";
    case "CAPTCHA_OPEN":
      return CAPTCHA_ALERT_TEXT;
    case "APPLIED":
      return `Applied to ${alert.title} (${alert.scoutId})\n${alert.url}`;
    case "MANUAL_REQUIRED":
      return `MANUAL_REQUIRED ${alert.scoutId}: ${alert.reason}\n${alert.url}`;
  }
}

export class TelegramControl implements Notifier, ControlChannel {
  private offset = 0;
  private resume = false;
  private running = false;
  private abort = new AbortController();
  private pollPromise: Promise<void> | null = null;

  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly logger?: Logger,
  ) {}

  async notify(alert: Alert): Promise<void> {
    const response = await this.fetchImpl(`${this.endpoint}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: formatAlert(alert) }),
    });
    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with ${response.status}`);
    }
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.abort = new AbortController();
    this.pollPromise = this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort.abort();
    await this.pollPromise?.catch(() => undefined);
    this.pollPromise = null;
  }

  resumeRequested(): boolean {
    return this.resume;
  }

  consumeResume(): boolean {
    if (!this.resume) {
      return false;
    }
    this.resume = false;
    return true;
  }

  private get endpoint(): string {
    return `https://api.telegram.org/bot${this.token}`;
  }

  private async poll(): Promise<void> {
    await this.skipPending();
    while (this.running) {
      try {
        const updates = await this.getUpdates(this.offset, 25);
        this.consume(updates);
      } catch (error) {
        if (!this.running || this.abort.signal.aborted) {
          return;
        }
        this.logger?.error("telegram poll failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        await delay(5_000, this.abort.signal);
      }
    }
  }

  private async skipPending(): Promise<void> {
    try {
      for (let batch = 0; batch < 5; batch += 1) {
        const updates = await this.getUpdates(this.offset, 0);
        if (updates.length === 0) {
          return;
        }
        this.consume(updates, false);
      }
    } catch (error) {
      this.logger?.error("telegram backlog skip failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private consume(updates: readonly TelegramUpdate[], acceptResume = true): void {
    for (const update of updates) {
      this.offset = update.update_id + 1;
      if (!acceptResume) {
        continue;
      }
      const text = update.message?.text?.trim() ?? "";
      const chatId = update.message?.chat?.id;
      if (chatId !== undefined && String(chatId) === this.chatId && /^\/resume(?:@\w+)?(?:\s|$)/.test(text)) {
        this.resume = true;
      }
    }
  }

  private async getUpdates(offset: number, timeout: number): Promise<TelegramUpdate[]> {
    const url = new URL(`${this.endpoint}/getUpdates`);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("timeout", String(timeout));
    const response = await this.fetchImpl(url, { signal: this.abort.signal });
    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed with ${response.status}`);
    }
    const body = (await response.json()) as TelegramResponse;
    return body.result ?? [];
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
