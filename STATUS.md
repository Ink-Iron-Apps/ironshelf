# Ironshelf — Status / Session Handoff

Internal status (caveman style). Last update: 2026-06-22. Branch: `claude/dev`.
Self-contained — paste-and-go for a fresh session. Assumes zero prior chat context.

## How to resume in a fresh session
Read this whole file. Then: global rules at `S:\coding\CLAUDE.md` auto-load (claude/dev branch,
commit-per-task, caveman internal md, brand = Ink & Iron Apps). Strategy/vision doc:
`S:\coding\ebook-platform-strategy\STRATEGY.md`. SSO design detail: `docs/AUTH-PROVIDERS-DESIGN.md`.
2FA + hardening = **COMPLETE** (see section below). Next: acquisition engine strip or FRBR model.

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
- Server: `cargo test -p ironshelf-server` last known = 14/14 (pre-2FA). CI will re-run. 6 new
  unit tests added in `routes/login_state.rs` (lockout + pending TOTP store logic).
- Web `node --check` clean post-2FA changes.
- **Flutter `flutter analyze` NOT run** (no Flutter on machine). Verified by signature matching
  only. **MUST run `flutter analyze` on Flutter machine before trusting app build.**

## 2FA + core hardening — COMPLETE (7 commits, claude/dev)
All items shipped:
- **Migration 022** `user_totp` + `user_totp_recovery` tables. `db/mod.rs` wired.
- **`routes/login_state.rs`**: `LoginAttemptStore` (5 fail → 15-min lockout, 10-min window) +
  `PendingTotpStore` (5-min TTL, max 6 attempts). Both in `AppState`.
- **`routes/two_factor.rs`**: `POST /auth/2fa/setup` (gen secret → QR base64 + otpauth URI),
  `POST /auth/2fa/enable` (verify code → enabled=1, return 10 argon2-hashed recovery codes once),
  `POST /auth/2fa/disable` (verify password → wipe rows).
- **`routes/auth.rs`**: lockout check at login, two-step login (returns `two_factor_required`
  token), `POST /auth/login/2fa` handler (TOTP + recovery code verify), `/auth/me` adds
  `two_factor_enabled`. `AppError::TooManyRequests(u64)` → 429 + `Retry-After`.
- **HSTS**: `security_headers` middleware now takes `tls_enabled: bool`; emits
  `Strict-Transport-Security: max-age=63072000; includeSubDomains` only when TLS active.
- **Web** (`app.js`): 2FA code prompt replaces login form in-place; Settings card shows QR setup
  or disable flow based on `two_factor_enabled` from `/auth/me`.
- **Flutter**: `AuthStatus.awaitingTwoFactor`, `AuthNotifier.loginTwoFactor()`,
  `ApiService.loginTwoFactor()`, `ServerLoginScreen` switches to TOTP prompt widget.

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
