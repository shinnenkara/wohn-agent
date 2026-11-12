import { citedSlotStart, type BusyInterval } from "./mail-reply.js";
import { gmailInboxUrl } from "./gmail-url.js";
import { INTENT_PRIORITY, PRIORITIES, type IntentCode, type KeptIntent, type Priority } from "./triage.js";

export const ACTION_STATUSES = [
  "PENDING",
  "NOTIFIED",
  "IN_PROGRESS",
  "COMPLETED",
  "SUPERSEDED",
  "BLOCKED_SCAM",
] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

const SUPERSEDE_INTENTS = ["APPT_CONFIRMATION", "REJECTION"] as const;

export interface ActionTemplate {
  code: string;
  intentCode: IntentCode;
  titleTemplate: string;
  slaMinutes: number;
  consoleHotkey: "o" | "d" | "s";
}

export const ACTION_TEMPLATES: readonly ActionTemplate[] = [
  { code: "OPEN_PORTAL", intentCode: "PORTAL_INVITE_LINK", titleTemplate: "Open booking link", slaMinutes: 15, consoleHotkey: "o" },
  { code: "ANSWER_PROPOSAL", intentCode: "APPT_PROPOSAL", titleTemplate: "Answer viewing proposal", slaMinutes: 30, consoleHotkey: "d" },
  { code: "CONFIRM_APPT", intentCode: "APPT_CONFIRMATION", titleTemplate: "Confirm appointment", slaMinutes: 60, consoleHotkey: "d" },
  { code: "SIGNING_SLOT", intentCode: "CONTRACT_SIGNING_ARR", titleTemplate: "Confirm signing time", slaMinutes: 120, consoleHotkey: "d" },
  { code: "REVIEW_CONTRACT", intentCode: "CONTRACT_DRAFT_REVIEW", titleTemplate: "Review contract", slaMinutes: 240, consoleHotkey: "d" },
  { code: "POST_VIEWING", intentCode: "POST_VIEWING_INTEREST", titleTemplate: "Reply after viewing", slaMinutes: 240, consoleHotkey: "d" },
  { code: "SEND_DISCLOSURE", intentCode: "SELF_DISCLOSURE_REQ", titleTemplate: "Send self-disclosure", slaMinutes: 1440, consoleHotkey: "d" },
  { code: "SEND_DOCUMENTS", intentCode: "DOC_PACKAGE_REQ", titleTemplate: "Send documents", slaMinutes: 1440, consoleHotkey: "d" },
  { code: "REVIEW_SCAM", intentCode: "SCAM_SUSPECTED", titleTemplate: "Review suspected scam", slaMinutes: 60, consoleHotkey: "s" },
];

export interface PlannedAction {
  scoutId: string;
  mailId: string;
  intentCode: IntentCode;
  actionCode: string;
  priority: Priority;
  actionUrl: string;
  draftResponseText: string;
  deadlineAt: string;
}

export interface QueueRow {
  id: number;
  scoutId: string;
  priority: string;
  deadlineAt: string;
  title: string;
  label: string;
  status: string;
  badges: readonly string[];
  actionUrl: string;
  draftResponseText: string;
}

const SLOT_MS = 60 * 60 * 1000;

export function templateFor(intentCode: string): ActionTemplate | null {
  return ACTION_TEMPLATES.find((template) => template.intentCode === intentCode) ?? null;
}

export function deadlineAt(sentAt: string, slaMinutes: number): string {
  const start = Date.parse(sentAt);
  if (Number.isNaN(start)) {
    return sentAt;
  }
  return new Date(start + slaMinutes * 60_000).toISOString();
}

