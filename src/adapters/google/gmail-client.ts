import type { FetchedMail, Mailbox } from "../../application/ports/mailbox.js";
import { gmailSearchQuery } from "../../domain/google-window.js";
import { readGmailMessage, type GmailMessageJson } from "./gmail-message.js";
import { authedGet, type Authorizer } from "./authed-get.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailMailbox implements Mailbox {
  constructor(
    private readonly authorizer: Authorizer,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async historyId(): Promise<string> {
    const profile = await authedGet<{ historyId?: string }>(this.authorizer, this.fetchImpl, `${GMAIL}/profile`);
    if (!profile.body?.historyId) {
      throw new Error("gmail did not return a history id");
    }
    return profile.body.historyId;
  }

  async listSince(since: Date, till: Date | null): Promise<FetchedMail[]> {
    const ids = await this.listIds(gmailSearchQuery(since, till));
    const mails: FetchedMail[] = [];
    for (const id of ids) {
      const message = await this.getMessage(id);
      if (message) {
        mails.push(message);
      }
    }
    return mails;
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
      const response = await authedGet<HistoryResponse>(
        this.authorizer,
        this.fetchImpl,
        `${GMAIL}/history?${params.toString()}`,
        { allowStatus: [404] },
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
      const page = await authedGet<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(
        this.authorizer,
        this.fetchImpl,
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
    const response = await authedGet<GmailMessageJson>(
      this.authorizer,
      this.fetchImpl,
      `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`,
      { allowStatus: [404] },
    );
    if (response.status === 404 || !response.body) {
      return null;
    }
    return readGmailMessage(response.body);
  }
}

interface HistoryResponse {
  historyId?: string;
  nextPageToken?: string;
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
}
