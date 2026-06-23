# Auth Providers — Multi-Provider SSO Design

Internal design note (caveman style). Scope: add Google + GitHub (and arbitrary OIDC/OAuth2)
login alongside existing local accounts. Spec for the implementation that follows.

## Why
Today: local user/pass + ONE file-config OIDC provider (`config.oidc`, `routes/oidc.rs`) + Ironshelf
Cloud login. Want: pick login providers per-server, incl Google (OIDC) + GitHub (OAuth2), w/o
editing TOML. Must be extensible (GitLab/Discord/Authentik/etc later) → plugin-shaped surface.

## Key facts about existing code (don't break these)
- `users`: id, username, password_hash, is_owner, created_at (+ `oidc_subject`,`oidc_issuer` added
  via `add_column_if_missing` in `migrate()`), unique idx `idx_users_oidc(oidc_issuer,oidc_subject)`.
- Sessions: `sessions(id=hash_session_id(raw), user_id, expires_at)`; cookie `ironshelf_session`.
  `auth::hash_session_id`, `auth::AuthUser{user_id,username,is_owner}`, `auth::require_owner`.
- OIDC flow `routes/oidc.rs`: PKCE S256, in-mem `OidcStateStore{state→pkce_verifier, TTL 5m}`,
  discovery doc fetch, code exchange, decode id_token payload (NO sig verify — HTTPS trust model),
  `find_or_create_oidc_user` (auto_register gate), then `create_session` + 302 to `/#/`.
- Routes wired in `main.rs` `auth_routes` (public, pre-auth-middleware):
  `/api/v1/auth/oidc/login`, `/api/v1/auth/oidc/callback`.
- Migrations = ordered `include_str!` list in `db::migrate()`; next free = **021**.
- Web login `web/js/app.js` ~L1551: reads `serverInfo.oidc_enabled` → renders ONE
  `<a href="${API}/auth/oidc/login">Sign in with SSO</a>`.
