CREATE TABLE IF NOT EXISTS reply_draft (
  mail_id TEXT PRIMARY KEY,
  intent TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  alt_body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS open_topic (
  scout_id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  relation TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
