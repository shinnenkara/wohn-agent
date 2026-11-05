import type { Agenda, AgendaEvent, AgendaPage } from "../../application/ports/agenda.js";
import { calendarTimeMax, calendarTimeMin } from "../../domain/google-window.js";
import { authedGet, type Authorizer } from "./authed-get.js";

const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

interface CalendarItem {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface CalendarList {
  items?: CalendarItem[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export class CalendarAgenda implements Agenda {
  constructor(
    private readonly authorizer: Authorizer,
    private readonly fetchImpl: typeof fetch,
  ) {}

  listSince(since: Date, till: Date | null): Promise<AgendaPage> {
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "100",
      timeMin: calendarTimeMin(since),
    });
    if (till) {
      params.set("timeMax", calendarTimeMax(till));
    }
    return this.pages(params);
  }

  async changes(token: string): Promise<AgendaPage> {
    const params = new URLSearchParams({
      syncToken: token,
      maxResults: "100",
    });
    const first = await authedGet<CalendarList>(this.authorizer, this.fetchImpl, `${EVENTS}?${params.toString()}`, {
      allowStatus: [410],
    });
    if (first.status === 410) {
      return { events: [], nextToken: null, expired: true };
    }
    return this.follow(first.body, params);
  }

  private async pages(params: URLSearchParams): Promise<AgendaPage> {
    const first = await authedGet<CalendarList>(this.authorizer, this.fetchImpl, `${EVENTS}?${params.toString()}`);
    return this.follow(first.body, params);
  }

  private async follow(first: CalendarList | null, params: URLSearchParams): Promise<AgendaPage> {
    const events: AgendaEvent[] = [];
    let page = first;
    let nextToken = page?.nextSyncToken ?? null;
    for (;;) {
      for (const item of page?.items ?? []) {
        const event = toEvent(item);
        if (event) {
          events.push(event);
        }
      }
      const pageToken = page?.nextPageToken;
      if (!pageToken) {
        nextToken = page?.nextSyncToken ?? nextToken;
        break;
      }
      params.set("pageToken", pageToken);
      const next = await authedGet<CalendarList>(this.authorizer, this.fetchImpl, `${EVENTS}?${params.toString()}`);
      page = next.body;
    }
    return { events, nextToken, expired: false };
  }
}

function toEvent(item: CalendarItem): AgendaEvent | null {
  if (!item.id || item.status === "cancelled") {
    return null;
  }
  const start = item.start?.dateTime ?? item.start?.date ?? "";
  const end = item.end?.dateTime ?? item.end?.date ?? "";
  if (!start) {
    return null;
  }
  return {
    id: item.id,
    title: item.summary ?? "",
    description: item.description ?? "",
    start,
    end,
    place: item.location ?? "",
  };
}
