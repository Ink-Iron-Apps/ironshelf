-- Migration 021: DB-driven multi-provider SSO (Google OIDC, GitHub OAuth2, custom).
--
-- Complements the legacy file-config OIDC (config.oidc + routes/oidc.rs), which
-- stays untouched for back-compat. These tables are the new, no-restart way to
-- configure login providers per server.

-- Configured login providers, managed by the owner via the admin API.
CREATE TABLE IF NOT EXISTS auth_providers (
    id            TEXT PRIMARY KEY NOT NULL,   -- slug: 'google','github', or custom
    kind          TEXT NOT NULL,               -- 'oidc' | 'oauth2'
    display_name  TEXT NOT NULL,
    client_id     TEXT NOT NULL,
    client_secret TEXT,                         -- nullable (public PKCE clients)
    issuer_url    TEXT,                          -- oidc only (discovery base)
    authorize_url TEXT,                          -- oauth2 only
    token_url     TEXT,                          -- oauth2 only
    userinfo_url  TEXT,                          -- oauth2 only
    scopes        TEXT,                          -- space-separated; null → preset default
    enabled       INTEGER NOT NULL DEFAULT 1,
    auto_register INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- External identities linked to local users (account linking; Plex/Jellyfin style).
-- One user may link many providers; (provider_id, subject) is the stable join key.
CREATE TABLE IF NOT EXISTS user_identities (
    provider_id TEXT NOT NULL,                   -- → auth_providers.id (or 'legacy-oidc')
    subject     TEXT NOT NULL,                   -- provider's stable user id
    user_id     TEXT NOT NULL,                   -- → users.id
    email       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (provider_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
