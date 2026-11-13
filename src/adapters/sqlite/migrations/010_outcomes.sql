ALTER TABLE progress ADD COLUMN outcome TEXT NOT NULL DEFAULT 'open';

ALTER TABLE reply_draft ADD COLUMN other_body TEXT NOT NULL DEFAULT '';

INSERT OR IGNORE INTO action_templates (code, intent_code, title_template, sla_minutes, console_hotkey) VALUES
  ('RESCHEDULE_APPT', 'APPT_SLOT_CANCELLED', 'Answer cancelled viewing', 30, 'd');
