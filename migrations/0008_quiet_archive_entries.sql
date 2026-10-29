-- Old-dated new document IDs are now recorded as archive entries with no email row.
-- Remove the Cancelled email rows, and their "new" history entries, that the earlier 30-day rule created.
CREATE TABLE archive_cleanup AS SELECT DISTINCT version_id FROM outbox
WHERE status = 'cancelled' AND attempts = 0 AND last_error LIKE 'Published more than % days ago.%';

DELETE FROM outbox WHERE status = 'cancelled' AND attempts = 0
AND last_error LIKE 'Published more than % days ago.%';

DELETE FROM notice_versions WHERE kind = 'new'
AND id IN (SELECT version_id FROM archive_cleanup)
AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.version_id = notice_versions.id);

DROP TABLE archive_cleanup;
