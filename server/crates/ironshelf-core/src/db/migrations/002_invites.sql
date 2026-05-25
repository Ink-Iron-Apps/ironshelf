-- Invite codes for user registration gating.

CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    used_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    used_at TEXT
);
