import type { ApplicantProfile } from "../domain/applicant-profile.js";
import { CaptchaEncountered } from "../domain/captcha-signal.js";
import { DomainError } from "../domain/domain-error.js";
import type { Listing } from "../domain/listing.js";
import { renderMessage } from "../domain/message-template.js";
import {
  decideRecovery,
  emptyRecoveryCounts,
  type RecoveryCounts,
} from "../domain/recovery-policy.js";
import type { SelectorCacheEntry } from "../domain/selector-cache-entry.js";
import { ApplicationSent, StepFailure } from "../domain/step-failure.js";
import { matchValidationFields } from "../domain/validation-fields.js";
import { persistListing } from "./note-listing-progress.js";
import { toFailureContext } from "./failure-context.js";
import { notifySafely } from "./notify.js";
import type { BrowserSession, CachedSelector, ObservedAction } from "./ports/browser-session.js";
import type { Clock } from "./ports/clock.js";
import type { EventLog } from "./ports/event-log.js";
import type { FailureClassifier } from "./ports/failure-classifier.js";
import type { ListingRepository } from "./ports/listing-repository.js";
import type { Logger } from "./ports/logger.js";
import type { Notifier } from "./ports/notifier.js";
import type { ProgressLog } from "./ports/progress-log.js";
import type { SelectorCache } from "./ports/selector-cache.js";

export interface ApplyDependencies {
  browser: BrowserSession;
  listings: ListingRepository;
  selectors: SelectorCache;
  events: EventLog;
  classifier: FailureClassifier;
  notifier: Notifier;
  logger: Logger;
  clock: Clock;
  dryRun: boolean;
  progress: ProgressLog;
}

export type ApplyResult =
  | { kind: "applied"; listing: Listing }
  | { kind: "previewed"; listing: Listing }
  | { kind: "failed"; listing: Listing }
  | { kind: "manual"; listing: Listing };

const CONTACT_KEY = "open_contact_drawer";
const MESSAGE_KEY = "message_textarea";
const SUBMIT_KEY = "submit_application";
const MAX_STEPS = 20;

type Phase = "open" | "fields" | "locateSubmit" | "message" | "clickSubmit";

