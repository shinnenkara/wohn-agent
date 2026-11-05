import type { ApplicantProfile } from "../domain/applicant-profile.js";
import { CaptchaBreaker } from "../domain/circuit-breaker.js";
import { CaptchaEncountered, pausesSendingImmediately, titleIsClearOfCaptcha, type CaptchaSignal } from "../domain/captcha-signal.js";
import type { RandomSource } from "../domain/timing.js";
import {
  betweenListingDelayMs,
  captchaCooldownMs,
  isWithinActiveHours,
  msUntilActiveWindow,
  pollIntervalMs,
  SESSION_POLL_INTERVAL_MS,
  WATCHDOG_INTERVAL_MS,
} from "../domain/timing.js";
import { applyToListing } from "./apply-to-listing.js";
import { errorMessage } from "./error-message.js";
import { inspectListing } from "./inspect-listing.js";
import { notifySafely } from "./notify.js";
import { pollSearch } from "./poll-search.js";
import type { BrowserSession } from "./ports/browser-session.js";
import type { Clock } from "./ports/clock.js";
import type { ControlChannel } from "./ports/control-channel.js";
import type { EventLog } from "./ports/event-log.js";
import type { FailureClassifier } from "./ports/failure-classifier.js";
import type { ListingRepository } from "./ports/listing-repository.js";
import type { Logger } from "./ports/logger.js";
import type { Notifier } from "./ports/notifier.js";
import type { SelectorCache } from "./ports/selector-cache.js";

export interface LoopDependencies {
  browser: BrowserSession;
  listings: ListingRepository;
  selectors: SelectorCache;
  events: EventLog;
  notifier: Notifier;
  classifier: FailureClassifier;
  control: ControlChannel;
  clock: Clock;
  random: RandomSource;
  logger: Logger;
  profile: ApplicantProfile;
  maxApplicationsPerCycle: number;
  dryRun: boolean;
  overnightRun: boolean;
}

export type NightPhase = "active" | "sleeping" | "overnight";

export interface LoopState {
  breaker: CaptchaBreaker;
  searchIndex: number;
  sessionAlertSent: boolean;
  sleepMs: number;
  previewedIds: readonly string[];
  nightPhase: NightPhase;
}

export function initialLoopState(): LoopState {
  return {
    breaker: CaptchaBreaker.closed(),
    searchIndex: 0,
    sessionAlertSent: false,
    sleepMs: 0,
    previewedIds: [],
    nightPhase: "active",
  };
}

function resolveActiveHours(
  deps: LoopDependencies,
  state: LoopState,
  now: Date,
): { state: LoopState; proceed: boolean } {
  if (!isWithinActiveHours(now)) {
    if (deps.overnightRun) {
      if (state.nightPhase !== "overnight") {
        deps.logger.info("outside active hours; overnight run is continuing");
      }
      return {
        proceed: true,
        state: {
          ...state,
          nightPhase: "overnight",
        },
      };
    }
    const sleepMs = msUntilActiveWindow(now);
    if (state.nightPhase !== "sleeping") {
      deps.logger.info("outside active hours; sleeping until 07:00 Berlin", { sleepMs });
    }
    return {
      proceed: false,
      state: { ...state, nightPhase: "sleeping", sleepMs },
    };
  }
  if (state.nightPhase !== "active") {
    deps.logger.info("active hours started");
  }
  return { proceed: true, state: { ...state, nightPhase: "active" } };
}

export function recoverInterruptedApplications(listings: ListingRepository): number {
  return listings.resetApplyingToDiscovered();
}

export async function runAgentLoop(
  deps: LoopDependencies,
  signal: AbortSignal,
  options?: { maxTicks?: number },
): Promise<void> {
  const recovered = recoverInterruptedApplications(deps.listings);
  if (recovered > 0) {
    deps.logger.info("reset interrupted applications", { count: recovered });
  }
  if (deps.dryRun) {
    deps.logger.info("dry run enabled; applications are printed and not sent");
  }
  if (deps.overnightRun) {
    deps.logger.info("overnight run enabled");
  }
  let state = initialLoopState();
  let ticks = 0;
  while (!signal.aborted && (options?.maxTicks === undefined || ticks < options.maxTicks)) {
    state = await runTick(deps, state, signal);
    ticks += 1;
    if (signal.aborted || (options?.maxTicks !== undefined && ticks >= options.maxTicks)) {
      return;
    }
    await deps.clock.sleep(state.sleepMs, signal);
  }
}

