import type { FailureType } from "../../domain/failure-type.js";
import type { FailureContext } from "../../application/ports/failure-classifier.js";

const CAPTCHA_PATTERN =
  /captcha-box|geetest|ich bin kein roboter|sicherheitsüberprüfung|sicherheitsuberprufung|recaptcha|aws waf/i;
const VALIDATION_PATTERN =
  /pflichtfeld|ungültig|ungueltig|validation error|bitte (geben|füllen|fullen|ausfüllen|ausfullen)|aria-invalid/i;
const POPUP_PATTERN = /intercept|not clickable|overlay|obscur/i;
const STALE_PATTERN = /timeout|not found|waiting for|no element/i;

export function classifyByRules(context: FailureContext): FailureType | null {
  const errorText = `${context.errorName}\n${context.message}`;
  const allText = `${errorText}\n${context.domSnippet}`;
  if (context.errorName === "CaptchaHit" || CAPTCHA_PATTERN.test(allText)) {
    return "CAPTCHA_HIT";
  }
  if (context.errorName === "ExternalPortal" || /external portal|phone only/i.test(errorText)) {
    return "EXTERNAL_PORTAL";
  }
  if (context.errorName === "ValidationError" || VALIDATION_PATTERN.test(allText)) {
    return "VALIDATION_ERROR";
  }
  if (context.errorName === "ElementClickIntercepted" || POPUP_PATTERN.test(errorText)) {
    return "POPUP_BLOCKED";
  }
  if (
    context.errorName === "TimeoutError" ||
    context.errorName === "ConfirmationTimeout" ||
    STALE_PATTERN.test(errorText)
  ) {
    return "SELECTOR_STALE";
  }
  return null;
}
