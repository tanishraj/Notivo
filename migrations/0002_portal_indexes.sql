CREATE INDEX notice_versions_history ON notice_versions (notice_id, detected_at DESC);
CREATE INDEX notices_published ON notices (published_on DESC, first_seen_at DESC, id DESC);
CREATE INDEX outbox_history ON outbox (created_at DESC, id DESC);