export async function runTick(
  deps: LoopDependencies,
  state: LoopState,
  signal: AbortSignal,
): Promise<LoopState> {
  const now = deps.clock.now();
  const hours = resolveActiveHours(deps, state, now);
  if (!hours.proceed) {
    return hours.state;
  }
  state = hours.state;
  if (state.breaker.state === "OPEN") {
    return watchCaptcha(deps, state);
  }

  try {
    await deps.browser.assertReachable();
  } catch (error) {
    deps.logger.error("chrome debugging port is unavailable", { message: errorMessage(error) });
    return { ...state, sleepMs: pollIntervalMs(deps.random) };
  }

  try {
    const session = await deps.browser.ensureLoggedIn();
    if (!session.loggedIn) {
      if (!state.sessionAlertSent) {
        deps.logger.info("waiting for ImmoScout login");
        await notifySafely(deps.notifier, deps.logger, { type: "SESSION_EXPIRED" });
      }
      return { ...state, sessionAlertSent: true, sleepMs: SESSION_POLL_INTERVAL_MS };
    }

    const searchUrl = deps.profile.searchUrls[state.searchIndex % deps.profile.searchUrls.length];
    if (!searchUrl) {
      deps.logger.error("applicant profile has no search urls");
      return { ...state, sleepMs: pollIntervalMs(deps.random) };
    }
    let tickState: LoopState = {
      ...state,
      searchIndex: state.searchIndex + 1,
      sessionAlertSent: false,
      sleepMs: pollIntervalMs(deps.random),
    };
    deps.logger.info("ImmoScout session is active");

    try {
      await pollSearch(deps, searchUrl);
    } catch (error) {
      if (error instanceof CaptchaEncountered) {
        return handleCaptcha(deps, tickState, signal, error.signal);
      }
      throw error;
    }

    const pending = deps.listings
      .listByStatus("DISCOVERED")
      .filter((listing) => !tickState.previewedIds.includes(listing.scoutId))
      .slice(0, deps.maxApplicationsPerCycle);
    let applied = 0;
    for (const listing of pending) {
      if (signal.aborted || applied >= deps.maxApplicationsPerCycle) {
        break;
      }
      try {
        const inspected = await inspectListing(deps, listing);
        if (inspected.status === "DISCOVERED") {
          const result = await applyToListing(deps, inspected, deps.profile);
          if (result.kind === "applied" || result.kind === "previewed") {
            applied += 1;
          }
          if (result.kind === "failed" || result.kind === "manual") {
            deps.logger.error("listing was not sent", {
              scoutId: listing.scoutId,
              status: result.listing.status,
              message: result.listing.filterReason ?? result.listing.errorCode ?? result.kind,
            });
          }
          if (result.kind === "previewed") {
            tickState = {
              ...tickState,
              previewedIds: [...tickState.previewedIds, result.listing.scoutId],
            };
          }
        }
      } catch (error) {
        if (error instanceof CaptchaEncountered) {
          return handleCaptcha(deps, tickState, signal, error.signal);
        }
        deps.logger.error("listing failed", {
          scoutId: listing.scoutId,
          message: errorMessage(error),
        });
      }
      await deps.clock.sleep(betweenListingDelayMs(deps.random), signal);
    }
    return tickState;
  } catch (error) {
    if (error instanceof CaptchaEncountered) {
      return handleCaptcha(deps, state, signal, error.signal);
    }
    deps.logger.error("poll tick failed", { message: errorMessage(error) });
    return { ...state, sleepMs: pollIntervalMs(deps.random) };
  }
}

async function watchCaptcha(deps: LoopDependencies, state: LoopState): Promise<LoopState> {
  try {
    const captcha = await deps.browser.detectCaptcha();
    if (captcha) {
      return { ...state, sleepMs: WATCHDOG_INTERVAL_MS };
    }
    const title = await deps.browser.readTitle();
    if (titleIsClearOfCaptcha(title)) {
      deps.logger.info("captcha cleared; resuming");
      deps.control.consumeResume();
      return { ...state, breaker: state.breaker.recordCleared(), sleepMs: 0 };
    }
  } catch (error) {
    deps.logger.error("captcha watchdog could not read the page", {
      message: errorMessage(error),
    });
  }
  return { ...state, sleepMs: WATCHDOG_INTERVAL_MS };
}

function openBreaker(breaker: CaptchaBreaker): CaptchaBreaker {
  let next = breaker;
  while (next.state !== "OPEN") {
    next = next.recordDetection();
  }
  return next;
}

async function handleCaptcha(
  deps: LoopDependencies,
  state: LoopState,
  signal: AbortSignal,
  captcha: CaptchaSignal,
): Promise<LoopState> {
  const detected = pausesSendingImmediately(captcha) ? openBreaker(state.breaker) : state.breaker.recordDetection();
  deps.events.append({
    scoutId: null,
    step: "CAPTCHA",
    errorType: "CAPTCHA_HIT",
    domSnippet: captcha.detail.slice(0, 2000),
    resolutionAction: detected.state,
    createdAt: deps.clock.now(),
  });
  if (detected.state === "OPEN") {
    deps.logger.info("captcha paused the loop");
    await notifySafely(deps.notifier, deps.logger, { type: "CAPTCHA_OPEN" });
    return { ...state, breaker: detected, sleepMs: WATCHDOG_INTERVAL_MS };
  }

  await deps.clock.sleep(captchaCooldownMs(deps.random), signal);
  if (signal.aborted) {
    return { ...state, breaker: detected, sleepMs: WATCHDOG_INTERVAL_MS };
  }
  await deps.browser.reload();
  const afterReload = await deps.browser.detectCaptcha();
  if (afterReload?.kind === "checkbox") {
    await deps.browser.clickSimpleCheckboxCaptcha();
  }
  const still = afterReload?.kind === "checkbox" ? await deps.browser.detectCaptcha() : afterReload;
  if (!still) {
    return { ...state, breaker: detected.recordCleared(), sleepMs: pollIntervalMs(deps.random) };
  }
  const opened = detected.recordDetection();
  await notifySafely(deps.notifier, deps.logger, { type: "CAPTCHA_OPEN" });
  return { ...state, breaker: opened, sleepMs: WATCHDOG_INTERVAL_MS };
}
