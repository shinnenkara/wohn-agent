export type Alert =
  | { type: "SESSION_EXPIRED" }
  | { type: "CAPTCHA_OPEN" }
  | { type: "APPLIED"; scoutId: string; title: string; url: string }
  | { type: "MANUAL_REQUIRED"; scoutId: string; url: string; reason: string }
  | {
      type: "MAIL_DRAFT";
      scoutId: string;
      intent: string;
      body: string;
      altBody: string;
      composeUrl: string;
      altComposeUrl: string;
      messageUrl: string;
      actionUrl: string;
    }
  | {
      type: "MAIL_TRIAGE";
      scoutId: string;
      priority: string;
      riskLevel: string;
      summary: string;
      messageUrl: string;
      actionUrl: string;
    };

export interface Notifier {
  notify(alert: Alert): Promise<void>;
}
