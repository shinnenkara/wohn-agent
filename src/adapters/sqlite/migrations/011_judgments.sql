CREATE TABLE IF NOT EXISTS model_judgment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  scout_id TEXT NOT NULL DEFAULT '',
  mail_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('mail_triage', 'mail_propose', 'mail_resolve', 'rules')),
  branch TEXT NOT NULL CHECK (branch IN ('rules', 'model', 'rules_fallback')),
  model TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT '',
  proposal_json TEXT NOT NULL DEFAULT '',
  decision_json TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS model_judgment_scout ON model_judgment (scout_id);

CREATE INDEX IF NOT EXISTS model_judgment_mail ON model_judgment (mail_id);