export async function applyToListing(
  deps: ApplyDependencies,
  listing: Listing,
  profile: ApplicantProfile,
): Promise<ApplyResult> {
  if (listing.status !== "DISCOVERED") {
    throw new DomainError(`Cannot apply to listing in status ${listing.status}`);
  }
  let current = listing.startApplying();
  persistListing(deps, current);
  const counts = emptyRecoveryCounts();
  // Locate the submit button before pasting the message so that observe()
  // snapshots do not include the rendered application text.
  let phase: Phase = "open";
  let submitSelector: string | null = null;
  let message = "";

  for (let step = 0; step < MAX_STEPS; step += 1) {
    try {
      if (phase === "open") {
        const action = await deps.browser.openContact(cachedSelector(deps.selectors.get(CONTACT_KEY)));
        remember(deps, CONTACT_KEY, action);
        counts.selectorRediscovers = 0;
        phase = "fields";
        continue;
      }
      if (phase === "fields") {
        const filled = await deps.browser.fillRequiredFields(profile.formData);
        if (filled.requiresFileUpload) {
          return finishManual(deps, current, "Required file upload", "FILE_UPLOAD");
        }
        if (filled.unfilledRequired) {
          return finishManual(deps, current, "Required fields are still empty", "VALIDATION_ERROR");
        }
        counts.selectorRediscovers = 0;
        phase = "locateSubmit";
        continue;
      }
      if (phase === "locateSubmit") {
        const action = await deps.browser.locateSubmit(cachedSelector(deps.selectors.get(SUBMIT_KEY)));
        remember(deps, SUBMIT_KEY, action);
        submitSelector = action.selector;
        counts.selectorRediscovers = 0;
        phase = "message";
        continue;
      }
      if (phase === "message") {
        const liveName = (await deps.browser.readContactName())?.trim() || null;
        message = renderMessage(
          profile.messageTemplate,
          liveName ?? current.salutation,
          current.title ?? "",
        );
        const action = await deps.browser.fillMessage(message, cachedSelector(deps.selectors.get(MESSAGE_KEY)));
        remember(deps, MESSAGE_KEY, action);
        counts.selectorRediscovers = 0;
        phase = "clickSubmit";
        continue;
      }
      if (!submitSelector) {
        phase = "locateSubmit";
        continue;
      }
      if (deps.dryRun) {
        deps.logger.preview(formatDryRunPreview(current, message));
        current = current.releaseUnsent();
        persistListing(deps, current);
        return { kind: "previewed", listing: current };
      }
      const check = await deps.browser.submit(submitSelector);
      if (!check.confirmed) {
        if (check.validationErrors.length > 0) {
          const text = check.validationErrors.join("\n");
          throw new StepFailure("SUBMIT", text, { name: "ValidationError", domSnippet: text });
        }
        throw new StepFailure("SUBMIT", "Confirmation was not observed", { name: "ConfirmationTimeout" });
      }
      return await finishApplied(deps, current);
    } catch (error) {
      if (error instanceof ApplicationSent) {
        return await finishApplied(deps, current);
      }
      if (error instanceof CaptchaEncountered) {
        throw requeueForCaptcha(deps, current, error);
      }
      try {
        const healed = await heal(deps, {
          error,
          phase,
          counts,
          current,
          profile,
          onPhase(next) {
            phase = next;
          },
          clearSubmit() {
            submitSelector = null;
          },
        });
        if (healed.listing) {
          current = healed.listing;
        }
        if (healed.result) {
          return healed.result;
        }
      } catch (healError) {
        if (healError instanceof CaptchaEncountered) {
          throw requeueForCaptcha(deps, current, healError);
        }
        const cause = error instanceof Error ? error.message : String(error);
        const duringRecovery = healError instanceof Error ? healError.message : String(healError);
        deps.logger.error("listing recovery failed", {
          scoutId: current.scoutId,
          message: cause,
          recovery: duringRecovery,
        });
        return finishFailed(deps, current, "UNHANDLED");
      }
    }
  }
  return finishFailed(deps, current, "RETRY_GUARD");
}

function requeueForCaptcha(
  deps: ApplyDependencies,
  current: Listing,
  error: CaptchaEncountered,
): CaptchaEncountered {
  if (current.status === "APPLYING") {
    persistListing(deps, current.requeue("CAPTCHA_HIT"));
  }
  return error;
}

interface HealInput {
  error: unknown;
  phase: Phase;
  counts: RecoveryCounts;
  current: Listing;
  profile: ApplicantProfile;
  onPhase(phase: Phase): void;
  clearSubmit(): void;
}

