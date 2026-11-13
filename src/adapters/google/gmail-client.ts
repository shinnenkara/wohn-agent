import type { FetchedMail, Mailbox, MailListOptions } from "../../application/ports/mailbox.js";
import { gmailSearchQuery } from "../../domain/google-window.js";
import { readGmailMessage, type GmailMessageJson } from "./gmail-message.js";
import { authedGet, GoogleQuotaError, type Authorizer } from "./authed-get.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const FETCH_BATCH = 10;

export class GmailMailbox implements Mailbox {
  constructor(
    private readonly authorizer: Authorizer,
    private readonly fetchImpl: typeof fetch,
    private readonly sleep: (ms: number) => Promise<void> = delay,
  ) {}

  async historyId(): Promise<string> {
    const profile = await this.get<{ historyId?: string }>(`${GMAIL}/profile`);
    if (!profile.body?.historyId) {
      throw new Error("gmail did not return a history id");
    }
    return profile.body.historyId;
  }

  async listSince(since: Date, till: Date | null, options?: MailListOptions): Promise<FetchedMail[]> {
    const ids = await this.listIds(gmailSearchQuery(since, till));
    const pending = ids.filter((id) => !options?.skip?.has(id));
    const kept: FetchedMail[] = [];
    for (let index = 0; index < pending.length; index += FETCH_BATCH) {
      const batch: FetchedMail[] = [];
      for (const id of pending.slice(index, index + FETCH_BATCH)) {
        const message = await this.getMessage(id);
        if (message) {
          batch.push(message);
        }
      }
      if (options?.onBatch) {
        await options.onBatch(batch);
      } else {
        kept.push(...batch);
      }
    }
    return options?.onBatch ? [] : kept;
  }

  async addedSince(startId: string): Promise<{ mails: FetchedMail[]; latestId: string; expired: boolean }> {
    const ids: string[] = [];
    let pageToken = "";
    let latestId = startId;
    do {
      const params = new URLSearchParams({
        startHistoryId: startId,
        historyTypes: "messageAdded",
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }
      const response = await this.get<HistoryResponse>(
        `${GMAIL}/history?${params.toString()}`,
        [404],
      );
      if (response.status === 404) {
        return { mails: [], latestId: startId, expired: true };
      }
      const body = response.body;
      if (body?.historyId) {
        latestId = body.historyId;
      }
      for (const entry of body?.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          if (added.message?.id) {
            ids.push(added.message.id);
          }
        }
      }
      pageToken = body?.nextPageToken ?? "";
    } while (pageToken);
    const mails: FetchedMail[] = [];
    for (const id of ids) {
      const message = await this.getMessage(id);
      if (message) {
        mails.push(message);
      }
    }
    return { mails, latestId, expired: false };
  }

  private async listIds(query: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({ q: query, maxResults: "50" });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }
      const page = await this.get<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(
        `${GMAIL}/messages?${params.toString()}`,
      );
      for (const message of page.body?.messages ?? []) {
        if (message.id) {
          ids.push(message.id);
        }
      }
      pageToken = page.body?.nextPageToken ?? "";
    } while (pageToken);
    return ids;
  }

  private async getMessage(id: string): Promise<FetchedMail | null> {
    const response = await this.get<GmailMessageJson>(
      `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`,
      [404],
    );
    if (response.status === 404 || !response.body) {
      return null;
    }
    return readGmailMessage(response.body);
  }

  private async get<T>(url: string, allowStatus: number[] = []): Promise<{ status: number; body: T | null }> {
    for (;;) {
      try {
        return await authedGet<T>(this.authorizer, this.fetchImpl, url, { allowStatus });
      } catch (error) {
        if (!(error instanceof GoogleQuotaError)) {
          throw error;
        }
        await this.sleep(error.retryAfterMs);
      }
    }
  }
}

interface HistoryResponse {
  historyId?: string;
  nextPageToken?: string;
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
