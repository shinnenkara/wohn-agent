import type { Clock } from "./ports/clock.js";
import type { ListingRepository } from "./ports/listing-repository.js";
import type { ProgressLog } from "./ports/progress-log.js";
import { funnelStageForListing } from "../domain/progress.js";
import type { Listing } from "../domain/listing.js";

export function noteListingStatus(
  deps: { progress: ProgressLog; clock: Clock },
  listing: Listing,
): void {
  deps.progress.note({
    scoutId: listing.scoutId,
    next: funnelStageForListing(listing.status),
    source: "apply",
    evidenceId: listing.scoutId,
    at: deps.clock.now(),
  });
}

export function persistListing(
  deps: { listings: ListingRepository; progress: ProgressLog; clock: Clock },
  listing: Listing,
): void {
  deps.listings.save(listing);
  noteListingStatus(deps, listing);
}
