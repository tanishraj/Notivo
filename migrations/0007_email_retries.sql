CREATE TABLE email_retries (
  request_id TEXT PRIMARY KEY REFERENCES manual_email_requests(id),
  delivery_source TEXT NOT NULL CHECK (delivery_source IN ('automatic', 'manual')),
  delivery_id TEXT NOT NULL
);
CREATE INDEX email_retries_original ON email_retries(delivery_source, delivery_id);

CREATE VIEW email_activity_current AS
SELECT a.*,
  EXISTS (SELECT 1 FROM email_retries r WHERE r.delivery_source = a.delivery_source AND r.delivery_id = a.delivery_id) AS retried,
  EXISTS (SELECT 1 FROM email_deliveries p WHERE p.notice_id = a.notice_id AND p.recipient = a.recipient AND p.status = 'pending') AS retry_pending,
  (SELECT r.delivery_id FROM email_retries r WHERE r.request_id = a.manual_request_id) AS retry_of_id
FROM email_activity a;
