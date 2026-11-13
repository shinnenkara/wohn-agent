CREATE TABLE IF NOT EXISTS document_submissions (
  scout_id TEXT PRIMARY KEY,
  mail_id TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lease_audits (
  mail_id TEXT PRIMARY KEY,
  scorecard_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO action_templates (code, intent_code, title_template, sla_minutes, console_hotkey) VALUES
  ('REQUEST_ERASURE', 'REQUEST_ERASURE', 'Request data deletion', 1440, 'd');
