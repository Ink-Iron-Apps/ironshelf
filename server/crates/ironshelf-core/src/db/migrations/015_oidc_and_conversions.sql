-- Migration 013: OIDC user fields + conversion jobs table + duplicate flags.

-- OIDC subject/issuer on users table for SSO login.
ALTER TABLE users ADD COLUMN oidc_subject TEXT;
ALTER TABLE users ADD COLUMN oidc_issuer TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc ON users(oidc_issuer, oidc_subject);

-- On-demand format conversion jobs.
CREATE TABLE IF NOT EXISTS conversion_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    source_format TEXT NOT NULL,
    target_format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    output_path TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversion_jobs_user ON conversion_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status ON conversion_jobs(status);

-- Duplicate resolution flags (soft-delete, doesn't touch Calibre files).
CREATE TABLE IF NOT EXISTS duplicate_flags (
    book_id TEXT NOT NULL,
    library_id TEXT NOT NULL,
    flagged_by TEXT NOT NULL,
    flagged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    reason TEXT,
    PRIMARY KEY (book_id, library_id)
);
