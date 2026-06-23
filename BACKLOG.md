# Ironshelf — Backlog

Internal backlog (caveman style). Ordered so each item builds on a clean prior state.
Feed to a session one item at a time. Companion to `STATUS.md` (state) +
`S:\coding\ebook-platform-strategy\STRATEGY.md` (vision). Branch `claude/dev`, commit per task.

Credible public **v1.0 ≈ Phase 1 + Phase 2 + #12**. Phase 3 = what makes it *beat* rivals
(don't let it block a v1.0 cut).

## In flight
- [~] **0. 2FA + core hardening** — TOTP (Google-Authenticator/RFC6238) + two-step login +
  per-account lockout + HSTS. (Being built now.)

## Phase 1 — finish foundations / clean surface
- [x] **1. Verify Flutter app builds** — `flutter analyze` clean (0 issues, Flutter 3.44 via snap).
  Fixed: EpubTheme.custom backgroundColor→backgroundDecoration; RadioListTile groupValue/onChanged
  deprecated → RadioGroup ancestor. Debug build = CI (no local builds per policy).
- [ ] **2. Relicense** MIT → AGPL-3.0 (server) + GPL-3.0 (apps): LICENSE files, headers, READMEs.
  Do early so later commits land under the right license.
- [ ] **3. Strip the acquisition engine** — remove indexers/download-clients/wanted-items/
  auto-fulfillment (`ironshelf-core/src/acquisition/*`, `routes/acquisition.rs`, scheduler
  acquisition tasks, DB tables). KEEP the folder→library import/scan half. Plex/Sonarr split.
  (Destructive like the cloud strip — confirm scope before ripping.)
- [ ] **4. Scan-now webhook + filesystem watch + hash-upgrade detection** — `POST
  /api/v1/libraries/{id}/scan` (+ global), `notify`-crate watcher, content-hash/mtime
  "update-in-place not duplicate". The acquisition-interop story.
- [ ] **5. Test hardening** — real per-endpoint ACL-leak tests (incl. OPDS against the REAL routes,
  not the api_test.rs reimplementation) + auth/2FA/lockout tests.

## Phase 2 — Plex-grade reliability
- [ ] **6. Persistent background task queue** — replace in-memory ephemeral registry (survive
  restart, retry, scheduling).
- [ ] **7. Backup / restore** — export+import Ironshelf DB (metadata + reading state) + clean migrations.
- [ ] **8. Conflict-safe sync** — replace last-write-wins: per-record version + device_id;
  furthest-wins for reading position; additive set-merge for highlights/bookmarks/collections.
- [ ] **9. Offline mobile** — download books to device + sync pending changes on reconnect (Android first).
- [ ] **10. Conversion loop + OPDS-PS** — convert→cache→serve (EPUB→KEPUB, AZW3→EPUB, send-to-device);
  OPDS page-streaming for comics.

## Phase 3 — the metadata differentiator
- [ ] **11. Identifiers → keyed table + provenance/lock columns** — cheap schema step toward FRBR;
  unlocks matching. (Before #14.)
- [ ] **12. Plugin system scaffold** — trait for metadata-agents / format-readers / notifiers; port
  Open Library + the format readers to run AS plugins (proves the API). The moat.
- [ ] **13. rreading-glasses + Hardcover/Goodreads** — OPTIONAL external metadata service via URL
  config (do NOT bundle; GPL-3.0, separate Go+Postgres), behind the plugin trait.
- [ ] **14. Work/Edition (FRBR) migration** — `work` table, link editions via identifier-clustering
  + fuzzy match, field-level reconciliation (provenance + preference order + user locks), manual
  "Fix Match" UI.
- [ ] **15. Discovery hubs** — Up-Next-in-Series, "because you read X", recommendations, smart/dynamic
  collections, richer detail pages, saved searches.

## Phase 4 — reach & ecosystem
- [ ] **16. Parental controls + SSO-group→library mapping** — age-rating/tag gating; map IdP groups
  to library access.
- [ ] **17. iOS app + web PWA hardening** — Flutter iOS parity; turn the web SPA into an installable
  offline PWA.
- [ ] **18. Readarr-compatible metadata-provider endpoint** — the "reverse play" (app doubles as an
  rreading-glasses successor for the community + user's own Readarr).
- [ ] **19. Native desktop (Tauri)** — dedicated desktop client once the web reader hits its ceiling.
- [ ] **20. Plugin registry/marketplace** — discover + install community plugins.

## Notes
- #3 and any other destructive strip: confirm scope first (like the cloud strip).
- `cloud_config` DB table is a general settings KV despite its name — never delete it.
- Acquisition = filesystem-only integration (no built-in downloader); remote access = operator's
  own reverse-proxy/tunnel (no built-in cloud/tunnel). Don't reintroduce either.
