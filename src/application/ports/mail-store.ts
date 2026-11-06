import type { MailKind } from "../../domain/scout-mail.js";
import type { CitedVisit } from "../../domain/mail-citation.js";
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
  scoutId: string;
}

export interface StoredDraft {
  mailId: string;
  intent: string;
  relation: string;
  topic: string;
  body: string;
  altBody: string;
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

export interface UnlinkedMail {
  id: string;
  url: string;
  from: string;
  subject: string;
  sentAt: string;
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

export interface MailStore {
  insertMail(mail: StoredMail, createdAt: Date): boolean;
  latestSentAt(): string | null;
  scoutIdForThread(threadId: string): string | null;
  pendingWithoutReading(): UnreadMail[];
  insertReading(reading: MailReading): void;
  insertDraft(draft: StoredDraft): void;
  openTopic(scoutId: string): OpenTopic | null;
  saveOpenTopic(scoutId: string, topic: OpenTopic, at: Date): void;
  busyIntervals(): BusyInterval[];
  insertEvent(event: StoredEvent, createdAt: Date): boolean;
  unlinkedEvents(): StoredEvent[];
  linkEvent(eventId: string, scoutId: string): void;
  visits(): StoredVisit[];
  listUnlinkedMail(limit: number): UnlinkedMail[];
  listUnlinkedEvents(limit: number): UnlinkedEvent[];
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
