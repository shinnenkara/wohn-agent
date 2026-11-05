import { CaptchaEncountered } from "../domain/captcha-signal.js";
import { exposeUrl } from "../domain/expose-url.js";
import { Listing } from "../domain/listing.js";
import { noteListingStatus } from "./note-listing-progress.js";
import type { BrowserSession } from "./ports/browser-session.js";
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
    .map((card) =>
      Listing.discover({
        scoutId: card.scoutId,
        url: exposeUrl(card.scoutId),
        discoveredAt,
      }),
    );
  deps.listings.insertAll(fresh);
  for (const listing of fresh) {
    noteListingStatus(deps, listing);
  }
  return fresh;
}
