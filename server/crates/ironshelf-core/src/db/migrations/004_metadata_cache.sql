-- Metadata enrichment: external provider cache + user-applied overrides.

CREATE TABLE IF NOT EXISTS metadata_cache (
    book_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT,
    metadata_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (book_id, provider)
);

CREATE TABLE IF NOT EXISTS book_overrides (
    book_id TEXT PRIMARY KEY NOT NULL,
    title TEXT,
    description TEXT,
    cover_url TEXT,
    tags_json TEXT,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
