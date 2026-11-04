import type { Listing } from "../../domain/listing.js";
import type { ListingStatus } from "../../domain/listing-status.js";

export interface ListingRepository {
  findById(scoutId: string): Listing | null;
  findExistingIds(ids: readonly string[]): Set<string>;
  insertAll(listings: readonly Listing[]): void;
  save(listing: Listing): void;
  listByStatus(status: ListingStatus): Listing[];
  resetApplyingToDiscovered(): number;
}
