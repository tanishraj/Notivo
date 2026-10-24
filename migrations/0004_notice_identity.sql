-- Keep cancellation history when a queue entry was not a genuinely new announcement.
ALTER TABLE monitor_state ADD COLUMN source_total INTEGER;
CREATE TABLE outbox_next (
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
INSERT INTO outbox_next SELECT * FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_next RENAME TO outbox;
CREATE INDEX outbox_pending ON outbox (status, next_attempt_at);
CREATE INDEX outbox_history ON outbox (created_at DESC, id DESC);

-- Reconcile an unlinked baseline row with the same title/date's linked row.
-- Merge only an unambiguous pair. Distinct linked notices are never merged.
CREATE TABLE notice_identity_repair AS
SELECT old.id AS old_id, linked.id AS linked_id
FROM notices old JOIN notices linked ON old.title = linked.title AND old.published_on IS linked.published_on
WHERE substr(old.id, 1, 5) = 'text:' AND old.document_url IS NULL AND linked.document_url IS NOT NULL
AND (SELECT COUNT(*) FROM notices other WHERE other.title = old.title AND other.published_on IS old.published_on AND other.document_url IS NOT NULL) = 1;

UPDATE outbox SET status = CASE WHEN attempts = 0 THEN 'cancelled' ELSE 'uncertain' END,
last_error = CASE WHEN attempts = 0 THEN 'Existing notice gained a document link, not a new announcement. No email sent.' ELSE 'Existing notice reclassified. Reconcile the earlier attempt with Resend before sending again.' END
WHERE status = 'pending' AND version_id IN (SELECT v.id FROM notice_versions v JOIN notice_identity_repair r ON v.notice_id = r.linked_id WHERE v.kind = 'new');

UPDATE notice_versions SET kind = 'updated' WHERE kind = 'new' AND notice_id IN (SELECT linked_id FROM notice_identity_repair);
UPDATE notices SET first_seen_at = MIN(first_seen_at, (SELECT old.first_seen_at FROM notices old JOIN notice_identity_repair r ON old.id = r.old_id WHERE r.linked_id = notices.id))
WHERE id IN (SELECT linked_id FROM notice_identity_repair);
UPDATE notice_versions SET notice_id = (SELECT linked_id FROM notice_identity_repair WHERE old_id = notice_versions.notice_id)
WHERE notice_id IN (SELECT old_id FROM notice_identity_repair);
DELETE FROM notices WHERE id IN (SELECT old_id FROM notice_identity_repair);
DROP TABLE notice_identity_repair;

-- New-entry notifications only. Retain all existing-notice changes in history.
UPDATE outbox SET status = CASE WHEN attempts = 0 THEN 'cancelled' ELSE 'uncertain' END,
last_error = CASE WHEN attempts = 0 THEN 'Existing notice metadata changed. Notifications are enabled for new entries only. No email sent.' ELSE 'Existing-notice update no longer eligible. Reconcile the earlier attempt with Resend.' END
WHERE status = 'pending' AND version_id IN (SELECT id FROM notice_versions WHERE kind = 'updated');
