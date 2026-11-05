import type { AccountStore } from "./ports/account-store.js";
import type { Agenda, AgendaEvent } from "./ports/agenda.js";
import type { Clock } from "./ports/clock.js";
import type { Mailbox, FetchedMail } from "./ports/mailbox.js";
import type { MailStore } from "./ports/mail-store.js";
import { MailReaderRateLimit, type MailReader } from "./ports/mail-reader.js";
import type { ProgressLog } from "./ports/progress-log.js";
import { scoutIdForEvent } from "../domain/event-link.js";
import { validateCitation, type MailProposal } from "../domain/mail-citation.js";
import type { FunnelStage } from "../domain/progress.js";
import { calendarNotice, fromScout, parseScoutMail, type MailKind } from "../domain/scout-mail.js";

export const MAIL_READINGS_PER_RUN = 5;
export const MAIL_READING_GAP_MS = 7000;

export interface SyncDependencies {
  accounts: AccountStore;
  mailbox: Mailbox;
  agenda: Agenda;
  mail: MailStore;
  progress: ProgressLog;
  reader: MailReader | null;
  clock: Clock;
  model: string;
}

export interface SyncOptions {
  since: Date;
  till: Date | null;
  updateCursors: boolean;
  mailCap: number;
  eventCap: number;
}

export interface SyncResult {
  mail: number;
  events: number;
  proposals: number;
  waiting: number;
  advanced: number;
}

export async function syncInbox(deps: SyncDependencies, options: SyncOptions): Promise<SyncResult> {
  const account = deps.accounts.load();
  if (!account) {
    throw new Error("Google is not connected. Run npm run login.");
  }
  const result: SyncResult = { mail: 0, events: 0, proposals: 0, waiting: 0, advanced: 0 };
  await syncMail(deps, account.gmailHistoryId, options, result);
  const fresh = deps.accounts.load();
  await syncEvents(deps, fresh?.calendarSyncToken ?? account.calendarSyncToken, options, result);
  await readPending(deps, result);
  relinkEvents(deps, result);
  return result;
}

export function formatSyncResult(result: SyncResult): string {
  return `Stored ${result.mail} mail, ${result.events} events. Advanced ${result.advanced} apartments. Read ${result.proposals} proposals. ${result.waiting} mail still waiting.`;
}

async function syncMail(
  deps: SyncDependencies,
  historyId: string | null,
  options: SyncOptions,
  result: SyncResult,
): Promise<void> {
  let fetched: FetchedMail[] = [];
  let nextHistory = "";
  if (!options.updateCursors) {
    if (options.mailCap === 0) {
      return;
    }
    fetched = limited(await deps.mailbox.listSince(options.since, options.till), options.mailCap);
  } else if (!historyId) {
    nextHistory = await deps.mailbox.historyId();
    fetched = await deps.mailbox.listSince(options.since, null);
  } else {
    const added = await deps.mailbox.addedSince(historyId);
    if (added.expired) {
      let fallback = options.since;
      const latest = deps.mail.latestSentAt();
      if (latest) {
        const parsed = new Date(latest);
        if (!Number.isNaN(parsed.getTime())) {
          fallback = parsed;
        }
      }
      nextHistory = await deps.mailbox.historyId();
      fetched = await deps.mailbox.listSince(fallback, null);
    } else {
      fetched = added.mails;
      nextHistory = added.latestId;
    }
  }
  for (const item of fetched) {
    ingestMail(deps, item, result);
  }
  if (options.updateCursors && nextHistory) {
    deps.accounts.saveGmailHistory(nextHistory);
  }
}

function ingestMail(deps: SyncDependencies, item: FetchedMail, result: SyncResult): void {
  if (calendarNotice(item.from, item.subject, item.calendarPart)) {
    return;
  }
  const parsed = parseScoutMail(item.from, item.subject, item.text, item.html);
  const threadScout = deps.mail.scoutIdForThread(item.threadId);
  const scoutSender = fromScout(item.from);
  if (!scoutSender && !threadScout) {
    return;
  }
  const scoutId = parsed.exposeId || threadScout || "";
  const kind: MailKind = !scoutSender && threadScout ? "landlord" : parsed.kind;
  const inserted = deps.mail.insertMail(
    {
      gmailId: item.id,
      threadId: item.threadId,
      from: item.from,
      subject: item.subject,
      sentAt: item.sentAt,
      text: item.text,
      html: item.html,
      kind,
      scoutId,
    },
    deps.clock.now(),
  );
  if (!inserted) {
    return;
  }
  result.mail += 1;
  const stage = stageForMail(kind);
  if (scoutId && stage) {
    advance(deps, result, scoutId, stage, "mail", item.id);
  }
}

