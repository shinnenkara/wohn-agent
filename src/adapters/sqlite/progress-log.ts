import type { DatabaseSync } from "node:sqlite";
import type {
  ApartmentCard,
  ApartmentMail,
  ApartmentTopic,
  ProgressLog,
  ProgressNote,
  ProgressTransitionRow,
  StageRow,
} from "../../application/ports/progress-log.js";
import { exposeUrl } from "../../domain/expose-url.js";
import { gmailUrl } from "../../domain/gmail-url.js";
import { gmailComposeUrl, mailboxAddress } from "../../domain/mail-reply.js";
import { isListingStatus } from "../../domain/listing-status.js";
import type { MailCandidate } from "../../domain/mail-link.js";
import {
  advance,
  assertFunnelStage,
  backfillEntry,
  type FunnelStage,
  type ProgressSource,
} from "../../domain/progress.js";
import { DomainError } from "../../domain/domain-error.js";

interface StageSql {
  scout_id: string;
  stage: string;
}

interface TransitionSql {
  scout_id: string;
  from_stage: string;
  to_stage: string;
  source: string;
  evidence_id: string | null;
  created_at: string;
}

interface ListingBackfillRow {
  scout_id: string;
  status: string;
}

interface ApartmentSql {
  scout_id: string;
  stage: string;
  title: string | null;
  url: string | null;
  address: string | null;
  price_cold: number | null;
  price_warm: number | null;
  extra_costs: number | null;
  deposit: string | null;
  rooms: number | null;
  area_sqm: number | null;
  floor: string | null;
  move_in: string | null;
  description: string | null;
  listing_status: string | null;
  energy_class: string | null;
  has_image: number | null;
  snapshot: string | null;
  refresh_state: string | null;
  refresh_detail: string | null;
  discovered_at: string | null;
}

interface MailSql {
  scout_id: string;
  gmail_id: string;
  from_addr: string;
  reply_to: string;
  subject: string;
  sent_at: string;
  intent: string;
  relation: string;
  body: string;
  alt_body: string;
  clean_text: string;
}

interface ViewingSql {
  scout_id: string;
  event_id: string;
  title: string;
  start_at: string;
  place: string;
}

export class SqliteProgressLog implements ProgressLog {
  constructor(private readonly db: DatabaseSync) {}

  stageOf(scoutId: string): FunnelStage | null {
    const row = this.db.prepare("SELECT stage FROM progress WHERE scout_id = ?").get(scoutId) as
      | { stage: string }
      | undefined;
    return row ? assertFunnelStage(row.stage) : null;
  }

