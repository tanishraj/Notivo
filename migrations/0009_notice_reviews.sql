-- New entries Notivo cannot classify with certainty wait here until the admin sends or dismisses them. Nothing is dropped silently.
CREATE TABLE notice_reviews (
  notice_id TEXT PRIMARY KEY REFERENCES notices(id),
  version_id TEXT NOT NULL REFERENCES notice_versions(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'sent', 'dismissed')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX notice_reviews_waiting ON notice_reviews (status, created_at);

-- Attention emails to the admin: when the last one was sent or attempted, and which outage it reported.
ALTER TABLE monitor_state ADD COLUMN admin_alerted_at TEXT;
ALTER TABLE monitor_state ADD COLUMN admin_alert_attempted_at TEXT;
ALTER TABLE monitor_state ADD COLUMN outage_alerted_at TEXT;
