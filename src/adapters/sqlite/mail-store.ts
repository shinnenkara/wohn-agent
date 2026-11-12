import type { DatabaseSync } from "node:sqlite";
import type {
  BackfilledMail,
  BusyInterval,
  MailReading,
  MailStore,
  StoredDraft,
  StoredEvent,
  StoredMail,
  StoredThreadMail,
  StoredVisit,
  UnlinkedEvent,
  UnlinkedMail,
  UnreadMail,
  UnresolvedMail,
} from "../../application/ports/mail-store.js";
import { storedTopic, visitFromPayload } from "../../application/ports/mail-store.js";
import { normalizeSubject, senderDomain, type LinkMethod } from "../../domain/mail-link.js";
import type { OpenTopic } from "../../domain/mail-reply.js";
import type { MailKind } from "../../domain/scout-mail.js";
import { gmailUrl } from "../../domain/gmail-url.js";

interface MailRow {
  gmail_id: string;
  thread_id: string;
  from_addr: string;
  reply_to: string;
  subject: string;
  body_text: string;
  body_html: string;
  clean_delta_text: string;
  kind: string;
  scout_id: string;
}

interface EventRow {
  event_id: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  place: string;
  scout_id: string;
}

interface VisitRow {
  scout_id: string;
  payload: string;
}

export class SqliteMailStore implements MailStore {
  constructor(private readonly db: DatabaseSync) {}

