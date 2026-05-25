# START HERE — Ironshelf kickoff (clean session)

Caveman ultra. Read this first, then ARCHITECTURE → DATA-MODEL → API → CALIBRE-INTEGRATION → ROADMAP.

## What you're building

Ironshelf = self-host ebook server + Flutter reader. Killer feature: **Author → Series → Book** browse hierarchy. Reads Calibre `metadata.db` (incl **custom columns**) as source of truth + folder scan + embedded epub (hybrid). Backend Rust/Axum. App Flutter. Brand Ink & Iron, id `com.inknironapps.ironshelf`. NO Docker (bare-metal).

## State now

M0 scaffold done: folder skeleton, design docs, Cargo workspace + crate stubs (hello-world), Flutter stub, git initialized (branch `claude/dev`). NOTHING functional yet. Stubs do not implement domain logic.

## First task = M1 (see ROADMAP)

Server core: Calibre RO reader + hierarchy API. Goal: `curl` the author→series→book tree from a real Calibre library.

Steps:
1. `server/crates/ironshelf-core`: add deps (sqlx sqlite, serde, thiserror, tokio). Build `calibre::CalibreSource` per CALIBRE-INTEGRATION.md queries. Domain models per DATA-MODEL.md.
2. Ironshelf own DB: sqlx migrations for users/sessions/api_keys/progress/library_config/sort_prefs.
3. `ironshelf-server`: axum app, config loader (TOML/env: calibre path, ironshelf db path, port), routers for libraries + authors/series/books (read-only first).
4. Verify against real Calibre lib.

## Test Calibre libraries available (on this machine)

Real Calibre data already synced locally (epub + can point at full lib):
- Predator Calibre libs (over Tailscale Taildrive): `D:\Calibre\Books`, `D:\Calibre\eBooks` (Windows side).
- For a LOCAL `metadata.db` to test against: sync a full Calibre library dir (incl `metadata.db`, not epub-only) from predator via rclone remote `taildrive` (`taildrive:padraig.antrobus@gmail.com/predator/<share>`), OR ask user. Current local synced trees are epub-only (no metadata.db) — see `/home/riley/stump/sync-library.sh`. For M1 you NEED a metadata.db: ask user to share full lib or copy one.

## Hard rules (also in CLAUDE.md + global)

- Calibre `metadata.db` = READ-ONLY. Never write.
- No Docker. No local builds to "check" — CI compiles (EXCEPT user explicit ask). Here, building server locally to test M1 IS allowed if user oks (it's the deliverable).
- Tests: fail = fix code, never weaken.
- Var naming: full words, bool prefixes (is/has/can), no `data/result/temp`.
- Git: branch `claude/dev`, conventional commits, never direct `main`.
- Internal `.md` = caveman ultra. Public `.md` (README/store) = normal prose.

## Reuse

- AO3 fanfic heuristic (fandom from dc:subject, author from dc:creator, skip noise) → port from `/home/riley/stump/organize.py`.
- Cloudflare Access: app sends `CF-Access-Client-Id`/`CF-Access-Client-Secret` custom headers; server ignores (CF edge consumes). App MUST expose a custom-headers field per server.

## Context: why this exists (don't re-litigate)

Evaluated Stump (forking), Calibre-Web/CWA, Kavita, Komga, Readarr(dead). None give polished native app + true author→series→book + Calibre custom columns. Decision = build own. Stack chosen: Rust/Axum + Flutter + hybrid Calibre/scan source. Locked.

## Kickoff prompt (paste into clean session)

> Working on Ironshelf at /mnt/s/coding/ironshelf. Read docs/START-HERE.md then begin M1 from docs/ROADMAP.md: build the Calibre read-only reader in ironshelf-core + the hierarchy API in ironshelf-server. First confirm we have a local Calibre metadata.db to test against (if not, ask me to sync one). Follow CLAUDE.md.
