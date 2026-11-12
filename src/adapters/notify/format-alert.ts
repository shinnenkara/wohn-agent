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
    case "MAIL_DRAFT":
      return formatDraft(alert);
    case "MAIL_TRIAGE":
      return formatTriage(alert);
  }
}

function formatTriage(alert: Extract<Alert, { type: "MAIL_TRIAGE" }>): string {
  const lines = [`Triage (${alert.priority || alert.riskLevel}) for ${alert.scoutId}`];
  if (alert.actionUrl) {
    lines.push(alert.actionUrl);
  }
  lines.push(alert.summary);
  if (alert.messageUrl) {
    lines.push(`Message: ${alert.messageUrl}`);
  }
  return lines.join("\n\n");
}

function formatDraft(alert: Extract<Alert, { type: "MAIL_DRAFT" }>): string {
  const lines = [`Draft (${alert.intent}) for ${alert.scoutId}`];
  if (alert.actionUrl) {
    lines.push(alert.actionUrl);
  }
  lines.push(alert.body);
  if (alert.composeUrl) {
    lines.push(`Open in Gmail: ${alert.composeUrl}`);
  }
  if (alert.altBody) {
    lines.push(alert.altBody);
    if (alert.altComposeUrl) {
      lines.push(`Other reply in Gmail: ${alert.altComposeUrl}`);
    }
  }
  if (alert.messageUrl) {
    lines.push(`Message: ${alert.messageUrl}`);
  }
  return lines.join("\n\n");
}
