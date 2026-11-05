import type { Alert } from "../../application/ports/notifier.js";

export const CAPTCHA_ALERT_TEXT =
  "🚨 CAPTCHA triggered on ImmoScout24. Loop paused. Solve it in the local Chrome window to resume.";

export function formatAlert(alert: Alert): string {
  switch (alert.type) {
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED on ImmoScout24. Log in again in the local Chrome window to resume.";
    case "CAPTCHA_OPEN":
      return CAPTCHA_ALERT_TEXT;
    case "APPLIED":
      return `Applied to ${alert.title} (${alert.scoutId})\n${alert.url}`;
    case "MANUAL_REQUIRED":
      return `MANUAL_REQUIRED ${alert.scoutId}: ${alert.reason}\n${alert.url}`;
  }
}
