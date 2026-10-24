CREATE TABLE monitor_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  baseline_next_page INTEGER NOT NULL DEFAULT 1,
  baseline_completed_at TEXT,
  audit_next_page INTEGER NOT NULL DEFAULT 1,
  audit_due_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TEXT
);
INSERT INTO monitor_state (id) VALUES (1);

CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  published_on TEXT,
  document_url TEXT,
  fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE notice_versions (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL REFERENCES notices(id),
  kind TEXT NOT NULL CHECK (kind IN ('new', 'updated')),
  title TEXT NOT NULL,
  published_on TEXT,
  document_url TEXT,
  detected_at TEXT NOT NULL
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES notice_versions(id),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'failed', 'uncertain')),
  payload_json TEXT,
  created_at TEXT NOT NULL,
  first_attempt_at TEXT,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  resend_id TEXT,
  accepted_at TEXT,
  last_error TEXT,
  UNIQUE (version_id, recipient)
);
CREATE INDEX outbox_pending ON outbox (status, next_attempt_at);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  pages INTEGER NOT NULL,
  notices INTEGER NOT NULL,
  notifications INTEGER NOT NULL,
  error TEXT
);