export function planActions(input: {
  scoutId: string;
  mailId: string;
  sentAt: string;
  accountEmail: string | null;
  draftBody: string;
  blocked: boolean;
  intents: readonly KeptIntent[];
}): { supersede: boolean; actions: PlannedAction[] } {
  const source = input.blocked ? input.intents.filter((intent) => intent.code === "SCAM_SUSPECTED") : input.intents;
  const supersede =
    !input.blocked &&
    input.scoutId !== "" &&
    input.intents.some((intent) => (SUPERSEDE_INTENTS as readonly string[]).includes(intent.code));
  const actions: PlannedAction[] = [];
  for (const intent of source) {
    const template = templateFor(intent.code);
    if (!template) {
      continue;
    }
    actions.push({
      scoutId: input.scoutId,
      mailId: input.mailId,
      intentCode: intent.code,
      actionCode: template.code,
      priority: INTENT_PRIORITY[intent.code],
      actionUrl: intent.metadata.actionDeepLink ?? gmailInboxUrl(input.mailId, input.accountEmail),
      draftResponseText: input.draftBody,
      deadlineAt: deadlineAt(input.sentAt, template.slaMinutes),
    });
  }
  return { supersede, actions };
}

export function isWbmParty(from: string, subject: string, body: string): boolean {
  const text = `${from}\n${subject}\n${body}`.toLowerCase().replace(/\s+/g, " ");
  if (text.includes("wbm.de") || text.includes("wohnungsbaugesellschaft berlin-mitte")) {
    return true;
  }
  return /\bwbm\b/i.test(text);
}

export function slotConflicts(text: string, busy: readonly BusyInterval[], now: Date): boolean {
  const start = citedSlotStart(text, now);
  if (!start) {
    return false;
  }
  const end = new Date(start.getTime() + SLOT_MS);
  return busy.some((interval) => overlaps(start, end, interval));
}

export function queueBadges(input: {
  from: string;
  subject: string;
  body: string;
  slotText: string;
}, busy: readonly BusyInterval[], now: Date): string[] {
  const badges: string[] = [];
  if (isWbmParty(input.from, input.subject, input.body)) {
    badges.push("WBM");
  }
  if (slotConflicts(input.slotText, busy, now)) {
    badges.push("CONFLICT");
  }
  return badges;
}

export function sortQueue<T extends { priority: string; deadlineAt: string; id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const byPriority = priorityRank(left.priority) - priorityRank(right.priority);
    if (byPriority !== 0) {
      return byPriority;
    }
    if (left.deadlineAt !== right.deadlineAt) {
      return left.deadlineAt < right.deadlineAt ? -1 : 1;
    }
    return left.id - right.id;
  });
}

export function toQueueRow(
  input: {
    id: number;
    scoutId: string;
    priority: string;
    deadlineAt: string;
    title: string;
    address: string;
    subject: string;
    status: string;
    actionUrl: string;
    draftResponseText: string;
    from: string;
    body: string;
    slotText: string;
  },
  busy: readonly BusyInterval[],
  now: Date,
): QueueRow {
  const address = input.address.trim();
  return {
    id: input.id,
    scoutId: input.scoutId,
    priority: input.priority,
    deadlineAt: input.deadlineAt,
    title: input.title,
    label: address || input.subject.trim(),
    status: input.status,
    badges: queueBadges(
      { from: input.from, subject: input.subject, body: input.body, slotText: input.slotText },
      busy,
      now,
    ),
    actionUrl: input.actionUrl,
    draftResponseText: input.draftResponseText,
  };
}

export function countdownLabel(deadlineAt: string, now: Date): string {
  const end = Date.parse(deadlineAt);
  if (Number.isNaN(end)) {
    return "";
  }
  const minutes = Math.ceil((end - now.getTime()) / 60_000);
  if (minutes <= 0) {
    return "late";
  }
  if (minutes < 90) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

export function shortPriority(priority: string): string {
  if (priority === "P0_CRITICAL") {
    return "P0";
  }
  if (priority === "P1_HIGH") {
    return "P1";
  }
  if (priority === "P2_WARNING") {
    return "P2";
  }
  return priority;
}

function priorityRank(priority: string): number {
  const index = (PRIORITIES as readonly string[]).indexOf(priority);
  return index < 0 ? PRIORITIES.length : index;
}

function overlaps(start: Date, end: Date, interval: BusyInterval): boolean {
  const busyStart = Date.parse(interval.start);
  const busyEnd = Date.parse(interval.end);
  if (Number.isNaN(busyStart) || Number.isNaN(busyEnd)) {
    return false;
  }
  return busyStart < end.getTime() && busyEnd > start.getTime();
}