- `server_info` (`routes/server_info.rs`) public; does NOT currently emit `oidc_enabled` (UI reads a
  field that isn't set → SSO button never shows today).

## Decision: keep legacy, add DB-driven multi-provider ALONGSIDE
- LEAVE `config.oidc` + `routes/oidc.rs` + `/auth/oidc/*` UNTOUCHED (back-compat for anyone already
  using file-config OIDC). Mark legacy.
- ADD a DB-driven provider system. New providers (Google, GitHub, custom) live in DB, managed by
  owner via API/UI. No TOML edit, no restart.
- No risky data migration of existing oidc_* users. Legacy users keep working via legacy route.

## Data model (migration 021)
```
auth_providers(
  id            TEXT PK,          -- slug: 'google','github', or custom
  kind          TEXT NOT NULL,    -- 'oidc' | 'oauth2'
  display_name  TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  client_secret TEXT,             -- nullable (public PKCE clients)
  issuer_url    TEXT,             -- oidc only (discovery base)
  authorize_url TEXT,             -- oauth2 only
  token_url     TEXT,             -- oauth2 only
  userinfo_url  TEXT,             -- oauth2 only
  scopes        TEXT,             -- space-separated; null → preset default
  enabled       INTEGER NOT NULL DEFAULT 1,
  auto_register INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (...)
)

user_identities(                  -- linked external identities (account linking)
  provider_id TEXT NOT NULL,      -- → auth_providers.id (or 'legacy-oidc')
  subject     TEXT NOT NULL,      -- provider's stable user id (oidc sub / github id)
  user_id     TEXT NOT NULL,      -- → users.id
  email       TEXT,
  created_at  TEXT NOT NULL DEFAULT (...),
  PRIMARY KEY (provider_id, subject)
)
CREATE INDEX idx_user_identities_user ON user_identities(user_id);
```
Why `user_identities` not more columns on `users`: one user can link many providers (Google AND
GitHub AND local). `(provider_id,subject)` = the stable join key (Plex/Jellyfin style).

## Built-in presets (admin enters only client_id/secret + enable)
- **google**: kind=oidc, issuer=`https://accounts.google.com`, scopes=`openid email profile`.
- **github**: kind=oauth2, authorize=`https://github.com/login/oauth/authorize`,
  token=`https://github.com/login/oauth/access_token`, userinfo=`https://api.github.com/user`,
  scopes=`read:user user:email`. (Email via `https://api.github.com/user/emails` when granted.)
- Custom provider: admin supplies all endpoint fields.
Preset fills any null endpoint/scope fields at load by slug; admin can override.

## Identity extraction
- **OIDC**: discovery → code+PKCE exchange → decode `id_token` payload → `sub`,`email`,
  `preferred_username`/`name`. (Same as legacy oidc.rs; helpers re-used in `sso.rs`.)
- **OAuth2 (GitHub)**: code exchange (header `Accept: application/json`) → `access_token` →
  GET `userinfo_url` w/ `Authorization: Bearer` (+ `User-Agent`, required by GitHub) → `id`(subject),
  `login`(username), `name`,`email`. If email null + email scope → GET `/user/emails`, pick primary
  verified.

## Routes
Public (pre-auth):
- `GET /api/v1/auth/providers` → `[{id,display_name,kind}]` for ENABLED providers (login buttons).
- `GET /api/v1/auth/sso/{provider}/login` → `{redirect_url}` (build authorize URL; store state).
- `GET /api/v1/auth/sso/{provider}/callback?code=&state=` → set session cookie, 302 `/#/`.
Owner-only admin:
- `GET /api/v1/admin/auth-providers` → list all (secret redacted to `"***"` when set).
- `PUT /api/v1/admin/auth-providers/{id}` → upsert (body: kind, display_name, client_id,
  client_secret?, endpoints?, scopes?, enabled, auto_register). Preset fills blanks by slug.
- `DELETE /api/v1/admin/auth-providers/{id}`.

## State store
New `SsoStateStore{ state → (provider_id, pkce_verifier:Option<String>) , TTL 5m, cap 1000 }`
(same shape/discipline as `OidcStateStore`; OAuth2 entries carry `None` pkce). Lives in `AppState`.

## find-or-create + linking
1. Lookup `user_identities WHERE provider_id=? AND subject=?` → if found, that `user_id`.
2. Else if a logged-in session exists (link flow) → link to current user. (v1: not wired; future.)
3. Else if `auto_register` → create `users` row (password_hash='', is_owner=0), insert identity,
   grant default `read`+`download` perms (mirror legacy), unique-username from
   email/login/sub. Else 403 (no account + auto-register off).
Email-based auto-link across providers = DEFERRED (security: requires verified-email trust). v1 keys
strictly on `(provider,subject)`.

## UI
- **Web** (`app.js`): login screen fetches `/auth/providers`, renders one button each →
  `${API}/auth/sso/${id}/login` (Google/GitHub branded). Owner Settings → "Login Providers" section:
  list, enable/disable, set client_id/secret, save (PUT), delete.
- **Flutter**: DEFERRED to follow-up. SSO needs in-app webview/external-browser + deep-link callback
  capture (`ironshelf://auth` or loopback) — own chunk, must be built against a running device, not
  blind. App keeps local + server-URL login meanwhile.

## Security notes
- Providers public-listed expose only id/name/kind — never secrets.
- Admin GET redacts client_secret.
- Callback validates state (CSRF) via store; OIDC keeps PKCE; GitHub OAuth2 uses state.
- id_token still payload-decoded only (HTTPS trust) — consistent w/ legacy; JWKS verify = future.
- Same fail-closed posture as ACL: unknown/disabled provider → 404/400, never silent allow.

## Phasing within this build
1. Migration 021 + DB methods. 2. `sso.rs` (providers list, login, callback; OIDC+OAuth2). 3. Admin
CRUD routes + wiring. 4. Web login buttons + admin section. 5. Flutter = documented follow-up.
