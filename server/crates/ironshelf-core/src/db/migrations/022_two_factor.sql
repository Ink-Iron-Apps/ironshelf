-- 2FA: TOTP secret per user (opt-in; enabled=0 until verified)
CREATE TABLE IF NOT EXISTS user_totp (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret  TEXT    NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Single-use recovery codes (hashed); used=1 once consumed
CREATE TABLE IF NOT EXISTS user_totp_recovery (
    user_id   TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT    NOT NULL,
    used      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, code_hash)
);
