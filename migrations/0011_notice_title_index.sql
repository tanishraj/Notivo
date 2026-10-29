-- Each scan looks up stored notices by title and published date. Without this index that lookup read the whole table once per scanned row.
CREATE INDEX notices_title_published ON notices (title, published_on);
