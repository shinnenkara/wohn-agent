export type Alert =
  | { type: "SESSION_EXPIRED" }
  | { type: "CAPTCHA_OPEN" }
  | { type: "APPLIED"; scoutId: string; title: string; url: string }
  | { type: "MANUAL_REQUIRED"; scoutId: string; url: string; reason: string };

export interface Notifier {
  notify(alert: Alert): Promise<void>;
}
