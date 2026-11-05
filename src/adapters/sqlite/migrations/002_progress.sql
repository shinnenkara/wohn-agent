CREATE TABLE IF NOT EXISTS progress (
  scout_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN (
    'discovered', 'filtered_out', 'manual', 'failed', 'applied',
    'in_conversation', 'viewing_offered', 'scheduled'
  )),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress_transition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scout_id TEXT NOT NULL,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('apply', 'mail', 'calendar', 'backfill')),
  evidence_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  token_json TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  gmail_history_id TEXT,
  calendar_sync_token TEXT
);

CREATE TABLE IF NOT EXISTS mail (
  gmail_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('notice', 'message_copy', 'landlord', 'unclassified')),
  scout_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_event (
  event_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  place TEXT NOT NULL,
  scout_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading (
  mail_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('failed', 'proposed')),
  payload TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
