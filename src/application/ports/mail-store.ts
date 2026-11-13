import type { LinkMethod } from "../../domain/mail-link.js";
import type { MailKind } from "../../domain/scout-mail.js";
import type { CitedVisit } from "../../domain/mail-citation.js";
import type { ActionStatus } from "../../domain/mail-action.js";
import { isMailRelation, isMailTopic, type OpenTopic } from "../../domain/mail-reply.js";

export interface StoredMail {
  gmailId: string;
  threadId: string;
  from: string;
  replyTo: string;
  messageId: string;
  subject: string;
  sentAt: string;
  text: string;
  html: string;
  cleanText: string;
  inReplyTo: string;
  references: string;
  linkMethod: LinkMethod | "";
  kind: MailKind;
  scoutId: string;
}

export interface StoredEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  place: string;
  scoutId: string;
}

export interface UnreadMail {
  gmailId: string;
  threadId: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  cleanText: string;
  kind: MailKind;
  scoutId: string;
}

export interface UnresolvedMail {
  gmailId: string;
  threadId: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  cleanText: string;
  inReplyTo: string;
  references: string;
  kind: MailKind;
}

export interface StoredThreadMail {
  gmailId: string;
  threadId: string;
  from: string;
  subject: string;
  kind: MailKind;
  scoutId: string;
}

export interface BackfilledMail {
  gmailId: string;
  kind: MailKind;
}

export interface StoredDraft {
  mailId: string;
  intent: string;
  relation: string;
  topic: string;
  body: string;
  altBody: string;
  otherBody: string;
  createdAt: Date;
}

export interface BusyInterval {
  start: string;
  end: string;
}

export interface StoredVisit {
  scoutId: string;
  when: string;
  place: string;
  citation: string;
}

export interface UnlinkedJudgment {
  code: string;
  confidence: number;
  summary: string;
}

export interface UnlinkedMail {
  id: string;
  url: string;
  from: string;
  subject: string;
  sentAt: string;
  cleanText: string;
  relevance: string;
  read: boolean;
  concealed: boolean;
  judgments: UnlinkedJudgment[];
}

export interface UnlinkedEvent {
  id: string;
  title: string;
  start: string;
  place: string;
}

export interface MailReading {
  mailId: string;
  status: "failed" | "proposed";
  payload: string;
  model: string;
  createdAt: Date;
}

export const JUDGMENT_SOURCES = ["mail_triage", "mail_propose", "mail_resolve", "rules"] as const;

export type JudgmentSource = (typeof JUDGMENT_SOURCES)[number];

export const JUDGMENT_BRANCHES = ["rules", "model", "rules_fallback"] as const;

export type JudgmentBranch = (typeof JUDGMENT_BRANCHES)[number];

export interface NewJudgment {
  scoutId: string;
  mailId: string;
  source: JudgmentSource;
  branch: JudgmentBranch;
  model: string;
  stage: string;
  proposalJson: string;
  decisionJson: string;
  error: string;
  createdAt: Date;
}

export interface StoredJudgment {
  id: number;
  createdAt: string;
  scoutId: string;
  mailId: string;
  source: string;
  branch: string;
  model: string;
  stage: string;
  proposalJson: string;
  decisionJson: string;
  error: string;
}

export interface StoredTriageIntent {
  code: string;
  confidence: number;
  summary: string;
  metadataJson: string;
  dskViolation: boolean;
}

export interface StoredTriageRisk {
  level: string;
  redFlagsJson: string;
  relevance: string;
}

export interface LoadedTriage {
  codes: string[];
  riskLevel: string;
  flags: string[];
  relevance: string;
}

export interface StoredAppliedTriage {
  intents: StoredTriageIntent[];
  riskLevel: string;
  redFlags: string[];
  relevance: string;
  draftBody: string;
}

export interface NewMailAction {
  scoutId: string;
  mailId: string;
  intentCode: string;
  actionCode: string;
  status: ActionStatus;
  priority: string;
  actionUrl: string;
  draftResponseText: string;
  deadlineAt: string;
  createdAt: Date;
}

export interface StoredAction {
  id: number;
  scoutId: string;
  mailId: string;
  intentCode: string;
  actionCode: string;
  status: string;
  priority: string;
  actionUrl: string;
  draftResponseText: string;
  deadlineAt: string;
}

