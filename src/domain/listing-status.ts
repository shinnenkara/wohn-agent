export const LISTING_STATUSES = [
  "DISCOVERED",
  "FILTERED_OUT",
  "APPLYING",
  "APPLIED",
  "FAILED",
  "MANUAL_REQUIRED",
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export function isListingStatus(value: string): value is ListingStatus {
  return (LISTING_STATUSES as readonly string[]).includes(value);
}
