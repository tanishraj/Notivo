-- Manual shares have their own immutable snapshot and audit trail. They must not
-- create notice versions or turn an imported archive entry into a new notice.
CREATE TABLE manual_email_requests (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL,
  settings_revision INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE manual_deliveries (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES manual_email_requests(id),
  notice_id TEXT NOT NULL,
  title TEXT NOT NULL,
  published_on TEXT,
  document_url TEXT,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'failed', 'uncertain', 'cancelled')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  first_attempt_at TEXT,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  resend_id TEXT,
  accepted_at TEXT,
  last_error TEXT,
  UNIQUE(request_id, recipient)
);
CREATE INDEX manual_deliveries_pending ON manual_deliveries(status, next_attempt_at);
CREATE INDEX manual_deliveries_notice ON manual_deliveries(notice_id, created_at DESC);

CREATE VIEW email_deliveries AS
SELECT o.id AS delivery_id, v.id, v.notice_id, v.kind, v.title,
  v.published_on, v.document_url, v.detected_at, o.recipient, o.status,
  o.payload_json, o.created_at, o.first_attempt_at, o.next_attempt_at,
  o.attempts, o.resend_id, o.accepted_at, o.last_error,
  'automatic' AS delivery_source, NULL AS manual_request_id
FROM outbox o JOIN notice_versions v ON v.id = o.version_id
UNION ALL
SELECT m.id AS delivery_id, m.id, m.notice_id, 'new' AS kind, m.title,
  m.published_on, m.document_url, m.created_at AS detected_at, m.recipient, m.status,
  m.payload_json, m.created_at, m.first_attempt_at, m.next_attempt_at,
  m.attempts, m.resend_id, m.accepted_at, m.last_error,
  'manual' AS delivery_source, m.request_id AS manual_request_id
FROM manual_deliveries m;
