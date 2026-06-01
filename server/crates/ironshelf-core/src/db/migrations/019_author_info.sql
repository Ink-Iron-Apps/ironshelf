-- Cached author biography/metadata, keyed by normalized author name. Mirrors
-- author_images: not_found avoids re-querying upstream for authors with none.
CREATE TABLE IF NOT EXISTS author_info (
    author_key      TEXT PRIMARY KEY,
    bio             TEXT,
    birth_date      TEXT,
    death_date      TEXT,
    openlibrary_url TEXT,
    wikipedia_url   TEXT,
    not_found       INTEGER NOT NULL DEFAULT 0,
    fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
