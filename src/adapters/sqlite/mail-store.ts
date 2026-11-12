import type { DatabaseSync } from "node:sqlite";
import type {
  BackfilledMail,
  BusyInterval,
  LoadedTriage,
  MailReading,
  MailStore,
  NewMailAction,
  OpenMailAction,
  ReplySource,
  StoredAction,
  StoredTriageIntent,
  StoredTriageRisk,
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
import type { ActionStatus } from "../../domain/mail-action.js";
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
    return rows.map((row) => this.toUnread(row));
  }

  pendingWithoutTriage(): UnreadMail[] {
    const rows = this.db
      .prepare(
        `SELECT gmail_id, thread_id, from_addr, reply_to, subject, body_text, body_html, clean_delta_text, kind, scout_id FROM mail
         WHERE kind IN ('landlord', 'message_copy', 'unclassified')
           AND gmail_id NOT IN (SELECT mail_id FROM reading)
           AND gmail_id NOT IN (SELECT mail_id FROM mail_risk)
         ORDER BY CASE kind WHEN 'landlord' THEN 0 WHEN 'message_copy' THEN 1 ELSE 2 END, sent_at`,
      )
      .all() as unknown as MailRow[];
    return rows.map((row) => this.toUnread(row));
  }

  saveTriage(mailId: string, intents: readonly StoredTriageIntent[], risk: StoredTriageRisk): void {
    const remove = this.db.prepare("DELETE FROM mail_extracted_intents WHERE mail_id = ?");
    const insert = this.db.prepare(
      `INSERT INTO mail_extracted_intents (
         mail_id, intent_code, confidence, summary, metadata_json, dsk_violation
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const riskWrite = this.db.prepare(
      `INSERT INTO mail_risk (mail_id, risk_level, red_flags_json) VALUES (?, ?, ?)
       ON CONFLICT(mail_id) DO UPDATE SET
         risk_level = excluded.risk_level,
         red_flags_json = excluded.red_flags_json`,
    );
    this.db.exec("BEGIN");
    try {
      remove.run(mailId);
      for (const intent of intents) {
        insert.run(
          mailId,
          intent.code,
          intent.confidence,
          intent.summary,
          intent.metadataJson,
          intent.dskViolation ? 1 : 0,
        );
      }
      riskWrite.run(mailId, risk.level, risk.redFlagsJson);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  loadTriage(mailId: string): LoadedTriage | null {
    const risk = this.db.prepare("SELECT risk_level, red_flags_json FROM mail_risk WHERE mail_id = ?").get(mailId) as
      | { risk_level: string; red_flags_json: string }
      | undefined;
    if (!risk) {
      return null;
    }
    const rows = this.db
      .prepare("SELECT intent_code FROM mail_extracted_intents WHERE mail_id = ? ORDER BY intent_code")
      .all(mailId) as unknown as Array<{ intent_code: string }>;
    return {
      codes: rows.map((row) => row.intent_code),
      riskLevel: risk.risk_level,
      flags: parseFlags(risk.red_flags_json),
    };
  }

  private toUnread(row: MailRow): UnreadMail {
    return {
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
    };
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

  sentAt(gmailId: string): string | null {
    const row = this.db.prepare("SELECT sent_at FROM mail WHERE gmail_id = ?").get(gmailId) as
      | { sent_at: string }
      | undefined;
    return row?.sent_at ?? null;
  }

  isQuarantined(scoutId: string): boolean {
    if (scoutId === "") {
      return false;
    }
    const row = this.db.prepare("SELECT scout_id FROM scout_quarantine WHERE scout_id = ?").get(scoutId);
    return row !== undefined;
  }

  quarantineScout(scoutId: string, at: Date): void {
    if (scoutId === "") {
      return;
    }
    this.db
      .prepare("INSERT OR IGNORE INTO scout_quarantine (scout_id, created_at) VALUES (?, ?)")
      .run(scoutId, at.toISOString());
  }

  insertAction(action: NewMailAction): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO user_mail_actions (
           scout_id, mail_id, intent_code, action_code, status, priority, action_url,
           draft_response_text, deadline_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        action.scoutId,
        action.mailId,
        action.intentCode,
        action.actionCode,
        action.status,
        action.priority,
        action.actionUrl,
        action.draftResponseText,
        action.deadlineAt,
        action.createdAt.toISOString(),
      );
    return Number(result.changes) > 0;
  }

  supersedeOpen(scoutId: string, mailId: string): void {
    if (scoutId === "") {
      return;
    }
    this.db
      .prepare(
        `UPDATE user_mail_actions SET status = 'SUPERSEDED'
         WHERE scout_id = ? AND mail_id != ? AND status IN ('PENDING', 'NOTIFIED')`,
      )
      .run(scoutId, mailId);
  }

  markActionsNotified(mailId: string): void {
    this.db
      .prepare("UPDATE user_mail_actions SET status = 'NOTIFIED' WHERE mail_id = ? AND status = 'PENDING'")
      .run(mailId);
  }

  setActionStatus(id: number, status: ActionStatus): void {
    this.db
      .prepare(
        `UPDATE user_mail_actions SET status = ?
         WHERE id = ? AND status IN ('PENDING', 'NOTIFIED', 'IN_PROGRESS')`,
      )
      .run(status, id);
  }

  blockOpenActions(scoutId: string): void {
    if (scoutId === "") {
      return;
    }
    this.db
      .prepare(
        `UPDATE user_mail_actions SET status = 'BLOCKED_SCAM'
         WHERE scout_id = ? AND status IN ('PENDING', 'NOTIFIED', 'IN_PROGRESS')`,
      )
      .run(scoutId);
  }

  listActions(): StoredAction[] {
    const rows = this.db
      .prepare(
        `SELECT id, scout_id, mail_id, intent_code, action_code, status, priority, action_url,
                draft_response_text, deadline_at
         FROM user_mail_actions ORDER BY id`,
      )
      .all() as unknown as ActionRow[];
    return rows.map(toAction);
  }

  listOpenActions(): OpenMailAction[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.scout_id, a.mail_id, a.intent_code, a.action_code, a.status, a.priority,
                a.action_url, a.draft_response_text, a.deadline_at, t.title_template,
                m.subject, m.from_addr, m.body_text, m.clean_delta_text,
                COALESCE(l.address, '') AS address,
                COALESCE(i.metadata_json, '') AS metadata_json
         FROM user_mail_actions a
         JOIN action_templates t ON t.code = a.action_code
         JOIN mail m ON m.gmail_id = a.mail_id
         LEFT JOIN listings l ON l.scout_id = a.scout_id
         LEFT JOIN mail_extracted_intents i ON i.mail_id = a.mail_id AND i.intent_code = a.intent_code
         WHERE a.status IN ('PENDING', 'NOTIFIED', 'IN_PROGRESS')
         ORDER BY a.id`,
      )
      .all() as unknown as OpenActionRow[];
    return rows.map((row) => ({
      ...toAction(row),
      title: row.title_template,
      subject: row.subject,
      from: row.from_addr,
      address: row.address,
      body: `${row.clean_delta_text}\n${row.body_text}`,
      slotText: firstSlot(row.metadata_json),
    }));
  }

  replySource(mailId: string): ReplySource | null {
    const row = this.db
      .prepare(
        `SELECT thread_id, message_id, in_reply_to, references_header, reply_to, from_addr, subject
         FROM mail WHERE gmail_id = ?`,
      )
      .get(mailId) as
      | {
          thread_id: string;
          message_id: string;
          in_reply_to: string;
          references_header: string;
          reply_to: string;
          from_addr: string;
          subject: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      threadId: row.thread_id,
      messageId: row.message_id,
      inReplyTo: row.in_reply_to,
      references: row.references_header,
      replyTo: row.reply_to,
      from: row.from_addr,
      subject: row.subject,
      email: accountEmail(this.db),
    };
  }
}

interface ActionRow {
  id: number | bigint;
  scout_id: string;
  mail_id: string;
  intent_code: string;
  action_code: string;
  status: string;
  priority: string;
  action_url: string;
  draft_response_text: string;
  deadline_at: string;
}

interface OpenActionRow extends ActionRow {
  title_template: string;
  subject: string;
  from_addr: string;
  body_text: string;
  clean_delta_text: string;
  address: string;
  metadata_json: string;
}

function toAction(row: ActionRow): StoredAction {
  return {
    id: Number(row.id),
    scoutId: row.scout_id,
    mailId: row.mail_id,
    intentCode: row.intent_code,
    actionCode: row.action_code,
    status: row.status,
    priority: row.priority,
    actionUrl: row.action_url,
    draftResponseText: row.draft_response_text,
    deadlineAt: row.deadline_at,
  };
}

function firstSlot(metadata: string): string {
  try {
    const parsed = JSON.parse(metadata) as { proposedSlots?: Array<{ text?: unknown }> };
    const text = parsed.proposedSlots?.[0]?.text;
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

function parseFlags(payload: string): string[] {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
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
