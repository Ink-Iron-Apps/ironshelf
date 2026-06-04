-- Per-user pinned libraries. Pins were previously kept only in the browser's
-- localStorage, so they did not survive cache clears, incognito sessions, or
-- moving between the hosted dashboard and the server's own UI (separate
-- origins). Storing them per user makes pins follow the account everywhere.

CREATE TABLE IF NOT EXISTS pinned_libraries (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    library_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, library_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_libraries_user
    ON pinned_libraries(user_id, position);
