import { CaptchaEncountered } from "../domain/captcha-signal.js";
import { exposeUrl } from "../domain/expose-url.js";
import { Listing } from "../domain/listing.js";
import { noteListingStatus } from "./note-listing-progress.js";
import type { BrowserSession, CardRef } from "./ports/browser-session.js";
import type { Clock } from "./ports/clock.js";
import type { ListingRepository } from "./ports/listing-repository.js";
import type { ProgressLog } from "./ports/progress-log.js";

export interface PollDependencies {
  browser: BrowserSession;
  listings: ListingRepository;
  clock: Clock;
  progress: ProgressLog;
}

export async function pollSearch(deps: PollDependencies, searchUrl: string): Promise<Listing[]> {
  await deps.browser.goto(searchUrl);
  const captcha = await deps.browser.detectCaptcha();
  if (captcha) {
    throw new CaptchaEncountered(captcha);
  }
  const cards = await deps.browser.extractCards();
  const existing = deps.listings.findExistingIds(cards.map((card) => card.scoutId));
  const discoveredAt = deps.clock.now();
  const fresh = cards
    .filter((card) => !existing.has(card.scoutId))
    .map((card) => listingFromCard(card, discoveredAt));
  deps.listings.insertAll(fresh);
  for (const listing of fresh) {
    noteListingStatus(deps, listing);
  }
  const again = cards
    .filter((card) => existing.has(card.scoutId))
    .map((card) => listingFromCard(card, discoveredAt));
  deps.listings.fillMissing(again);
  return fresh;
}

function listingFromCard(card: CardRef, discoveredAt: Date): Listing {
  return Listing.discover({
    scoutId: card.scoutId,
    url: exposeUrl(card.scoutId),
    discoveredAt,
    title: card.title,
    priceCold: card.priceCold,
    priceWarm: card.priceWarm,
    rooms: card.rooms,
    areaSqm: card.areaSqm,
    address: card.address,
    energyClass: card.energyClass,
    previewImage: card.image,
  });
}
