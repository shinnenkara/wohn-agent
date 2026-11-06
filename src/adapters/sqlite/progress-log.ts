import type { DatabaseSync } from "node:sqlite";
import type {
  ApartmentCard,
  ProgressLog,
  ProgressNote,
  ProgressTransitionRow,
  StageRow,
} from "../../application/ports/progress-log.js";
import { exposeUrl } from "../../domain/expose-url.js";
import { gmailUrl } from "../../domain/gmail-url.js";
import { isListingStatus } from "../../domain/listing-status.js";
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
  listing_id: string | null;
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
}

interface MailSql {
  scout_id: string;
  gmail_id: string;
  from_addr: string;
  subject: string;
  sent_at: string;
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

  listApartments(stage: FunnelStage): ApartmentCard[] {
    const rows = this.db
      .prepare(
        `SELECT p.scout_id, p.stage, l.scout_id AS listing_id, l.title, l.url, l.address,
                l.price_cold, l.price_warm, l.extra_costs, l.deposit, l.rooms, l.area_sqm,
                l.floor, l.move_in, l.description
         FROM progress p
         LEFT JOIN listings l ON l.scout_id = p.scout_id
         WHERE p.stage = ?
         ORDER BY p.updated_at DESC`,
      )
      .all(stage) as unknown as ApartmentSql[];
    const ids = rows.map((row) => row.scout_id);
    const mails = this.mailsFor(ids, this.accountEmail());
    const viewings = this.viewingsFor(ids);
    return rows.map((row) => ({
      scoutId: row.scout_id,
      stage: assertFunnelStage(row.stage),
      title: row.title,
      url: row.url ?? exposeUrl(row.scout_id),
      opened: row.listing_id !== null,
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
      mails: mails.get(row.scout_id) ?? [],
      viewings: viewings.get(row.scout_id) ?? [],
    }));
  }

  private accountEmail(): string | null {
    const row = this.db.prepare("SELECT email FROM google_account WHERE id = 1").get() as { email: string } | undefined;
    return row?.email ?? null;
  }

  private mailsFor(ids: readonly string[], email: string | null) {
    const grouped = new Map<string, ApartmentCard["mails"]>();
    if (ids.length === 0) {
      return grouped;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT scout_id, gmail_id, from_addr, subject, sent_at FROM mail
         WHERE scout_id IN (${placeholders})
         ORDER BY sent_at DESC`,
      )
      .all(...ids) as unknown as MailSql[];
    for (const row of rows) {
      const list = grouped.get(row.scout_id) ?? [];
      list.push({
        id: row.gmail_id,
        url: gmailUrl(row.gmail_id, email),
        from: row.from_addr,
        subject: row.subject,
        sentAt: row.sent_at,
      });
      grouped.set(row.scout_id, list);
    }
    return grouped;
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

function assertSource(value: string): ProgressSource {
  if (value === "apply" || value === "mail" || value === "calendar" || value === "backfill") {
    return value;
  }
  throw new DomainError(`Unknown progress source ${value}`);
}
