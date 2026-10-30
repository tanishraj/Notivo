PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial.sql','2026-10-30 01:27:29');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0002_portal_indexes.sql','2026-10-30 01:27:29');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0003_auth_and_settings.sql','2026-10-30 01:27:29');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(4,'0004_notice_identity.sql','2026-10-30 01:27:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(5,'0005_manual_email.sql','2026-10-30 01:27:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(6,'0006_email_activity.sql','2026-10-30 01:27:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(7,'0007_email_retries.sql','2026-10-30 01:27:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(8,'0008_quiet_archive_entries.sql','2026-10-30 01:27:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(9,'0009_notice_reviews.sql','2026-10-30 01:27:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(10,'0010_notice_removals.sql','2026-10-30 01:27:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(11,'0011_notice_title_index.sql','2026-10-30 01:27:30');
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
, source_total INTEGER, admin_alerted_at TEXT, admin_alert_attempted_at TEXT, outage_alerted_at TEXT);
INSERT INTO "monitor_state" ("id","baseline_next_page","baseline_completed_at","audit_next_page","audit_due_at","last_success_at","last_error","consecutive_failures","lease_owner","lease_until","source_total","admin_alerted_at","admin_alert_attempted_at","outage_alerted_at") VALUES(1,1,'2026-10-01T00:00:00.000Z',1,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL);
CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  published_on TEXT,
  document_url TEXT,
  fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
, removed_at TEXT, removal_checked_at TEXT);
INSERT INTO "notices" ("id","title","published_on","document_url","fingerprint","first_seen_at","last_seen_at","removed_at","removal_checked_at") VALUES('48','Exported notice','2026-10-22','https://nmc.org.in/whats-new/download/48','f','2026-10-22T00:00:00.000Z','2026-10-22T00:00:00.000Z',NULL,NULL);
CREATE TABLE notice_versions (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL REFERENCES notices(id),
  kind TEXT NOT NULL CHECK (kind IN ('new', 'updated')),
  title TEXT NOT NULL,
  published_on TEXT,
  document_url TEXT,
  detected_at TEXT NOT NULL
);
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
CREATE TABLE IF NOT EXISTS "auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE IF NOT EXISTS "auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_user" ("id") on delete cascade);
CREATE TABLE IF NOT EXISTS "auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE IF NOT EXISTS "auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
CREATE TABLE IF NOT EXISTS "auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
CREATE TABLE auth_setup (id INTEGER PRIMARY KEY CHECK (id = 1), lock_id TEXT, locked_until INTEGER);
INSERT INTO "auth_setup" ("id","lock_id","locked_until") VALUES(1,NULL,NULL);
CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1), config_json TEXT NOT NULL DEFAULT '{}', resend_cipher TEXT, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
INSERT INTO "app_settings" ("id","config_json","resend_cipher","revision","updated_at") VALUES(1,'{}',NULL,0,NULL);
CREATE TABLE IF NOT EXISTS "outbox" (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES notice_versions(id),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'failed', 'uncertain', 'cancelled')),
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
CREATE TABLE email_dismissals (
  delivery_source TEXT NOT NULL CHECK (delivery_source IN ('automatic', 'manual')),
  delivery_id TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (delivery_source, delivery_id)
);
CREATE TABLE email_retries (
  request_id TEXT PRIMARY KEY REFERENCES manual_email_requests(id),
  delivery_source TEXT NOT NULL CHECK (delivery_source IN ('automatic', 'manual')),
  delivery_id TEXT NOT NULL
);
CREATE TABLE notice_reviews (
  notice_id TEXT PRIMARY KEY REFERENCES notices(id),
  version_id TEXT NOT NULL REFERENCES notice_versions(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'sent', 'dismissed')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',11);
CREATE INDEX notice_versions_history ON notice_versions (notice_id, detected_at DESC);
CREATE INDEX notices_published ON notices (published_on DESC, first_seen_at DESC, id DESC);
CREATE INDEX "auth_session_userId_idx" on "auth_session" ("userId");
CREATE INDEX "auth_account_userId_idx" on "auth_account" ("userId");
CREATE INDEX "auth_verification_identifier_idx" on "auth_verification" ("identifier");
CREATE UNIQUE INDEX auth_single_admin ON auth_user ((1));
CREATE INDEX outbox_pending ON outbox (status, next_attempt_at);
CREATE INDEX outbox_history ON outbox (created_at DESC, id DESC);
CREATE INDEX manual_deliveries_pending ON manual_deliveries(status, next_attempt_at);
CREATE INDEX manual_deliveries_notice ON manual_deliveries(notice_id, created_at DESC);
CREATE INDEX email_retries_original ON email_retries(delivery_source, delivery_id);
CREATE INDEX notice_reviews_waiting ON notice_reviews (status, created_at);
CREATE INDEX notices_title_published ON notices (title, published_on);
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
CREATE VIEW email_activity AS
SELECT d.*, x.dismissed_at,
  CASE WHEN d.status IN ('failed', 'uncertain') AND EXISTS (
    SELECT 1 FROM email_deliveries succeeded
    WHERE succeeded.notice_id = d.notice_id AND succeeded.recipient = d.recipient
      AND succeeded.status = 'accepted'
      AND COALESCE(succeeded.accepted_at, succeeded.created_at) >= d.created_at
  ) THEN 1 ELSE 0 END AS resolved
FROM email_deliveries d LEFT JOIN email_dismissals x
  ON x.delivery_source = d.delivery_source AND x.delivery_id = d.delivery_id;
CREATE VIEW email_activity_current AS
SELECT a.*,
  EXISTS (SELECT 1 FROM email_retries r WHERE r.delivery_source = a.delivery_source AND r.delivery_id = a.delivery_id) AS retried,
  EXISTS (SELECT 1 FROM email_deliveries p WHERE p.notice_id = a.notice_id AND p.recipient = a.recipient AND p.status = 'pending') AS retry_pending,
  (SELECT r.delivery_id FROM email_retries r WHERE r.request_id = a.manual_request_id) AS retry_of_id
FROM email_activity a;