CREATE TABLE IF NOT EXISTS intent_types (
  code TEXT PRIMARY KEY,
  default_priority TEXT NOT NULL,
  notify INTEGER NOT NULL,
  dsk_phase TEXT NOT NULL
);

INSERT OR IGNORE INTO intent_types (code, default_priority, notify, dsk_phase) VALUES
  ('PORTAL_INVITE_LINK', 'P0_CRITICAL', 1, 'any'),
  ('APPT_PROPOSAL', 'P0_CRITICAL', 1, 'any'),
  ('CONTRACT_DRAFT_REVIEW', 'P0_CRITICAL', 1, 'any'),
  ('CONTRACT_SIGNING_ARR', 'P0_CRITICAL', 1, 'any'),
  ('APPT_CONFIRMATION', 'P1_HIGH', 1, 'any'),
  ('POST_VIEWING_INTEREST', 'P1_HIGH', 1, 'any'),
  ('SELF_DISCLOSURE_REQ', 'P1_HIGH', 1, 'B'),
  ('DOC_PACKAGE_REQ', 'P1_HIGH', 1, 'B'),
  ('SCAM_SUSPECTED', 'P2_WARNING', 1, 'any'),
  ('IS24_AUTO_ACK', 'P3_SILENT', 0, 'any'),
  ('LANDLORD_WAIT_ACK', 'P3_SILENT', 0, 'any'),
  ('REJECTION', 'P3_SILENT', 0, 'any');

CREATE TABLE IF NOT EXISTS mail_extracted_intents (
  mail_id TEXT NOT NULL,
  intent_code TEXT NOT NULL,
  confidence REAL NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  dsk_violation INTEGER NOT NULL,
  PRIMARY KEY (mail_id, intent_code)
);

CREATE TABLE IF NOT EXISTS mail_risk (
  mail_id TEXT PRIMARY KEY,
  risk_level TEXT NOT NULL,
  red_flags_json TEXT NOT NULL
);
