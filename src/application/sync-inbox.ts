import type { AccountStore } from "./ports/account-store.js";
import type { Agenda, AgendaEvent } from "./ports/agenda.js";
import type { Clock } from "./ports/clock.js";
import type { Mailbox, FetchedMail } from "./ports/mailbox.js";
import type { MailStore, UnreadMail } from "./ports/mail-store.js";
import { MailReaderRateLimit, type MailReader } from "./ports/mail-reader.js";
import type { MailResolver } from "./ports/mail-resolver.js";
import type { Notifier } from "./ports/notifier.js";
import type { ProgressLog } from "./ports/progress-log.js";
import { assignMail, stageForMail } from "./assign-mail.js";
import { materializeActions } from "./materialize-actions.js";
import { scoutIdForEvent } from "../domain/event-link.js";
import { gmailUrl } from "../domain/gmail-url.js";
import { emptyProposal, validateCitation, type MailProposal } from "../domain/mail-citation.js";
import {
  chooseLink,
  matchAddress,
  referencedMessageIds,
  type MailCandidate,
} from "../domain/mail-link.js";
import {
  citedVisit,
  classifyReply,
  eveningSlots,
  gmailComposeUrl,
  mailboxAddress,
  nextTopic,
  renderDraft,
  senderName,
  settleReply,
  type CitedSlot,
  type MailClassification,
} from "../domain/mail-reply.js";
import type { FunnelStage } from "../domain/progress.js";
import { calendarNotice, parseScoutMail } from "../domain/scout-mail.js";
import { stripQuotedReply } from "../domain/strip-reply.js";
import {
  confirmTriage,
  proposeFromRules,
  rulesSkipModel,
  triageSummary,
  type TriageDecision,
} from "../domain/triage.js";

export const MAIL_READINGS_PER_RUN = 5;
export const MAIL_READING_GAP_MS = 7000;
export const SYNC_WATCH_MS = 15_000;

export interface SyncDependencies {
  accounts: AccountStore;
  mailbox: Mailbox;
  agenda: Agenda;
  mail: MailStore;
  progress: ProgressLog;
  reader: MailReader | null;
  resolver: MailResolver | null;
  notifier: Notifier | null;
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
  drafts: number;
  waiting: number;
  advanced: number;
}

export async function syncInbox(deps: SyncDependencies, options: SyncOptions): Promise<SyncResult> {
  const account = deps.accounts.load();
  if (!account) {
    throw new Error("Google is not connected. Run npm run login.");
  }
  const result: SyncResult = { mail: 0, events: 0, proposals: 0, drafts: 0, waiting: 0, advanced: 0 };
  await syncMail(deps, account.gmailHistoryId, options, result);
  const fresh = deps.accounts.load();
  await syncEvents(deps, fresh?.calendarSyncToken ?? account.calendarSyncToken, options, result);
  await readPending(deps, options.since, result);
  relinkEvents(deps, result);
  return result;
}

export function formatSyncResult(result: SyncResult): string {
  return `Stored ${result.mail} mail, ${result.events} events. Advanced ${result.advanced} apartments. Read ${result.proposals} proposals. Wrote ${result.drafts} drafts. ${result.waiting} mail still waiting.`;
}

export function syncHasNews(result: SyncResult): boolean {
  return result.mail > 0 || result.events > 0 || result.advanced > 0 || result.drafts > 0;
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
  const candidates = deps.progress.openApplications(options.since);
  for (const item of fetched) {
    ingestMail(deps, item, candidates, result);
  }
  relinkUnresolved(deps, candidates, result);
  if (options.updateCursors && nextHistory) {
    deps.accounts.saveGmailHistory(nextHistory);
  }
}