  insertMail(mail: StoredMail, createdAt: Date): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO mail (
           gmail_id, thread_id, from_addr, reply_to, message_id, in_reply_to, references_header,
           subject, sent_at, body_text, body_html, clean_delta_text, kind, scout_id, link_method, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mail.gmailId,
        mail.threadId,
        mail.from,
        mail.replyTo,
        mail.messageId,
        mail.inReplyTo,
        mail.references,
        mail.subject,
        mail.sentAt,
        mail.text,
        mail.html,
        mail.cleanText,
        mail.kind,
        mail.scoutId,
        mail.linkMethod,
        createdAt.toISOString(),
      );
    return Number(result.changes) > 0;
  }

  latestSentAt(): string | null {
    const row = this.db.prepare("SELECT MAX(sent_at) AS sent_at FROM mail").get() as
      | { sent_at: string | null }
      | undefined;
    return row?.sent_at ?? null;
  }

  scoutIdForThread(threadId: string): string | null {
    const row = this.db
      .prepare("SELECT scout_id FROM mail WHERE thread_id = ? AND scout_id != '' LIMIT 1")
      .get(threadId) as { scout_id: string } | undefined;
    return row?.scout_id ?? null;
  }

  scoutIdForMessageIds(ids: readonly string[]): string | null {
    if (ids.length === 0) {
      return null;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT DISTINCT scout_id FROM mail WHERE message_id IN (${placeholders}) AND scout_id != ''`,
      )
      .all(...ids) as Array<{ scout_id: string }>;
    if (rows.length !== 1) {
      return null;
    }
    return rows[0]?.scout_id ?? null;
  }

  unresolvedMail(): UnresolvedMail[] {
    const rows = this.db
      .prepare(
        `SELECT gmail_id, thread_id, from_addr, subject, body_text, body_html, clean_delta_text,
                in_reply_to, references_header, kind
         FROM mail WHERE scout_id = '' ORDER BY sent_at`,
      )
      .all() as unknown as Array<{
      gmail_id: string;
      thread_id: string;
      from_addr: string;
      subject: string;
      body_text: string;
      body_html: string;
      clean_delta_text: string;
      in_reply_to: string;
      references_header: string;
      kind: string;
    }>;
    return rows.map((row) => ({
      gmailId: row.gmail_id,
      threadId: row.thread_id,
      from: row.from_addr,
      subject: row.subject,
      text: row.body_text,
      html: row.body_html,
      cleanText: row.clean_delta_text,
      inReplyTo: row.in_reply_to,
      references: row.references_header,
      kind: mailKind(row.kind),
    }));
  }

  findMail(gmailId: string): StoredThreadMail | null {
    const row = this.db
      .prepare(
        `SELECT gmail_id, thread_id, from_addr, subject, kind, scout_id FROM mail WHERE gmail_id = ?`,
      )
      .get(gmailId) as
      | { gmail_id: string; thread_id: string; from_addr: string; subject: string; kind: string; scout_id: string }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      gmailId: row.gmail_id,
      threadId: row.thread_id,
      from: row.from_addr,
      subject: row.subject,
      kind: mailKind(row.kind),
      scoutId: row.scout_id,
    };
  }

  linkMessage(gmailId: string, scoutId: string, method: LinkMethod): boolean {
    const result = this.db
      .prepare("UPDATE mail SET scout_id = ?, link_method = ? WHERE gmail_id = ? AND scout_id = ''")
      .run(scoutId, method, gmailId);
    return Number(result.changes) > 0;
  }

  backfillThread(threadId: string, scoutId: string): BackfilledMail[] {
    const rows = this.db
      .prepare("SELECT gmail_id, kind FROM mail WHERE thread_id = ? AND scout_id = ''")
      .all(threadId) as unknown as Array<{ gmail_id: string; kind: string }>;
    if (rows.length === 0) {
      return [];
    }
    this.db
      .prepare("UPDATE mail SET scout_id = ?, link_method = 'thread' WHERE thread_id = ? AND scout_id = ''")
      .run(scoutId, threadId);
    return rows.map((row) => ({ gmailId: row.gmail_id, kind: mailKind(row.kind) }));
  }

  saveThread(input: {
    threadId: string;
    subject: string;
    from: string;
    scoutId: string;
    linkMethod: LinkMethod | "";
  }): void {
    this.db
      .prepare(
        `INSERT INTO email_threads (
           provider_thread_id, subject_normalized, sender_domain, scout_id, link_method
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider_thread_id) DO UPDATE SET
           subject_normalized = excluded.subject_normalized,
           sender_domain = CASE WHEN email_threads.sender_domain = '' THEN excluded.sender_domain ELSE email_threads.sender_domain END,
           scout_id = CASE WHEN email_threads.scout_id = '' THEN excluded.scout_id ELSE email_threads.scout_id END,
           link_method = CASE WHEN email_threads.scout_id = '' THEN excluded.link_method ELSE email_threads.link_method END`,
      )
      .run(
        input.threadId,
        normalizeSubject(input.subject),
        senderDomain(input.from),
        input.scoutId,
        input.linkMethod,
      );
  }

  pendingWithoutReading(): UnreadMail[] {
    const rows = this.db
      .prepare(
        `SELECT gmail_id, thread_id, from_addr, reply_to, subject, body_text, body_html, clean_delta_text, kind, scout_id FROM mail
         WHERE kind IN ('landlord', 'message_copy', 'unclassified')
           AND gmail_id NOT IN (SELECT mail_id FROM reading)
         ORDER BY CASE kind WHEN 'landlord' THEN 0 WHEN 'message_copy' THEN 1 ELSE 2 END, sent_at`,
      )
      .all() as unknown as MailRow[];
    return rows.map((row) => ({
      gmailId: row.gmail_id,
      threadId: row.thread_id,
      from: row.from_addr,
      replyTo: row.reply_to,
      subject: row.subject,
      text: row.body_text,
      html: row.body_html,
      cleanText: row.clean_delta_text,
      kind: mailKind(row.kind),
      scoutId: row.scout_id,
    }));
  }

  insertDraft(draft: StoredDraft): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO reply_draft (mail_id, intent, relation, topic, body, alt_body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        draft.mailId,
        draft.intent,
        draft.relation,
        draft.topic,
        draft.body,
        draft.altBody,
        draft.createdAt.toISOString(),
      );
  }

  openTopic(scoutId: string): OpenTopic | null {
    const row = this.db.prepare("SELECT topic, relation FROM open_topic WHERE scout_id = ?").get(scoutId) as
      | { topic: string; relation: string }
      | undefined;
    return row ? storedTopic(row.topic, row.relation) : null;
  }

  saveOpenTopic(scoutId: string, topic: OpenTopic, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO open_topic (scout_id, topic, relation, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(scout_id) DO UPDATE SET topic = excluded.topic, relation = excluded.relation, updated_at = excluded.updated_at`,
      )
      .run(scoutId, topic.topic, topic.relation, at.toISOString());
  }

  busyIntervals(): BusyInterval[] {
    const rows = this.db.prepare("SELECT start_at, end_at FROM calendar_event").all() as unknown as Array<{
      start_at: string;
      end_at: string;
    }>;
    return rows.map((row) => ({ start: row.start_at, end: row.end_at }));
  }

  insertReading(reading: MailReading): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO reading (mail_id, status, payload, model, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(reading.mailId, reading.status, reading.payload, reading.model, reading.createdAt.toISOString());
  }

  insertEvent(event: StoredEvent, createdAt: Date): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO calendar_event (
           event_id, title, description, start_at, end_at, place, scout_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.title,
        event.description,
        event.start,
        event.end,
        event.place,
        event.scoutId,
        createdAt.toISOString(),
      );
    return Number(result.changes) > 0;
  }

  unlinkedEvents(): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT event_id, title, description, start_at, end_at, place, scout_id
         FROM calendar_event WHERE scout_id = ''`,
      )
      .all() as unknown as EventRow[];
    return rows.map(toEvent);
  }

  linkEvent(eventId: string, scoutId: string): void {
    this.db
      .prepare("UPDATE calendar_event SET scout_id = ? WHERE event_id = ? AND scout_id = ''")
      .run(scoutId, eventId);
  }

  visits(): StoredVisit[] {
    const rows = this.db
      .prepare(
        `SELECT m.scout_id, r.payload
         FROM reading r
         JOIN mail m ON m.gmail_id = r.mail_id
         WHERE r.status = 'proposed' AND m.scout_id != ''`,
      )
      .all() as unknown as VisitRow[];
    const visits: StoredVisit[] = [];
    for (const row of rows) {
      const visit = visitFromPayload(row.payload);
      if (!visit) {
        continue;
      }
      visits.push({ scoutId: row.scout_id, when: visit.when, place: visit.place, citation: visit.citation });
    }
    return visits;
  }

  listUnlinkedMail(limit: number): UnlinkedMail[] {
    const rows = this.db
      .prepare(
        `SELECT gmail_id, from_addr, subject, sent_at, clean_delta_text FROM mail
         WHERE scout_id = '' ORDER BY sent_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as Array<{
      gmail_id: string;
      from_addr: string;
      subject: string;
      sent_at: string;
      clean_delta_text: string;
    }>;
    const email = accountEmail(this.db);
    return rows.map((row) => ({
      id: row.gmail_id,
      url: gmailUrl(row.gmail_id, email),
      from: row.from_addr,
      subject: row.subject,
      sentAt: row.sent_at,
      cleanText: row.clean_delta_text,
    }));
  }

  listUnlinkedEvents(limit: number): UnlinkedEvent[] {
    const rows = this.db
      .prepare(
        `SELECT event_id, title, start_at, place FROM calendar_event
         WHERE scout_id = '' ORDER BY start_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as Array<{ event_id: string; title: string; start_at: string; place: string }>;
    return rows.map((row) => ({
      id: row.event_id,
      title: row.title,
      start: row.start_at,
      place: row.place,
    }));
  }
}

function accountEmail(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT email FROM google_account WHERE id = 1").get() as { email: string } | undefined;
  return row?.email ?? null;
}

function mailKind(value: string): MailKind {
  if (value === "notice" || value === "message_copy" || value === "landlord" || value === "unclassified") {
    return value;
  }
  return "unclassified";
}

function toEvent(row: EventRow): StoredEvent {
  return {
    id: row.event_id,
    title: row.title,
    description: row.description,
    start: row.start_at,
    end: row.end_at,
    place: row.place,
    scoutId: row.scout_id,
  };
}
