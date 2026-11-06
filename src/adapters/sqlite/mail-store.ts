import type { DatabaseSync } from "node:sqlite";
import type {
  MailReading,
  MailStore,
  StoredEvent,
  StoredMail,
  StoredVisit,
  UnlinkedEvent,
  UnlinkedMail,
  UnreadMail,
} from "../../application/ports/mail-store.js";
import { visitFromPayload } from "../../application/ports/mail-store.js";
import { gmailUrl } from "../../domain/gmail-url.js";

interface MailRow {
  gmail_id: string;
  subject: string;
  body_text: string;
  body_html: string;
  scout_id: string;
  from_addr?: string;
  sent_at?: string;
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
           gmail_id, thread_id, from_addr, subject, sent_at, body_text, body_html, kind, scout_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mail.gmailId,
        mail.threadId,
        mail.from,
        mail.subject,
        mail.sentAt,
        mail.text,
        mail.html,
        mail.kind,
        mail.scoutId,
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

  unclassifiedWithoutReading(): UnreadMail[] {
    const rows = this.db
      .prepare(
        `SELECT gmail_id, subject, body_text, body_html, scout_id FROM mail
         WHERE kind = 'unclassified'
           AND gmail_id NOT IN (SELECT mail_id FROM reading)
         ORDER BY sent_at`,
      )
      .all() as unknown as MailRow[];
    return rows.map((row) => ({
      gmailId: row.gmail_id,
      subject: row.subject,
      text: row.body_text,
      html: row.body_html,
      scoutId: row.scout_id,
    }));
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
        `SELECT gmail_id, from_addr, subject, sent_at FROM mail
         WHERE scout_id = '' ORDER BY sent_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as Array<{ gmail_id: string; from_addr: string; subject: string; sent_at: string }>;
    const email = accountEmail(this.db);
    return rows.map((row) => ({
      id: row.gmail_id,
      url: gmailUrl(row.gmail_id, email),
      from: row.from_addr,
      subject: row.subject,
      sentAt: row.sent_at,
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