  note(input: ProgressNote): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const moved = this.writeNote(input);
      this.db.exec("COMMIT");
      return moved;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  backfillListings(at: Date): number {
    const rows = this.db
      .prepare(
        `SELECT scout_id, status FROM listings
         WHERE scout_id NOT IN (SELECT scout_id FROM progress)`
      )
      .all() as unknown as ListingBackfillRow[];
    if (rows.length === 0) {
      return 0;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let count = 0;
      for (const row of rows) {
        if (!isListingStatus(row.status)) {
          throw new DomainError(`Unknown listing status ${row.status}`);
        }
        const entry = backfillEntry(row.status);
        const existing = this.stageOf(row.scout_id);
        if (existing) {
          continue;
        }
        this.insertStage(row.scout_id, entry.stage, at);
        if (entry.hop) {
          this.insertTransition({
            scoutId: row.scout_id,
            fromStage: entry.hop.from,
            toStage: entry.hop.to,
            source: "backfill",
            evidenceId: row.scout_id,
            at,
          });
        }
        count += 1;
      }
      this.db.exec("COMMIT");
      return count;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listStages(): StageRow[] {
    const rows = this.db.prepare("SELECT scout_id, stage FROM progress").all() as unknown as StageSql[];
    return rows.map((row) => ({ scoutId: row.scout_id, stage: assertFunnelStage(row.stage) }));
  }

  listTransitions(): ProgressTransitionRow[] {
    const rows = this.db
      .prepare(
        `SELECT scout_id, from_stage, to_stage, source, evidence_id, created_at
         FROM progress_transition ORDER BY id`,
      )
      .all() as unknown as TransitionSql[];
    return rows.map((row) => ({
      scoutId: row.scout_id,
      fromStage: assertFunnelStage(row.from_stage),
      toStage: assertFunnelStage(row.to_stage),
      source: assertSource(row.source),
      evidenceId: row.evidence_id,
      createdAt: new Date(row.created_at),
    }));
  }

  openApplications(since: Date): MailCandidate[] {
    const cutoff = since.toISOString();
    const rows = this.db
      .prepare(
        `SELECT l.scout_id, l.title, l.address, l.price_cold
         FROM progress p
         JOIN listings l ON l.scout_id = p.scout_id
         WHERE p.stage IN ('applied', 'in_conversation', 'viewing_offered', 'scheduled')
           AND (
             (l.applied_at IS NOT NULL AND l.applied_at >= ?)
             OR p.updated_at >= ?
           )`,
      )
      .all(cutoff, cutoff) as unknown as Array<{
      scout_id: string;
      title: string | null;
      address: string | null;
      price_cold: number | null;
    }>;
    return rows.map((row) => ({
      scoutId: row.scout_id,
      title: row.title,
      address: row.address,
      priceCold: row.price_cold,
    }));
  }

  listApartments(stage: FunnelStage): ApartmentCard[] {
    const energy = this.columnExists("listings", "energy_class");
    const image = this.columnExists("listings", "preview_image");
    const snapshot = this.columnExists("listings", "snapshot");
    const refresh = this.tableExists("expose_refresh");
    const rows = this.db
      .prepare(
        `SELECT p.scout_id, p.stage, l.title, l.url, l.address,
                l.price_cold, l.price_warm, l.extra_costs, l.deposit, l.rooms, l.area_sqm,
                l.floor, l.move_in, l.description, l.status AS listing_status,
                ${energy ? "l.energy_class" : "NULL"} AS energy_class,
                ${image ? "CASE WHEN l.preview_image IS NOT NULL THEN 1 ELSE 0 END" : "0"} AS has_image,
                ${snapshot ? "l.snapshot" : "NULL"} AS snapshot,
                ${refresh ? "r.state" : "NULL"} AS refresh_state,
                ${refresh ? "r.detail" : "NULL"} AS refresh_detail,
                l.discovered_at
         FROM progress p
         LEFT JOIN listings l ON l.scout_id = p.scout_id
         ${refresh ? "LEFT JOIN expose_refresh r ON r.scout_id = p.scout_id" : ""}
         WHERE p.stage = ?
         ORDER BY l.discovered_at IS NULL, l.discovered_at DESC, p.scout_id DESC`,
      )
      .all(stage) as unknown as ApartmentSql[];
    const ids = rows.map((row) => row.scout_id);
    const email = this.accountEmail();
    const mails = this.mailsFor(ids, email);
    const topics = this.topicsFor(ids);
    const viewings = this.viewingsFor(ids);
    return rows.map((row) => ({
      scoutId: row.scout_id,
      stage: assertFunnelStage(row.stage),
      title: row.title,
      url: row.url ?? exposeUrl(row.scout_id),
      opened:
        (row.listing_status !== null && isListingStatus(row.listing_status) && row.listing_status !== "DISCOVERED") ||
        Boolean(row.snapshot?.trim()),
      address: row.address,
      priceCold: row.price_cold,
      priceWarm: row.price_warm,
      extraCosts: row.extra_costs,
      deposit: row.deposit,
      rooms: row.rooms,
      areaSqm: row.area_sqm,
      floor: row.floor,
      moveIn: row.move_in,
      description: row.description,
      energyClass: row.energy_class,
      hasImage: Number(row.has_image) === 1,
      refreshState: row.refresh_state === "queued" || row.refresh_state === "failed" ? row.refresh_state : null,
      refreshDetail: row.refresh_detail || null,
      discoveredAt: row.discovered_at ? new Date(row.discovered_at).toISOString() : null,
      topic: topics.get(row.scout_id) ?? null,
      mails: mails.get(row.scout_id) ?? [],
      viewings: viewings.get(row.scout_id) ?? [],
    }));
  }

  exposeFacts(scoutId: string): {
    title: string | null;
    address: string | null;
    priceCold: number | null;
    priceWarm: number | null;
    rooms: number | null;
    areaSqm: number | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT title, address, price_cold, price_warm, rooms, area_sqm
         FROM listings WHERE scout_id = ?`,
      )
      .get(scoutId) as
      | {
          title: string | null;
          address: string | null;
          price_cold: number | null;
          price_warm: number | null;
          rooms: number | null;
          area_sqm: number | null;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      title: row.title,
      address: row.address,
      priceCold: row.price_cold,
      priceWarm: row.price_warm,
      rooms: row.rooms,
      areaSqm: row.area_sqm,
    };
  }

  readPreviewImage(scoutId: string): Uint8Array | null {
    if (!/^\d{6,}$/.test(scoutId) || !this.columnExists("listings", "preview_image")) {
      return null;
    }
    const row = this.db.prepare("SELECT preview_image FROM listings WHERE scout_id = ?").get(scoutId) as
      | { preview_image: Uint8Array | null }
      | undefined;
    const image = row?.preview_image;
    if (!image || image.byteLength === 0) {
      return null;
    }
    return new Uint8Array(image);
  }

  private accountEmail(): string | null {
    const row = this.db.prepare("SELECT email FROM google_account WHERE id = 1").get() as { email: string } | undefined;
    return row?.email ?? null;
  }

  private mailsFor(ids: readonly string[], email: string | null) {
    const grouped = new Map<string, ApartmentMail[]>();
    if (ids.length === 0) {
      return grouped;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const drafts = this.tableExists("reply_draft");
    const replyTo = this.columnExists("mail", "reply_to");
    const clean = this.columnExists("mail", "clean_delta_text");
    const rows = this.db
      .prepare(
        `SELECT m.scout_id, m.gmail_id, m.from_addr, ${replyTo ? "m.reply_to" : "'' AS reply_to"}, m.subject, m.sent_at,
                ${clean ? "m.clean_delta_text" : "''"} AS clean_text,
                ${drafts ? "COALESCE(d.intent, '') AS intent, COALESCE(d.relation, '') AS relation, COALESCE(d.body, '') AS body, COALESCE(d.alt_body, '') AS alt_body" : "'' AS intent, '' AS relation, '' AS body, '' AS alt_body"}
         FROM mail m
         ${drafts ? "LEFT JOIN reply_draft d ON d.mail_id = m.gmail_id" : ""}
         WHERE m.scout_id IN (${placeholders})
         ORDER BY m.sent_at DESC`,
      )
      .all(...ids) as unknown as MailSql[];
    const triage = this.triageFor(rows.map((row) => row.gmail_id));
    for (const row of rows) {
      const list = grouped.get(row.scout_id) ?? [];
      list.push(toApartmentMail(row, email, triage.get(row.gmail_id)));
      grouped.set(row.scout_id, list);
    }
    return grouped;
  }

  private triageFor(mailIds: readonly string[]): Map<string, MailTriageView> {
    const grouped = new Map<string, MailTriageView>();
    if (mailIds.length === 0 || !this.tableExists("mail_extracted_intents") || !this.tableExists("mail_risk")) {
      return grouped;
    }
    const placeholders = mailIds.map(() => "?").join(", ");
    const intents = this.db
      .prepare(
        `SELECT mail_id, intent_code, metadata_json FROM mail_extracted_intents
         WHERE mail_id IN (${placeholders})
         ORDER BY intent_code`,
      )
      .all(...mailIds) as unknown as Array<{ mail_id: string; intent_code: string; metadata_json: string }>;
    const risks = this.db
      .prepare(
        `SELECT mail_id, risk_level, red_flags_json FROM mail_risk WHERE mail_id IN (${placeholders})`,
      )
      .all(...mailIds) as unknown as Array<{ mail_id: string; risk_level: string; red_flags_json: string }>;
    for (const row of intents) {
      const view = grouped.get(row.mail_id) ?? emptyTriage();
      view.intents.push(row.intent_code);
      const metadata = parseMetadata(row.metadata_json);
      for (const document of metadata.requestedDocuments) {
        if (!view.documents.includes(document)) {
          view.documents.push(document);
        }
      }
      for (const slot of metadata.proposedSlots) {
        if (slot.text && !view.slots.includes(slot.text)) {
          view.slots.push(slot.text);
        }
      }
      if (!view.linkUrl && metadata.actionDeepLink) {
        view.linkUrl = metadata.actionDeepLink;
        view.linkHost = hostOf(metadata.actionDeepLink);
      }
      grouped.set(row.mail_id, view);
    }
    for (const row of risks) {
      const view = grouped.get(row.mail_id) ?? emptyTriage();
      view.riskLevel = row.risk_level;
      view.redFlags = parseStringList(row.red_flags_json);
      grouped.set(row.mail_id, view);
    }
    return grouped;
  }

  private topicsFor(ids: readonly string[]) {
    const grouped = new Map<string, ApartmentTopic>();
    if (ids.length === 0 || !this.tableExists("open_topic") || !this.tableExists("reply_draft")) {
      return grouped;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const topics = this.db
      .prepare(`SELECT scout_id, topic, relation FROM open_topic WHERE scout_id IN (${placeholders})`)
      .all(...ids) as unknown as Array<{ scout_id: string; topic: string; relation: string }>;
    const counts = this.db
      .prepare(
        `SELECT m.scout_id, d.topic, COUNT(*) AS count
         FROM reply_draft d
         JOIN mail m ON m.gmail_id = d.mail_id
         WHERE m.scout_id IN (${placeholders}) AND d.topic != ''
         GROUP BY m.scout_id, d.topic`,
      )
      .all(...ids) as unknown as Array<{ scout_id: string; topic: string; count: number }>;
    for (const topic of topics) {
      const count = counts.find((row) => row.scout_id === topic.scout_id && row.topic === topic.topic);
      grouped.set(topic.scout_id, {
        topic: topic.topic,
        relation: topic.relation,
        count: Number(count?.count ?? 0),
      });
    }
    return grouped;
  }

  private tableExists(name: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    return row !== undefined;
  }

  private columnExists(table: string, column: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private viewingsFor(ids: readonly string[]) {
    const grouped = new Map<string, ApartmentCard["viewings"]>();
    if (ids.length === 0) {
      return grouped;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT scout_id, event_id, title, start_at, place FROM calendar_event
         WHERE scout_id IN (${placeholders})
         ORDER BY start_at`,
      )
      .all(...ids) as unknown as ViewingSql[];
    for (const row of rows) {
      const list = grouped.get(row.scout_id) ?? [];
      list.push({ id: row.event_id, title: row.title, start: row.start_at, place: row.place });
      grouped.set(row.scout_id, list);
    }
    return grouped;
  }

  private writeNote(input: ProgressNote): boolean {
    const current = this.stageOf(input.scoutId);
    const result = advance(current, input.next);
    if (!result.moved) {
      return false;
    }
    this.insertStage(input.scoutId, result.stage, input.at);
    if (result.from) {
      this.insertTransition({
        scoutId: input.scoutId,
        fromStage: result.from,
        toStage: result.stage,
        source: input.source,
        evidenceId: input.evidenceId,
        at: input.at,
      });
    }
    return true;
  }

  private insertStage(scoutId: string, stage: FunnelStage, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO progress (scout_id, stage, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(scout_id) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at`,
      )
      .run(scoutId, stage, at.toISOString());
  }

  private insertTransition(input: {
    scoutId: string;
    fromStage: FunnelStage;
    toStage: FunnelStage;
    source: ProgressSource;
    evidenceId: string | null;
    at: Date;
  }): void {
    this.db
      .prepare(
        `INSERT INTO progress_transition (
           scout_id, from_stage, to_stage, source, evidence_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.scoutId,
        input.fromStage,
        input.toStage,
        input.source,
        input.evidenceId,
        input.at.toISOString(),
      );
  }
}

interface MailTriageView {
  intents: string[];
  riskLevel: string;
  redFlags: string[];
  documents: string[];
  slots: string[];
  linkUrl: string;
  linkHost: string;
}

function emptyTriage(): MailTriageView {
  return {
    intents: [],
    riskLevel: "",
    redFlags: [],
    documents: [],
    slots: [],
    linkUrl: "",
    linkHost: "",
  };
}

function toApartmentMail(row: MailSql, email: string | null, triage: MailTriageView | undefined): ApartmentMail {
  const to = mailboxAddress(row.reply_to, row.from_addr);
  const view = triage ?? emptyTriage();
  return {
    id: row.gmail_id,
    url: gmailUrl(row.gmail_id, email),
    from: row.from_addr,
    subject: row.subject,
    sentAt: row.sent_at,
    intent: row.intent,
    relation: row.relation,
    draft: row.body,
    altDraft: row.alt_body,
    composeUrl: row.body ? gmailComposeUrl({ account: email, to, subject: row.subject, body: row.body }) : "",
    altComposeUrl: row.alt_body ? gmailComposeUrl({ account: email, to, subject: row.subject, body: row.alt_body }) : "",
    cleanText: row.clean_text,
    intents: view.intents,
    riskLevel: view.riskLevel,
    redFlags: view.redFlags,
    documents: view.documents,
    slots: view.slots,
    linkUrl: view.linkUrl,
    linkHost: view.linkHost,
    linksAreText: view.riskLevel === "CRITICAL_SCAM_BLOCK",
  };
}

function parseMetadata(payload: string): {
  actionDeepLink: string | null;
  requestedDocuments: string[];
  proposedSlots: Array<{ text: string }>;
} {
  try {
    const parsed = JSON.parse(payload) as {
      actionDeepLink?: unknown;
      requestedDocuments?: unknown;
      proposedSlots?: unknown;
    };
    const documents = Array.isArray(parsed.requestedDocuments)
      ? parsed.requestedDocuments.filter((item): item is string => typeof item === "string")
      : [];
    const slots = Array.isArray(parsed.proposedSlots)
      ? parsed.proposedSlots.flatMap((item) => {
          if (!item || typeof item !== "object" || !("text" in item) || typeof item.text !== "string") {
            return [];
          }
          return [{ text: item.text }];
        })
      : [];
    return {
      actionDeepLink: typeof parsed.actionDeepLink === "string" ? parsed.actionDeepLink : null,
      requestedDocuments: documents,
      proposedSlots: slots,
    };
  } catch {
    return { actionDeepLink: null, requestedDocuments: [], proposedSlots: [] };
  }
}

function parseStringList(payload: string): string[] {
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

function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function assertSource(value: string): ProgressSource {
  if (value === "apply" || value === "mail" || value === "calendar" || value === "backfill") {
    return value;
  }
  throw new DomainError(`Unknown progress source ${value}`);
}