function stageForMail(kind: MailKind): FunnelStage | null {
  switch (kind) {
    case "notice":
      return "applied";
    case "message_copy":
    case "landlord":
      return "in_conversation";
    case "unclassified":
      return null;
  }
}

async function syncEvents(
  deps: SyncDependencies,
  syncToken: string | null,
  options: SyncOptions,
  result: SyncResult,
): Promise<void> {
  let events: AgendaEvent[] = [];
  let nextToken: string | null = null;
  if (!options.updateCursors) {
    if (options.eventCap === 0) {
      return;
    }
    const page = await deps.agenda.listSince(options.since, options.till);
    events = limited(page.events, options.eventCap);
  } else if (!syncToken) {
    const page = await deps.agenda.listSince(options.since, null);
    events = page.events;
    nextToken = page.nextToken;
  } else {
    const page = await deps.agenda.changes(syncToken);
    if (page.expired) {
      const again = await deps.agenda.listSince(options.since, null);
      events = again.events;
      nextToken = again.nextToken;
    } else {
      events = page.events;
      nextToken = page.nextToken;
    }
  }
  for (const event of events) {
    ingestEvent(deps, event, result);
  }
  if (options.updateCursors && nextToken) {
    deps.accounts.saveCalendarToken(nextToken);
  }
}

function ingestEvent(deps: SyncDependencies, event: AgendaEvent, result: SyncResult): void {
  const scoutId = scoutIdForEvent(event, deps.mail.visits()) ?? "";
  const inserted = deps.mail.insertEvent(
    {
      id: event.id,
      title: event.title,
      description: event.description,
      start: event.start,
      end: event.end,
      place: event.place,
      scoutId,
    },
    deps.clock.now(),
  );
  if (!inserted) {
    return;
  }
  result.events += 1;
  if (scoutId) {
    advance(deps, result, scoutId, "scheduled", "calendar", event.id);
  }
}

async function readPending(deps: SyncDependencies, result: SyncResult): Promise<void> {
  const pending = deps.mail.unclassifiedWithoutReading();
  result.waiting = pending.length;
  if (!deps.reader || pending.length === 0) {
    return;
  }
  let reads = 0;
  for (const item of pending) {
    if (reads >= MAIL_READINGS_PER_RUN) {
      break;
    }
    if (reads > 0) {
      await deps.clock.sleep(MAIL_READING_GAP_MS);
    }
    const body = item.text.trim() !== "" ? item.text : item.html;
    try {
      const raw = await deps.reader.propose(item.subject, body);
      const checked = validateCitation(body, raw);
      if (!checked.ok) {
        deps.mail.insertReading(failedReading(deps, item.gmailId, "{}"));
      } else {
        deps.mail.insertReading(proposedReading(deps, item.gmailId, checked.proposal));
        result.proposals += 1;
        if (checked.proposal.visit && item.scoutId) {
          advance(deps, result, item.scoutId, "viewing_offered", "mail", item.gmailId);
        }
      }
    } catch (error) {
      if (error instanceof MailReaderRateLimit) {
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      deps.mail.insertReading(failedReading(deps, item.gmailId, JSON.stringify({ error: message })));
    }
    reads += 1;
  }
  result.waiting = deps.mail.unclassifiedWithoutReading().length;
}

function relinkEvents(deps: SyncDependencies, result: SyncResult): void {
  const visits = deps.mail.visits();
  for (const event of deps.mail.unlinkedEvents()) {
    const scoutId = scoutIdForEvent(event, visits);
    if (!scoutId) {
      continue;
    }
    deps.mail.linkEvent(event.id, scoutId);
    advance(deps, result, scoutId, "scheduled", "calendar", event.id);
  }
}

function advance(
  deps: SyncDependencies,
  result: SyncResult,
  scoutId: string,
  stage: FunnelStage,
  source: "mail" | "calendar",
  evidenceId: string,
): void {
  const moved = deps.progress.note({
    scoutId,
    next: stage,
    source,
    evidenceId,
    at: deps.clock.now(),
  });
  if (moved) {
    result.advanced += 1;
  }
}

function proposedReading(deps: SyncDependencies, mailId: string, proposal: MailProposal) {
  return {
    mailId,
    status: "proposed" as const,
    payload: JSON.stringify(proposal),
    model: deps.model,
    createdAt: deps.clock.now(),
  };
}

function failedReading(deps: SyncDependencies, mailId: string, payload: string) {
  return {
    mailId,
    status: "failed" as const,
    payload,
    model: deps.model,
    createdAt: deps.clock.now(),
  };
}

function limited<T>(items: readonly T[], cap: number): T[] {
  if (cap < 0 || items.length <= cap) {
    return [...items];
  }
  return items.slice(0, cap);
}
