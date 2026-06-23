# Ironshelf — Status

Internal status (caveman style). Last update: 2026-06-22. Branch: `claude/dev`.

## Direction
Self-hosted "Plex for ebooks". Runs as plain port-bound HTTP server (Sonarr model)
→ operator brings own reverse-proxy/tunnel. NO built-in cloud/relay. Auth must be
strong enough to face internet directly. Strategy doc: `S:\coding\ebook-platform-strategy\STRATEGY.md`.

## This session — auth overhaul (5 commits, pushed)
1. `fix` OPDS ACL leak — OPDS feeds now scope by per-user library access (was leaking
   titles/authors/series of restricted libs to any authed user). `routes/opds.rs`.
2. `feat` DB-driven multi-provider SSO — Google (OIDC) + GitHub (OAuth2) + custom OIDC/OAuth2.
   `routes/sso.rs`, `routes/admin_auth.rs`, migration 021 (`auth_providers` + `user_identities`).
3. `refactor` Google/GitHub baked in as first-class providers (fixed cards; owner enters only
   client id/secret + toggle). Custom = advanced. `BUILTIN_PROVIDER_IDS` in sso.rs.
4. `refactor!` STRIP cloud/tunnel/upnp/legacy-OIDC/local-bypass (see below).
5. `refactor` web + Flutter cloud UI removed.

## Auth architecture NOW
KEEP / current surface:
- Local accounts: username+password, **argon2** hash, register/login/change-password.
  Login is enumeration-safe (dummy-hash on miss) + generic "Invalid credentials".
- Sessions: cookie `ironshelf_session`, session id hashed at rest, HttpOnly + SameSite=Lax
  + Secure (when TLS), 7-day.
- API keys (apps): `irs_<prefix>.<secret>`, argon2-hashed → `Authorization: Bearer`.
- Media tokens: scoped tokens for cover/file/photo loads.
- **SSO providers (DB-driven)**: `/api/v1/auth/providers` (login buttons), `/auth/sso/{id}/login`
  (302), `/auth/sso/{id}/callback`. Admin CRUD `/api/v1/admin/auth-providers` (owner).
  Built-ins Google+GitHub; custom OIDC/OAuth2 supported. Identities linked in `user_identities`
  by `(provider_id, subject)`.
- Per-library ACL: default-deny, enforced at data layer (`access.rs`), now incl. OPDS.
- Rate limiting: 10/min auth, 100/min global. Security headers middleware (CSP etc.).

REMOVED this session (gone for good):
- Ironshelf Cloud account system — `cloud_auth.rs`, cloud-login/claim/unclaim/link-cloud,
  cloud heartbeat, entire `cloud/` Cloudflare Worker + `deploy-cloud.yml`.
- Legacy file-config OIDC — `routes/oidc.rs` + `config.oidc` (superseded by DB SSO; shared
  helpers moved into sso.rs).
- Remote-access stack — `tunnel.rs` (Cloudflare Quick Tunnel), `upnp.rs` (igd-next),
  `routes/remote_access.rs`, remote-access routes + startup init + scheduler health tasks,
  `config.remote_access_*` fields.
- Local-network auth bypass (`try_local_bypass`/`is_local_ip`) — unsafe no-password loopback/LAN path.
- Web: cloud login screens, "Sign in with Cloud", legacy SSO button, remote-access cards.
- Flutter: cloud screens/providers/services → new `server_login_screen.dart` (add server by URL +
  user/pass, Audiobookshelf-style).

NOTE: `cloud_config` DB table RETAINED — misleading name, it's a general settings KV
(author-photo toggle, etc.), not cloud-specific.

## Build/test state
- Server: `cargo build` clean, `cargo test -p ironshelf-server` = 14/14 pass.
- Web: `node --check app.js` clean; grep-verified no dangling cloud/remote refs.
- Flutter: `flutter analyze` NOT run (flutter not on this machine). Verified by grep + signature
  checks that removed symbols are gone and the new login screen's calls resolve. **TODO: run
  `flutter analyze` on a machine with Flutter before trusting the app build.**
- `totp-rs` dep added to server Cargo.toml (for pending 2FA) — currently unused, harmless.

## PENDING — approved, not yet built: 2FA + core hardening
Scope agreed: TOTP 2FA + account lockout + HSTS (password policy already exists: 8–1024 chars,
server-side, register + change-password). Design pending; plan:
- **TOTP 2FA** (Google Authenticator compatible — standard RFC 6238). Migration 022:
  `user_totp(user_id, secret, enabled)` + `user_totp_recovery(user_id, code_hash, used)`.
  Routes: `/auth/2fa/setup` (QR + secret), `/auth/2fa/enable` (verify code → recovery codes),
  `/auth/2fa/disable`. Status in `/auth/me`.
- **Two-step login** (agreed): `/auth/login` returns `{two_factor_required, two_factor_token}`
  when 2FA on; `/auth/login/2fa` {token, code} completes → session. App + web both prompt for code.
- **Account lockout**: in-memory per-account failed-login backoff (defends credential stuffing
  beyond IP rate limit).
- **HSTS**: emit `Strict-Transport-Security` when TLS; document `tls_enabled=true` behind HTTPS proxy.

## Other open items (from strategy doc, NOT started)
- Acquisition engine still present in server (`acquisition/*`, indexers/download-clients) — strategy
  says STRIP (filesystem-only integration). Not touched this session.
- Work/Edition (FRBR) metadata model — phased, future.
- Scan-now webhook + filesystem watch — missing, high priority for acquisition-interop.
- Sync conflict resolution (currently last-write-wins) — future.
- Persistent task queue, backup/restore, offline mobile, iOS app — future.

## rreading-glasses
License = GPL-3.0 (AGPL-compatible). Decision: integrate as OPTIONAL external service via URL
config, do NOT bundle (separate Go+Postgres+Docker; keeps us single-binary).
