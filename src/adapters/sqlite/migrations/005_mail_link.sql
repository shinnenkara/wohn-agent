ALTER TABLE mail ADD COLUMN clean_delta_text TEXT NOT NULL DEFAULT '';
ALTER TABLE mail ADD COLUMN in_reply_to TEXT NOT NULL DEFAULT '';
ALTER TABLE mail ADD COLUMN references_header TEXT NOT NULL DEFAULT '';
ALTER TABLE mail ADD COLUMN link_method TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS email_threads (
  provider_thread_id TEXT PRIMARY KEY,
  subject_normalized TEXT NOT NULL DEFAULT '',
  sender_domain TEXT NOT NULL DEFAULT '',
  scout_id TEXT NOT NULL DEFAULT '',
  link_method TEXT NOT NULL DEFAULT ''
);

ALTER TABLE listings ADD COLUMN sent_message TEXT NOT NULL DEFAULT '';
