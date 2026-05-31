-- Cached author portrait images, keyed by normalized (lowercased, trimmed)
-- author name. image is NULL when a lookup found nothing (not_found = 1), which
-- lets us avoid re-querying the upstream provider on every request.
CREATE TABLE IF NOT EXISTS author_images (
    author_key   TEXT PRIMARY KEY,
    image        BLOB,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    not_found    INTEGER NOT NULL DEFAULT 0,
    fetched_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