function ingestMail(
  deps: SyncDependencies,
  item: FetchedMail,
  candidates: readonly MailCandidate[],
  result: SyncResult,
): void {
  if (calendarNotice(item.from, item.subject, item.calendarPart)) {
    return;
  }
  const clean = stripQuotedReply(item.text, item.html);
  const parsed = parseScoutMail(item.from, item.subject, clean, "");
  const inserted = deps.mail.insertMail(
    {
      gmailId: item.id,
      threadId: item.threadId,
      from: item.from,
      replyTo: item.replyTo,
      messageId: item.messageId,
      inReplyTo: item.inReplyTo,
      references: item.references,
      subject: item.subject,
      sentAt: item.sentAt,
      text: item.text,
      html: item.html,
      cleanText: clean,
      linkMethod: "",
      kind: parsed.kind,
      scoutId: "",
    },
    deps.clock.now(),
  );
  if (!inserted) {
    return;
  }
  result.mail += 1;
  deps.mail.saveThread({
    threadId: item.threadId,
    subject: item.subject,
    from: item.from,
    scoutId: "",
    linkMethod: "",
  });
  const decision = chooseLink(signalsFor(deps, candidates, {
    from: item.from,
    subject: item.subject,
    cleanText: clean,
    threadId: item.threadId,
    inReplyTo: item.inReplyTo,
    references: item.references,
  }));
  if (!decision.method) {
    return;
  }
  result.advanced += assignMail(deps, {
    gmailId: item.id,
    threadId: item.threadId,
    from: item.from,
    subject: item.subject,
    kind: parsed.kind,
    scoutId: decision.scoutId,
    method: decision.method,
  });
}

function relinkUnresolved(
  deps: SyncDependencies,
  candidates: readonly MailCandidate[],
  result: SyncResult,
): void {
  for (const item of deps.mail.unresolvedMail()) {
    const decision = chooseLink(signalsFor(deps, candidates, item));
    if (!decision.method) {
      continue;
    }
    result.advanced += assignMail(deps, {
      gmailId: item.gmailId,
      threadId: item.threadId,
      from: item.from,
      subject: item.subject,
      kind: item.kind,
      scoutId: decision.scoutId,
      method: decision.method,
    });
  }
}