export interface OpenMailAction extends StoredAction {
  title: string;
  subject: string;
  from: string;
  address: string;
  body: string;
  slotText: string;
  requestedDocuments: string[];
  dskViolation: boolean;
  otherBody: string;
  declineBody: string;
  judgmentBranch: string;
  judgmentCitation: string;
}

export interface DocumentSubmission {
  mailId: string;
  completedAt: string;
}

export interface ReplySource {
  threadId: string;
  messageId: string;
  inReplyTo: string;
  references: string;
  replyTo: string;
  from: string;
  subject: string;
  email: string | null;
}

export interface MailStore {
  insertMail(mail: StoredMail, createdAt: Date): boolean;
  latestSentAt(): string | null;
  storedGmailIds(): ReadonlySet<string>;
  scoutIdForThread(threadId: string): string | null;
  scoutIdForMessageIds(ids: readonly string[]): string | null;
  unresolvedMail(): UnresolvedMail[];
  findMail(gmailId: string): StoredThreadMail | null;
  linkMessage(gmailId: string, scoutId: string, method: LinkMethod): boolean;
  backfillThread(threadId: string, scoutId: string): BackfilledMail[];
  saveThread(input: {
    threadId: string;
    subject: string;
    from: string;
    scoutId: string;
    linkMethod: LinkMethod | "";
  }): void;
  pendingWithoutReading(): UnreadMail[];
  pendingWithoutTriage(): UnreadMail[];
  saveTriage(mailId: string, intents: readonly StoredTriageIntent[], risk: StoredTriageRisk): void;
  loadTriage(mailId: string): LoadedTriage | null;
  loadStoredTriage(mailId: string): StoredAppliedTriage | null;
  attachActions(mailId: string, scoutId: string): void;
  insertReading(reading: MailReading): void;
  insertJudgment(judgment: NewJudgment): void;
  judgmentsForMail(mailId: string): StoredJudgment[];
  insertDraft(draft: StoredDraft): void;
  openTopic(scoutId: string): OpenTopic | null;
  saveOpenTopic(scoutId: string, topic: OpenTopic, at: Date): void;
  busyIntervals(): BusyInterval[];
  insertEvent(event: StoredEvent, createdAt: Date): boolean;
  removeEvent(eventId: string): boolean;
  unlinkedEvents(): StoredEvent[];
  linkEvent(eventId: string, scoutId: string): void;
  visits(): StoredVisit[];
  listUnlinkedMail(limit: number, includeHidden?: boolean): UnlinkedMail[];
  setOperatorList(gmailId: string, hidden: boolean): boolean;
  listUnlinkedEvents(limit: number): UnlinkedEvent[];
  sentAt(gmailId: string): string | null;
  isQuarantined(scoutId: string): boolean;
  quarantineScout(scoutId: string, at: Date): void;
  insertAction(action: NewMailAction): boolean;
  supersedeOpen(scoutId: string, mailId: string): void;
  markActionsNotified(mailId: string): void;
  setActionStatus(id: number, status: ActionStatus): void;
  blockOpenActions(scoutId: string): void;
  listActions(): StoredAction[];
  listOpenActions(): OpenMailAction[];
  replySource(mailId: string): ReplySource | null;
  recordSubmission(scoutId: string, mailId: string, at: Date): void;
  submissionOf(scoutId: string): DocumentSubmission | null;
  rejectionMailId(scoutId: string): string | null;
  hasErasure(scoutId: string): boolean;
  listingAddress(scoutId: string): string;
  apartmentText(scoutId: string, exceptMailId: string): string;
  saveScorecard(mailId: string, text: string, at: Date): void;
  loadScorecard(mailId: string): string | null;
  promoteDueErasure(now: Date): void;
}

export function visitFromPayload(payload: string): CitedVisit | null {
  try {
    const parsed = JSON.parse(payload) as { visit?: CitedVisit | null };
    const visit = parsed.visit;
    if (!visit || typeof visit.when !== "string" || typeof visit.place !== "string" || typeof visit.citation !== "string") {
      return null;
    }
    if (visit.when.trim() === "" && visit.place.trim() === "") {
      return null;
    }
    return visit;
  } catch {
    return null;
  }
}

export function storedTopic(topic: string, relation: string): OpenTopic | null {
  if (!isMailTopic(topic) || !isMailRelation(relation)) {
    return null;
  }
  return { topic, relation };
}
