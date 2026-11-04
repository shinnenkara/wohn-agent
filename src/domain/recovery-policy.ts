import { DomainError } from "./domain-error.js";
import type { FailureType } from "./failure-type.js";

export interface RecoveryCounts {
  popupCloses: number;
  reloads: number;
  selectorRediscovers: number;
  validationResubmits: number;
}

export type RecoveryAction =
  | "close_popup"
  | "reload_page"
  | "invalidate_selector"
  | "rediscover_selector"
  | "refill_validation"
  | "resubmit";

export type TerminalOutcome = "FAILED" | "MANUAL_REQUIRED" | "BREAKER";

export interface RecoveryDecision {
  actions: readonly RecoveryAction[];
  terminal: TerminalOutcome | null;
}

export function emptyRecoveryCounts(): RecoveryCounts {
  return {
    popupCloses: 0,
    reloads: 0,
    selectorRediscovers: 0,
    validationResubmits: 0,
  };
}

export function decideRecovery(failure: FailureType, counts: RecoveryCounts): RecoveryDecision {
  switch (failure) {
    case "POPUP_BLOCKED":
      if (counts.popupCloses < 2) {
        return { actions: ["close_popup"], terminal: null };
      }
      if (counts.reloads < 1) {
        return { actions: ["reload_page"], terminal: null };
      }
      return { actions: [], terminal: "FAILED" };
    case "SELECTOR_STALE":
      if (counts.selectorRediscovers < 1) {
        return {
          actions: ["invalidate_selector", "rediscover_selector"],
          terminal: null,
        };
      }
      return { actions: [], terminal: "FAILED" };
    case "VALIDATION_ERROR":
      if (counts.validationResubmits < 2) {
        return { actions: ["refill_validation", "resubmit"], terminal: null };
      }
      return { actions: [], terminal: "MANUAL_REQUIRED" };
    case "EXTERNAL_PORTAL":
      return { actions: [], terminal: "MANUAL_REQUIRED" };
    case "CAPTCHA_HIT":
      return { actions: [], terminal: "BREAKER" };
    default: {
      const exhaustive: never = failure;
      throw new DomainError(`Unknown failure ${String(exhaustive)}`);
    }
  }
}