function signalsFor(
  deps: SyncDependencies,
  candidates: readonly MailCandidate[],
  item: {
    from: string;
    subject: string;
    cleanText: string;
    threadId: string;
    inReplyTo: string;
    references: string;
  },
) {
  const parsed = parseScoutMail(item.from, item.subject, item.cleanText, "");
  return {
    exposeId: parsed.exposeId,
    threadScoutId: deps.mail.scoutIdForThread(item.threadId) ?? "",
    referencedScoutId:
      deps.mail.scoutIdForMessageIds(referencedMessageIds(item.inReplyTo, item.references)) ?? "",
    addressMatch: matchAddress(item.cleanText, candidates),
  };
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

async function readPending(deps: SyncDependencies, since: Date, result: SyncResult): Promise<void> {
  const pending = deps.mail.pendingWithoutReading();
  result.waiting = pending.length;
  const candidates = deps.progress.openApplications(since);
  let reads = 0;
  for (const item of pending) {
    let current = item;
    if (!current.scoutId && deps.resolver && candidates.length > 0 && reads < MAIL_READINGS_PER_RUN) {
      if (reads > 0) {
        await deps.clock.sleep(MAIL_READING_GAP_MS);
      }
      try {
        const picked = await deps.resolver.resolve({
          subject: current.subject,
          body: current.cleanText,
          candidates,
        });
        reads += 1;
        if (picked && candidates.some((candidate) => candidate.scoutId === picked)) {
          result.advanced += assignMail(deps, {
            gmailId: current.gmailId,
            threadId: current.threadId,
            from: current.from,
            subject: current.subject,
            kind: current.kind,
            scoutId: picked,
            method: "model",
          });
          current = { ...current, scoutId: picked };
        }
      } catch (error) {
        if (error instanceof MailReaderRateLimit) {
          break;
        }
        reads += 1;
      }
    }
    const body = current.cleanText;
    const open = current.scoutId ? deps.mail.openTopic(current.scoutId) : null;
    const stage = current.scoutId ? deps.progress.stageOf(current.scoutId) : null;
    const ruled = classifyReply(current.subject, body, open);
    if (ruled && rulesSkipModel(current.subject, body, ruled)) {
      await remember(
        deps,
        result,
        current,
        body,
        ruled,
        emptyProposal(),
        ruled.intent === "viewing_confirm" ? citedVisit(body) : null,
        decisionFor(current, body, stage, ruled),
      );
      continue;
    }
    if (deps.reader?.triage && reads < MAIL_READINGS_PER_RUN) {
      if (reads > 0) {
        await deps.clock.sleep(MAIL_READING_GAP_MS);
      }
      try {
        const raw = await deps.reader.triage({ subject: current.subject, body, stage });
        const decision = confirmTriage({ text: corpus(current.subject, body), stage, proposed: raw });
        const classification = decision.draft
          ? settleReply(open, decision.draft.intent, decision.draft.citation, current.subject, body)
          : (ruled ?? { intent: "unknown" as const, relation: null, topic: null, evidence: "" });
        await remember(
          deps,
          result,
          current,
          body,
          classification,
          emptyProposal(),
          visitFor(decision, classification.intent, body),
          decision,
        );
      } catch (error) {
        if (error instanceof MailReaderRateLimit) {
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        deps.mail.insertReading(failedReading(deps, current.gmailId, JSON.stringify({ error: message })));
      }
      reads += 1;
      continue;
    }
    if (ruled) {
      await remember(
        deps,
        result,
        current,
        body,
        ruled,
        emptyProposal(),
        ruled.intent === "viewing_confirm" ? citedVisit(body) : null,
        decisionFor(current, body, stage, ruled),
      );
      continue;
    }
    if (!deps.reader || reads >= MAIL_READINGS_PER_RUN) {
      continue;
    }
    if (reads > 0) {
      await deps.clock.sleep(MAIL_READING_GAP_MS);
    }
    try {
      const raw = await deps.reader.propose(current.subject, body);
      const checked = validateCitation(body, raw.proposal);
      const classification = settleReply(open, raw.intent, raw.evidence, current.subject, body);
      const visit = checked.proposal.visit ?? (classification.intent === "viewing_confirm" ? citedVisit(body) : null);
      await remember(
        deps,
        result,
        current,
        body,
        classification,
        checked.proposal,
        visit,
        decisionFor(current, body, stage, classification),
      );
    } catch (error) {
      if (error instanceof MailReaderRateLimit) {
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      deps.mail.insertReading(failedReading(deps, current.gmailId, JSON.stringify({ error: message })));
    }
    reads += 1;
  }
  result.waiting = deps.mail.pendingWithoutReading().length;
}

async function remember(
  deps: SyncDependencies,
  result: SyncResult,
  item: UnreadMail,
  body: string,
  classification: MailClassification,
  proposal: MailProposal,
  visit: CitedSlot | null,
  decision: TriageDecision | null,
): Promise<void> {
  const blocked = decision?.blocked === true;
  const storedVisit = !blocked && visit
    ? { when: visit.when, place: visit.place, citation: visit.citation }
    : null;
  const contactName = proposal.contact?.name || senderName(item.from);
  const draft = blocked
    ? null
    : renderDraft({
        classification,
        subject: item.subject,
        body,
        contactName,
        slots: eveningSlots(deps.clock.now(), deps.mail.busyIntervals()),
        visit: storedVisit,
      });
  if (decision) {
    deps.mail.saveTriage(
      item.gmailId,
      decision.intents.map((intent) => ({
        code: intent.code,
        confidence: intent.confidence,
        summary: intent.summary,
        metadataJson: JSON.stringify(intent.metadata),
        dskViolation: intent.dskViolation,
      })),
      { level: decision.riskLevel, redFlagsJson: JSON.stringify(decision.redFlags) },
    );
  }
  if (!blocked) {
    deps.mail.insertDraft({
      mailId: item.gmailId,
      intent: classification.intent,
      relation: classification.relation ?? "",
      topic: classification.topic ?? "",
      body: draft?.body ?? "",
      altBody: draft?.altBody ?? "",
      createdAt: deps.clock.now(),
    });
  }
  deps.mail.insertReading(
    proposedReading(deps, item.gmailId, {
      ...proposal,
      visit: storedVisit,
      intent: classification.intent,
      relation: classification.relation ?? "",
      evidence: classification.evidence,
    }),
  );
  if (decision) {
    materializeActions(deps.mail, {
      scoutId: item.scoutId,
      mailId: item.gmailId,
      sentAt: deps.mail.sentAt(item.gmailId) ?? deps.clock.now().toISOString(),
      accountEmail: deps.accounts.load()?.email ?? null,
      draftBody: draft?.body ?? "",
      decision,
      createdAt: deps.clock.now(),
    });
  }
  if (!blocked) {
    const topic = nextTopic(item.scoutId ? deps.mail.openTopic(item.scoutId) : null, classification);
    if (item.scoutId && topic && (classification.relation || classification.topic)) {
      deps.mail.saveOpenTopic(item.scoutId, topic, deps.clock.now());
    }
    if (storedVisit && item.scoutId) {
      advance(deps, result, item.scoutId, "viewing_offered", "mail", item.gmailId);
    }
  }
  result.proposals += 1;
  const portal = portalUrl(decision);
  const wantsDraft = Boolean(draft?.body) && allowsDraftAlert(decision);
  const wantsTriage = Boolean(decision && (decision.blocked || decision.riskLevel === "WARN_DSGVO_VIOLATION" || (decision.priority === "P0_CRITICAL" && !draft?.body)));
  let notified = false;
  if (wantsDraft && draft?.body) {
    result.drafts += 1;
    notified = await notifyDraft(deps, item, classification.intent, draft.body, draft.altBody, portal);
  }
  if (wantsTriage && decision) {
    notified = (await notifyTriage(deps, item, decision, portal)) || notified;
  }
  if (notified) {
    deps.mail.markActionsNotified(item.gmailId);
  }
}

function allowsDraftAlert(decision: TriageDecision | null): boolean {
  if (!decision) {
    return true;
  }
  if (decision.blocked || !decision.notify) {
    return false;
  }
  return decision.priority === "P0_CRITICAL" || decision.priority === "P1_HIGH";
}

function decisionFor(
  item: { from: string; subject: string },
  body: string,
  stage: FunnelStage | null,
  classification: MailClassification,
): TriageDecision {
  return confirmTriage({
    text: corpus(item.subject, body),
    stage,
    proposed: proposeFromRules({
      from: item.from,
      subject: item.subject,
      body,
      classification,
    }),
  });
}

function visitFor(decision: TriageDecision, intent: string, body: string): CitedSlot | null {
  if (decision.blocked) {
    return null;
  }
  if (intent === "viewing_confirm" || intent === "contract_confirm") {
    for (const extracted of decision.intents) {
      const slot = extracted.metadata.proposedSlots[0];
      if (slot) {
        return { when: slot.text, place: "", citation: slot.citation };
      }
    }
    return citedVisit(body);
  }
  return null;
}

function corpus(subject: string, body: string): string {
  return `${subject}\n${body}`;
}

function portalUrl(decision: TriageDecision | null): string {
  if (!decision || decision.blocked) {
    return "";
  }
  return decision.intents.find((intent) => intent.metadata.actionDeepLink)?.metadata.actionDeepLink ?? "";
}

async function notifyTriage(
  deps: SyncDependencies,
  item: UnreadMail,
  decision: TriageDecision,
  actionUrl: string,
): Promise<boolean> {
  if (!deps.notifier) {
    return false;
  }
  const email = deps.accounts.load()?.email ?? null;
  try {
    await deps.notifier.notify({
      type: "MAIL_TRIAGE",
      scoutId: item.scoutId,
      priority: decision.priority ?? "",
      riskLevel: decision.riskLevel,
      summary: triageSummary(decision),
      messageUrl: gmailUrl(item.gmailId, email),
      actionUrl,
    });
    return true;
  } catch {
    return false;
  }
}

async function notifyDraft(
  deps: SyncDependencies,
  item: UnreadMail,
  intent: string,
  body: string,
  altBody: string,
  actionUrl: string,
): Promise<boolean> {
  if (!deps.notifier) {
    return false;
  }
  const email = deps.accounts.load()?.email ?? null;
  const to = mailboxAddress(item.replyTo, item.from);
  try {
    await deps.notifier.notify({
      type: "MAIL_DRAFT",
      scoutId: item.scoutId,
      intent,
      body,
      altBody,
      composeUrl: gmailComposeUrl({ account: email, to, subject: item.subject, body }),
      altComposeUrl: altBody ? gmailComposeUrl({ account: email, to, subject: item.subject, body: altBody }) : "",
      messageUrl: gmailUrl(item.gmailId, email),
      actionUrl,
    });
    return true;
  } catch {
    return false;
  }
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

function proposedReading(
  deps: SyncDependencies,
  mailId: string,
  proposal: MailProposal & { intent: string; relation: string; evidence: string },
) {
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
