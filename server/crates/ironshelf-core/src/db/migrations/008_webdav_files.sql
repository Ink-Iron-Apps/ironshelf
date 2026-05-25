-- Migration 008: WebDAV virtual file storage for KOReader sync.
CREATE TABLE IF NOT EXISTS webdav_files (
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content BLOB,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, path)
);
