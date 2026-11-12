CREATE TABLE IF NOT EXISTS action_templates (
  code TEXT PRIMARY KEY,
  intent_code TEXT NOT NULL,
  title_template TEXT NOT NULL,
  sla_minutes INTEGER NOT NULL,
  console_hotkey TEXT NOT NULL
);

INSERT OR IGNORE INTO action_templates (code, intent_code, title_template, sla_minutes, console_hotkey) VALUES
  ('OPEN_PORTAL', 'PORTAL_INVITE_LINK', 'Open booking link', 15, 'o'),
  ('ANSWER_PROPOSAL', 'APPT_PROPOSAL', 'Answer viewing proposal', 30, 'd'),
  ('CONFIRM_APPT', 'APPT_CONFIRMATION', 'Confirm appointment', 60, 'd'),
  ('SIGNING_SLOT', 'CONTRACT_SIGNING_ARR', 'Confirm signing time', 120, 'd'),
  ('REVIEW_CONTRACT', 'CONTRACT_DRAFT_REVIEW', 'Review contract', 240, 'd'),
  ('POST_VIEWING', 'POST_VIEWING_INTEREST', 'Reply after viewing', 240, 'd'),
  ('SEND_DISCLOSURE', 'SELF_DISCLOSURE_REQ', 'Send self-disclosure', 1440, 'd'),
  ('SEND_DOCUMENTS', 'DOC_PACKAGE_REQ', 'Send documents', 1440, 'd'),
  ('REVIEW_SCAM', 'SCAM_SUSPECTED', 'Review suspected scam', 60, 's');

CREATE TABLE IF NOT EXISTS user_mail_actions (
  id INTEGER PRIMARY KEY,
  scout_id TEXT NOT NULL DEFAULT '',
  mail_id TEXT NOT NULL,
  intent_code TEXT NOT NULL,
  action_code TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  action_url TEXT NOT NULL,
  draft_response_text TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (mail_id, intent_code)
);

CREATE TABLE IF NOT EXISTS scout_quarantine (
  scout_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
