CREATE TABLE email_dismissals (
  delivery_source TEXT NOT NULL CHECK (delivery_source IN ('automatic', 'manual')),
  delivery_id TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (delivery_source, delivery_id)
);

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
