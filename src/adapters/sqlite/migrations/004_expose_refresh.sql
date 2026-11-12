CREATE TABLE IF NOT EXISTS expose_refresh (
  scout_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('queued', 'failed')),
  detail TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL
);
