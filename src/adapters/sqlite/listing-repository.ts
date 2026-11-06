import type { DatabaseSync } from "node:sqlite";
import type { ListingRepository } from "../../application/ports/listing-repository.js";
import { Listing, type ListingData } from "../../domain/listing.js";
import { isListingStatus, type ListingStatus } from "../../domain/listing-status.js";
import { DomainError } from "../../domain/domain-error.js";

interface ListingRow {
  scout_id: string;
  url: string;
  title: string | null;
  salutation: string | null;
  price_cold: number | null;
  rooms: number | null;
  area_sqm: number | null;
  address: string | null;
  price_warm: number | null;
  extra_costs: number | null;
  deposit: string | null;
  floor: string | null;
  move_in: string | null;
  description: string | null;
  snapshot: string | null;
  energy_class: string | null;
  preview_image: Uint8Array | null;
  is_plus_only: number | null;
  status: string;
  filter_reason: string | null;
  error_code: string | null;
  retry_count: number | null;
  discovered_at: string;
  applied_at: string | null;
}

export class SqliteListingRepository implements ListingRepository {
  constructor(private readonly db: DatabaseSync) {}

  findById(scoutId: string): Listing | null {
    const row = this.db
      .prepare("SELECT * FROM listings WHERE scout_id = ?")
      .get(scoutId) as ListingRow | undefined;
    return row ? toListing(row) : null;
  }

  findExistingIds(ids: readonly string[]): Set<string> {
    if (ids.length === 0) {
      return new Set();
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT scout_id FROM listings WHERE scout_id IN (${placeholders})`)
      .all(...ids) as Array<{ scout_id: string }>;
    return new Set(rows.map((row) => row.scout_id));
  }

  insertAll(listings: readonly Listing[]): void {
    if (listings.length === 0) {
      return;
    }
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO listings (
        scout_id, url, title, salutation, price_cold, rooms, area_sqm, address, price_warm,
        extra_costs, deposit, floor, move_in, description, snapshot, is_plus_only,
        status, filter_reason, error_code, retry_count, discovered_at, applied_at,
        energy_class, preview_image
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      for (const listing of listings) {
        insert.run(...bindListing(listing.toData()));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  fillMissing(listings: readonly Listing[]): void {
    if (listings.length === 0) {
      return;
    }
    const update = this.db.prepare(`
      UPDATE listings SET
        title = COALESCE(title, ?),
        price_cold = COALESCE(price_cold, ?),
        price_warm = COALESCE(price_warm, ?),
        rooms = COALESCE(rooms, ?),
        area_sqm = COALESCE(area_sqm, ?),
        address = COALESCE(address, ?),
        energy_class = COALESCE(energy_class, ?),
        preview_image = COALESCE(preview_image, ?)
      WHERE scout_id = ?
    `);
    this.db.exec("BEGIN");
    try {
      for (const listing of listings) {
        const data = listing.toData();
        update.run(
          data.title,
          data.priceCold,
          data.priceWarm,
          data.rooms,
          data.areaSqm,
          data.address,
          data.energyClass,
          data.previewImage,
          data.scoutId,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  save(listing: Listing): void {
    this.db
      .prepare(`
        INSERT INTO listings (
          scout_id, url, title, salutation, price_cold, rooms, area_sqm, address, price_warm,
          extra_costs, deposit, floor, move_in, description, snapshot, is_plus_only,
          status, filter_reason, error_code, retry_count, discovered_at, applied_at,
          energy_class, preview_image
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scout_id) DO UPDATE SET
          url = excluded.url,
          title = excluded.title,
          salutation = excluded.salutation,
          price_cold = excluded.price_cold,
          rooms = excluded.rooms,
          area_sqm = excluded.area_sqm,
          address = excluded.address,
          price_warm = excluded.price_warm,
          extra_costs = excluded.extra_costs,
          deposit = excluded.deposit,
          floor = excluded.floor,
          move_in = excluded.move_in,
          description = excluded.description,
          snapshot = excluded.snapshot,
          is_plus_only = excluded.is_plus_only,
          status = excluded.status,
          filter_reason = excluded.filter_reason,
          error_code = excluded.error_code,
          retry_count = excluded.retry_count,
          discovered_at = excluded.discovered_at,
          applied_at = excluded.applied_at,
          energy_class = excluded.energy_class,
          preview_image = excluded.preview_image
      `)
      .run(...bindListing(listing.toData()));
  }

  listByStatus(status: ListingStatus): Listing[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM listings WHERE status = ? ORDER BY discovered_at DESC, rowid DESC",
      )
      .all(status) as unknown as ListingRow[];
    return rows.map(toListing);
  }

  resetApplyingToDiscovered(): number {
    const result = this.db
      .prepare("UPDATE listings SET status = 'DISCOVERED' WHERE status = 'APPLYING'")
      .run();
    return Number(result.changes);
  }
}

function bindListing(data: ListingData): Array<string | number | null | Uint8Array> {
  return [
    data.scoutId,
    data.url,
    data.title,
    data.salutation,
    data.priceCold,
    data.rooms,
    data.areaSqm,
    data.address,
    data.priceWarm,
    data.extraCosts,
    data.deposit,
    data.floor,
    data.moveIn,
    data.description,
    data.snapshot,
    data.isPlusOnly ? 1 : 0,
    data.status,
    data.filterReason,
    data.errorCode,
    data.retryCount,
    data.discoveredAt.toISOString(),
    data.appliedAt ? data.appliedAt.toISOString() : null,
    data.energyClass,
    data.previewImage,
  ];
}

function toListing(row: ListingRow): Listing {
  if (!isListingStatus(row.status)) {
    throw new DomainError(`Unknown listing status ${row.status}`);
  }
  return Listing.rehydrate({
    scoutId: row.scout_id,
    url: row.url,
    title: row.title,
    salutation: row.salutation,
    priceCold: row.price_cold,
    rooms: row.rooms,
    areaSqm: row.area_sqm,
    address: row.address,
    priceWarm: row.price_warm,
    extraCosts: row.extra_costs,
    deposit: row.deposit,
    floor: row.floor,
    moveIn: row.move_in,
    description: row.description,
    snapshot: row.snapshot,
    energyClass: row.energy_class ?? null,
    previewImage: imageFrom(row.preview_image),
    isPlusOnly: row.is_plus_only === 1,
    status: row.status,
    filterReason: row.filter_reason,
    errorCode: row.error_code,
    retryCount: row.retry_count ?? 0,
    discoveredAt: new Date(row.discovered_at),
    appliedAt: row.applied_at ? new Date(row.applied_at) : null,
  });
}

function imageFrom(value: Uint8Array | null | undefined): Uint8Array | null {
  if (!value || value.byteLength === 0) {
    return null;
  }
  return new Uint8Array(value);
}
