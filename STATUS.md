# Ironshelf — Status / Session Handoff

Internal status (caveman style). Last update: 2026-06-22. Branch: `claude/dev`.
Self-contained — paste-and-go for a fresh session. Assumes zero prior chat context.

## How to resume in a fresh session
Read this whole file. Then: global rules at `S:\coding\CLAUDE.md` auto-load (claude/dev branch,
commit-per-task, caveman internal md, brand = Ink & Iron Apps). Strategy/vision doc:
`S:\coding\ebook-platform-strategy\STRATEGY.md`. SSO design detail: `docs/AUTH-PROVIDERS-DESIGN.md`.
Most likely next task = **build 2FA + hardening** (approved, not started — see PENDING below).

## Direction
Self-hosted "Plex for ebooks". Runs as plain port-bound HTTP server (Sonarr model)
→ operator brings own reverse-proxy/tunnel. NO built-in cloud/relay. Auth must be strong
enough to face the internet directly (no Zero Trust assumed).

## Repo orientation (key files)
- `server/` — Rust/Axum workspace. Two crates:
  - `crates/ironshelf-core` — domain models, Calibre reader, folder scanner, metadata, search.
    DB layer `src/db/mod.rs` (SQLite via sqlx). Migrations: `src/db/migrations/NNN_*.sql`, applied
    in order by `IronshelfDb::migrate()` as an `include_str!` list. **Next free migration = 022.**
    SQLite ALTER ADD COLUMN is non-idempotent → use `add_column_if_missing()` for new user columns.
  - `crates/ironshelf-server` — HTTP server. Routes in `src/routes/*` (registered in `src/main.rs`).
    Auth middleware `src/auth/mod.rs` (sessions + API keys + media tokens; `AuthUser{user_id,
    username,is_owner,session_id}`; `require_owner`, `hash_session_id`, `hash_password`,
    `verify_password`). Per-library ACL `src/access.rs` (`accessible_library_ids`, `library_allowed`).
    Shared state `src/state.rs` (`AppState`). Config `src/config/mod.rs`. Background tasks
    `src/scheduler.rs`. Security headers `src/middleware/security_headers.rs`. Rate limit
    `src/middleware/rate_limit.rs`.
  - SSO: `src/routes/sso.rs` (login flow + relocated OIDC/session helpers + `create_session`),
    `src/routes/admin_auth.rs` (owner CRUD), built-ins in `BUILTIN_PROVIDER_IDS`/`builtin_meta`.
  - Embedded web UI: `server/web/` (vanilla JS SPA, `web/js/app.js` ~9,100 lines; api helpers
    `apiGet/apiPost/apiPut/apiDelete`, `icon()`, `escapeHtml()`, `toast()`). Login screen + the
    "Login Providers" admin section live here.
  - Integration tests: `crates/ironshelf-server/tests/api_test.rs` (NOTE: OPDS tests there
    reimplement handlers with test types — they do NOT exercise real routes; weak spot).
- `app/` — Flutter app (Android today; iOS/desktop future). Riverpod + go_router + dio.
  Login entry = `lib/screens/server_login_screen.dart` (add server by URL + user/pass).
  `lib/providers/{auth_provider,server_provider}.dart`, `lib/services/api_service.dart`.
- `deploy/` — install scripts (Linux/macOS/Windows, no Docker). `docs/` — API, deployment, design.

## Build / test / run
- Build server: `cd server && cargo build -p ironshelf-server`
- Test server: `cd server && cargo test -p ironshelf-server` (currently **14/14 pass**)
- Run server: `cd server && cargo run -p ironshelf-server` (config `server/ironshelf.toml`,
  default port 10810; embeds web UI). First registered user = owner.
- Web JS syntax check: `node --check server/web/js/app.js`
- Flutter analyze: `cd app && flutter analyze` (NOT runnable in current env — no Flutter installed)

## This session — auth overhaul (6 commits on claude/dev, pushed)
1. `fix` OPDS ACL leak — OPDS feeds now scope by per-user library access. `routes/opds.rs`.
2. `feat` DB-driven multi-provider SSO — Google (OIDC) + GitHub (OAuth2) + custom. `routes/sso.rs`,
   `routes/admin_auth.rs`, migration 021 (`auth_providers` + `user_identities`).
3. `refactor` Google/GitHub baked in as first-class (fixed cards; owner enters only id/secret).
4. `refactor!` STRIP cloud/tunnel/upnp/legacy-OIDC/local-bypass (see REMOVED).
5. `refactor` web + Flutter cloud UI removed.
6. `docs` this STATUS.md.

## Auth architecture NOW (the "new setup")
KEEP / current surface:
- Local accounts: username+password, **argon2**. Login enumeration-safe (dummy-hash on miss,
  generic "Invalid credentials"). Password policy already enforced server-side: 8–1024 chars
  in `routes/auth.rs::register` + `routes/password.rs::change_password`.
- Sessions: cookie `ironshelf_session`, id hashed at rest, HttpOnly+SameSite=Lax+Secure(when TLS),
  7-day. `/auth/login` returns `session_id` (apps send it as Bearer).
