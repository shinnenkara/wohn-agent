import { CaptchaEncountered } from "../domain/captcha-signal.js";
import { lacksExposeFacts, type Listing } from "../domain/listing.js";
import { readExpose } from "./read-expose.js";
import type { BrowserSession } from "./ports/browser-session.js";
import type { ListingRepository } from "./ports/listing-repository.js";

export interface RefreshExposeDependencies {
  browser: BrowserSession;
  listings: ListingRepository;
}

export type RefreshExposeResult = "filled" | "missing" | "skipped";

export async function refreshExpose(deps: RefreshExposeDependencies, listing: Listing): Promise<RefreshExposeResult> {
  if (!lacksExposeFacts(listing) || (listing.status !== "DISCOVERED" && listing.status !== "APPLYING")) {
    return "skipped";
  }
  let facts;
  try {
    facts = await readExpose(deps.browser, listing.url);
  } catch (error) {
    if (error instanceof CaptchaEncountered) {
      throw error;
    }
    return "missing";
  }
  if (!facts.title.trim()) {
    return "missing";
  }
  deps.listings.save(
    listing.withDetails({
      title: facts.title,
      contactName: facts.contactName,
      priceCold: facts.priceCold,
      priceWarm: facts.priceWarm,
      extraCosts: facts.extraCosts,
      deposit: facts.deposit,
      rooms: facts.rooms,
      areaSqm: facts.areaSqm,
      floor: facts.floor,
      moveIn: facts.moveIn,
      address: facts.address,
      description: facts.description,
      snapshot: facts.snapshot,
      isPlusOnly: facts.isPlusOnly,
    }),
  );
  return "filled";
}
