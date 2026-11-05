import { CaptchaEncountered } from "../domain/captcha-signal.js";
import { matchBlacklist } from "../domain/blacklist.js";
import type { ApplicantProfile } from "../domain/applicant-profile.js";
import type { Listing } from "../domain/listing.js";
import { DomainError } from "../domain/domain-error.js";
import { toFailureContext } from "./failure-context.js";
import { notifySafely } from "./notify.js";
import { persistListing } from "./note-listing-progress.js";
import type { BrowserSession } from "./ports/browser-session.js";
import type { Clock } from "./ports/clock.js";
import type { EventLog } from "./ports/event-log.js";
import type { FailureClassifier } from "./ports/failure-classifier.js";
import type { ListingRepository } from "./ports/listing-repository.js";
import type { Logger } from "./ports/logger.js";
import type { Notifier } from "./ports/notifier.js";
import type { ProgressLog } from "./ports/progress-log.js";

export interface InspectDependencies {
  browser: BrowserSession;
  listings: ListingRepository;
  events: EventLog;
  classifier: FailureClassifier;
  notifier: Notifier;
  logger: Logger;
  clock: Clock;
  profile: ApplicantProfile;
  progress: ProgressLog;
}

const EXTERNAL_REASON = "External portal or phone only";

export async function inspectListing(deps: InspectDependencies, listing: Listing): Promise<Listing> {
  if (listing.status !== "DISCOVERED") {
    throw new DomainError(`Cannot inspect listing in status ${listing.status}`);
  }
  if ((await deps.browser.currentUrl()) !== listing.url) {
    await deps.browser.goto(listing.url);
  }
  const captcha = await deps.browser.detectCaptcha();
  if (captcha) {
    throw new CaptchaEncountered(captcha);
  }

  let facts;
  try {
    facts = await deps.browser.extractExpose();
  } catch (error) {
    if (error instanceof CaptchaEncountered) {
      throw error;
    }
    const context = toFailureContext(error, "EXTRACT");
    const failure = await deps.classifier.classify(context);
    if (failure === "CAPTCHA_HIT") {
      throw new CaptchaEncountered({ kind: "title", detail: context.message || "CAPTCHA_HIT" });
    }
    deps.events.append({
      scoutId: listing.scoutId,
      step: "EXTRACT",
      errorType: failure,
      domSnippet: context.domSnippet.slice(0, 2000),
      resolutionAction: "MANUAL_REQUIRED",
      createdAt: deps.clock.now(),
    });
    const manual = listing.requireManual(context.message || failure, failure);
    persistListing(deps, manual);
    await notifySafely(deps.notifier, deps.logger, {
      type: "MANUAL_REQUIRED",
      scoutId: manual.scoutId,
      url: manual.url,
      reason: manual.filterReason ?? failure,
    });
    return manual;
  }

  let updated = listing.withDetails({
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
  });
  const keyword = matchBlacklist(
    deps.profile.blacklistKeywords,
    facts.title,
    `${facts.description}\n${facts.snapshot}`,
  );
  if (keyword) {
    updated = updated.filterOut(`Keyword match: ${keyword}`);
    persistListing(deps, updated);
    return updated;
  }
  if (facts.externalPortal) {
    updated = updated.requireManual(EXTERNAL_REASON, "EXTERNAL_PORTAL");
    persistListing(deps, updated);
    await notifySafely(deps.notifier, deps.logger, {
      type: "MANUAL_REQUIRED",
      scoutId: updated.scoutId,
      url: updated.url,
      reason: EXTERNAL_REASON,
    });
    return updated;
  }
  persistListing(deps, updated);
  return updated;
}
