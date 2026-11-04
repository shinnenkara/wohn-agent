export const FAILURE_TYPES = [
  "POPUP_BLOCKED",
  "SELECTOR_STALE",
  "VALIDATION_ERROR",
  "EXTERNAL_PORTAL",
  "CAPTCHA_HIT",
] as const;

export type FailureType = (typeof FAILURE_TYPES)[number];

export function isFailureType(value: string): value is FailureType {
  return (FAILURE_TYPES as readonly string[]).includes(value);
}