async function heal(
  deps: ApplyDependencies,
  input: HealInput,
): Promise<{ result: ApplyResult | null; listing: Listing }> {
  const step = input.phase === "clickSubmit" || input.phase === "locateSubmit" ? "SUBMIT" : "FILL_FORM";
  const context = toFailureContext(input.error, step);
  const failure = await deps.classifier.classify(context);
  const decision = decideRecovery(failure, input.counts);
  deps.events.append({
    scoutId: input.current.scoutId,
    step: context.step,
    errorType: failure,
    domSnippet: context.message.slice(0, 500),
    resolutionAction: decision.terminal ?? decision.actions.join("+"),
    createdAt: deps.clock.now(),
  });

  if (decision.terminal === "BREAKER") {
    const requeued = input.current.status === "APPLYING" ? input.current.requeue("CAPTCHA_HIT") : input.current;
    persistListing(deps, requeued);
    throw new CaptchaEncountered({ kind: "title", detail: context.message || "CAPTCHA_HIT" });
  }
  if (decision.terminal === "FAILED") {
    return { result: finishFailed(deps, input.current, failure), listing: input.current };
  }
  if (decision.terminal === "MANUAL_REQUIRED") {
    return {
      result: await finishManual(deps, input.current, context.message || failure, failure),
      listing: input.current,
    };
  }

  for (const action of decision.actions) {
    if (action === "close_popup") {
      await deps.browser.closePopup();
      input.counts.popupCloses += 1;
    } else if (action === "reload_page") {
      await deps.browser.reload();
      input.counts.reloads += 1;
      input.onPhase("open");
      input.clearSubmit();
    } else if (action === "invalidate_selector") {
      const key = cacheKey(input.phase);
      deps.selectors.invalidate(key);
      if (input.phase === "clickSubmit") {
        await deps.browser.clearMessage();
        input.onPhase("locateSubmit");
        input.clearSubmit();
      }
    } else if (action === "rediscover_selector") {
      input.counts.selectorRediscovers += 1;
    } else if (action === "refill_validation") {
      const fields = matchValidationFields(`${context.domSnippet}\n${context.message}`);
      if (fields.length === 0) {
        return {
          result: await finishManual(deps, input.current, "Unmapped validation error", "VALIDATION_ERROR"),
          listing: input.current,
        };
      }
      await deps.browser.fillFields(fields, input.profile.formData);
      input.counts.validationResubmits += 1;
    } else if (action === "resubmit") {
      input.onPhase("clickSubmit");
    }
  }

  if (input.current.status !== "APPLYING") {
    return { result: null, listing: input.current };
  }
  const released = input.current.releaseForRetry(failure).startApplying();
  persistListing(deps, released);
  return { result: null, listing: released };
}

async function finishApplied(deps: ApplyDependencies, current: Listing): Promise<ApplyResult> {
  const applied = current.status === "APPLYING" ? current.markApplied(deps.clock.now()) : current;
  persistListing(deps, applied);
  deps.logger.info("application sent", { scoutId: applied.scoutId, title: applied.title ?? applied.scoutId });
  await notifySafely(deps.notifier, deps.logger, {
    type: "APPLIED",
    scoutId: applied.scoutId,
    title: applied.title ?? applied.scoutId,
    url: applied.url,
  });
  return { kind: "applied", listing: applied };
}

function finishFailed(deps: ApplyDependencies, current: Listing, errorCode: string): ApplyResult {
  const failed = current.status === "APPLYING" ? current.markFailed(errorCode) : current;
  persistListing(deps, failed);
  return { kind: "failed", listing: failed };
}

async function finishManual(
  deps: ApplyDependencies,
  current: Listing,
  reason: string,
  errorCode: string,
): Promise<ApplyResult> {
  const manual = current.status === "MANUAL_REQUIRED" ? current : current.requireManual(reason, errorCode);
  persistListing(deps, manual);
  await notifySafely(deps.notifier, deps.logger, {
    type: "MANUAL_REQUIRED",
    scoutId: manual.scoutId,
    url: manual.url,
    reason,
  });
  return { kind: "manual", listing: manual };
}

function remember(deps: ApplyDependencies, actionKey: string, action: ObservedAction): void {
  if (action.selector.startsWith("xpath=") || action.selector.startsWith("/")) {
    return;
  }
  const entry: SelectorCacheEntry = {
    actionKey,
    instruction: action.instruction,
    selector: action.selector,
    method: action.method,
    failCount: 0,
    updatedAt: deps.clock.now(),
  };
  deps.selectors.upsert(entry);
}

function cachedSelector(entry: SelectorCacheEntry | null): CachedSelector | null {
  if (!entry) {
    return null;
  }
  return { selector: entry.selector, method: entry.method };
}

function formatDryRunPreview(listing: Listing, message: string): string {
  return [
    "-------- dry run: application not sent --------",
    `${listing.scoutId}  ${listing.title ?? ""}`.trimEnd(),
    listing.url,
    "",
    message,
    "-----------------------------------------------",
  ].join("\n");
}

function cacheKey(phase: Phase): string {
  switch (phase) {
    case "open":
      return CONTACT_KEY;
    case "fields":
      return "required_fields";
    case "message":
      return MESSAGE_KEY;
    case "locateSubmit":
    case "clickSubmit":
      return SUBMIT_KEY;
  }
}