- API keys: `irs_<prefix>.<secret>`, argon2-hashed → `Authorization: Bearer`.
- Media tokens: scoped tokens for cover/file/photo loads.
- SSO (DB-driven): public `/api/v1/auth/providers` (login buttons) + `/auth/sso/{id}/login` (302)
  + `/auth/sso/{id}/callback`. Owner CRUD `/api/v1/admin/auth-providers`. Built-ins Google+GitHub;
  custom OIDC/OAuth2 too. Identities in `user_identities` keyed by `(provider_id, subject)`.
  Credentials are per-instance (each install registers its own OAuth app — redirect URI is
  domain-specific; secrets can't ship in OSS). Redirect URI derived from X-Forwarded-Proto/Host.
- Per-library ACL: default-deny at data layer (`access.rs`), now incl. OPDS.
- Rate limiting 10/min auth + 100/min global. Security headers (CSP etc.).

REMOVED this session (gone — do not reintroduce):
- Ironshelf Cloud account system (`cloud_auth.rs`, cloud-login/claim/unclaim/link-cloud, heartbeat,
  the `cloud/` Cloudflare Worker, `deploy-cloud.yml`).
- Legacy file-config OIDC (`routes/oidc.rs` + `config.oidc`) — superseded by DB SSO; its shared
  crypto/session helpers were relocated INTO `routes/sso.rs`.
- Remote-access stack (`tunnel.rs`, `upnp.rs`+igd-next, `routes/remote_access.rs`, remote-access
  routes + startup init + scheduler health tasks, `config.remote_access_*`).
- Local-network auth bypass (`try_local_bypass`/`is_local_ip`) — unsafe no-password loopback path.
- Web cloud/remote UI; Flutter cloud screens → replaced by `server_login_screen.dart`.

GOTCHA: `cloud_config` DB table is RETAINED — misleading name, it's a general settings KV
(author-photo toggle etc.), not cloud-specific. Do not delete it.

## Build/verify state
- Server build clean; `cargo test -p ironshelf-server` = 14/14.
- Web `node --check` clean; grep-verified no dangling cloud/remote refs.
- **Flutter `flutter analyze` NOT run** (no Flutter on the machine used). Verified only by grep +
  signature matching. **MUST run `flutter analyze` on a Flutter machine before trusting app build.**
- `totp-rs` dep already added to `server/crates/ironshelf-server/Cargo.toml`
  (`features=["qr","gen_secret"]`) for the pending 2FA — currently unused, harmless.

## PENDING — approved, NOT yet built: 2FA + core hardening
Locked decisions: full package (2FA + lockout + HSTS); password policy already done; **two-step
login** flow; TOTP must work with **Google Authenticator** (standard RFC 6238: SHA1, 6 digits,
30s — totp-rs defaults).

Plan / files to touch:
- **Migration 022_two_factor.sql** (+ wire into `db/mod.rs::migrate()` include_str list):
  `user_totp(user_id PK, secret TEXT, enabled INTEGER, created_at)` +
  `user_totp_recovery(user_id, code_hash, used, PRIMARY KEY(user_id,code_hash))`.
- **New `routes/two_factor.rs`** (authed): `POST /auth/2fa/setup` → generate secret (totp-rs
  `Secret::generate_secret()`), store pending (enabled=0), return `{secret, otpauth_uri,
  qr_png_base64}` (`TOTP::get_qr_base64()`). `POST /auth/2fa/enable` {code} → verify
  (`TOTP::check_current`) → enabled=1, gen+hash 10 recovery codes, return them once.
  `POST /auth/2fa/disable` {password} → verify pw, delete rows. Store secret as base32.
- **Two-step login** (`routes/auth.rs::login`): after password OK, if `user_totp.enabled` →
  do NOT create session; create short-lived pending token (in-mem store mirroring
  `sso.rs::SsoStateStore`, TTL 5min, token→user_id, cap attempts) → return
  `{two_factor_required:true, two_factor_token}`. New `POST /auth/login/2fa` {token, code} →
  verify TOTP or recovery code → `create_session` (reuse `sso::create_session`) + cookie.
- **`/auth/me`**: add `two_factor_enabled` bool.
- **Account lockout**: in-mem per-username failed-login backoff in `AppState` (mirror SsoStateStore
  pattern); check before verify in `/auth/login`; reset on success; 429 + retry-after when locked.
  Also cap attempts on the pending-2fa token (6-digit brute-force defense).
- **HSTS**: `security_headers` middleware → add `Strict-Transport-Security: max-age=63072000;
  includeSubDomains` when TLS. Middleware is `from_fn` (no state) → convert to `from_fn_with_state`
  passing `config.tls_enabled`. Document setting `tls_enabled=true` behind an HTTPS proxy.
- **Web** (`app.js`): 2FA setup card in Settings (show QR + secret + recovery codes), and a code
  step on the login screen when `two_factor_required`.
- **Flutter**: add the code-prompt step to `server_login_screen.dart` login flow.
- Wire new routes in `main.rs`; add `pub mod two_factor;` to `routes/mod.rs`; register store in
  `state.rs` + `main.rs`. Build + test + commit per task.

## Other open items (from STRATEGY.md — NOT started)
- Acquisition engine STILL present in server (`crates/ironshelf-core/src/acquisition/*`, indexers/
  download-clients, + `routes/acquisition.rs`, scheduler acquisition tasks). Strategy says STRIP
  (filesystem-only integration, Plex/Sonarr split). Not touched this session.
- Work/Edition (FRBR) metadata model — phased; today flat Book + identifiers HashMap.
- Scan-now webhook + filesystem watch (`notify` crate) — MISSING, high priority for acquisition interop.
- Sync conflict resolution — currently last-write-wins; needs furthest-wins + set-merge.
- Persistent task queue (current is in-memory/ephemeral), backup/restore, offline mobile, iOS app.
- OPDS-PS (page streaming) for comics; convert→cache→serve loop unfinished.

## rreading-glasses
License = GPL-3.0 (AGPL-compatible). Decision: integrate as OPTIONAL external service via URL
config, do NOT bundle (separate Go+Postgres+Docker; keeps us single-binary).
