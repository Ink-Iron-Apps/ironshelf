# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Ironshelf — Project Rules

Inherits global + `/mnt/s/coding/CLAUDE.md`. Below = project-specific. Internal `.md` = caveman ultra (this file too). Public `.md` (README, store listings) = normal prose.

## What

Self-host ebook server + reader. Killer feature: **Author → Series → Book** hierarchy. Reads Calibre `metadata.db` (incl custom columns) as truth, + folder scan + embedded epub. Stack: Rust/Axum backend, Flutter app. Brand Ink & Iron, id `com.inknironapps.ironshelf`.

## Layout

- `server/` — Rust workspace (resolver 2). Crates under `server/crates/`:
  - `ironshelf-core` — domain + IO: calibre reader, scanner, epub parse, models, own DB.
  - `ironshelf-server` — axum bin: routes, middleware, aggregation.
- `app/` — Flutter (SDK >=3.4). Riverpod state, go_router nav, dio HTTP.
- `docs/` — design. START-HERE = kickoff. ARCHITECTURE, DATA-MODEL, API, CALIBRE-INTEGRATION, ROADMAP.

## Commands

```bash
# Server
cd server && cargo build                    # debug build
cd server && cargo build --release          # release build
cd server && cargo test                     # all tests (workspace)
cd server && cargo test -p ironshelf-core   # single crate tests
cd server && cargo clippy --workspace       # lint
IRONSHELF_PORT=10810 cargo run -p ironshelf-server  # run locally (default port 10810)
# Env: RUST_LOG=ironshelf_server=debug,tower_http=debug for verbose tracing

# Web UI — files in server/web/ auto-embedded at compile time via rust-embed. No separate build step.

# Flutter app
cd app && flutter test                      # unit tests
cd app && flutter analyze                   # lint
cd app && flutter build apk --release       # release APK
cd app && flutter build appbundle --release # release AAB
```

## Hard rules

- **No Docker** (user pref). Bare-metal: server = `cargo build` → systemd; app = Flutter build via CI.
- **Calibre `metadata.db` = READ-ONLY.** Never write it. Own state (users/progress/prefs) in separate Ironshelf DB.
- **No local builds to "check"** (global rule) — CI compiles. EXCEPT user explicit ask.
- Tests: fail = fix code, never weaken test (global rule).
- Var naming: full words, bool prefixes, no vague `data/result/temp` (global standard).
- Git: work `claude/dev`, never direct `main`. Conventional commits.

## Architecture

```
Flutter app ──HTTP/JSON+OPDS──> Axum server ──read──> Calibre metadata.db (SQLite, RO)
                                      │      ──read──> book files (epub/pdf/cbz)
                                      │      ──scan──> plain folders + embedded epub OPF
                                      └──read/write──> Ironshelf DB (SQLite: users/progress/prefs)
```

**Core abstraction:** `trait LibrarySource` — impls: `CalibreSource` (metadata.db), `FolderSource` (scan+embedded). Library picks one source. Multiple libraries = hybrid.

**Browse hierarchy:** Library → Authors → (Series | Standalone) → Books. Series_index orders books within series.

**Auth:** session cookies (web) + API key Bearer (app). CF Access handled by custom headers passthrough (app stores per-server CF-Access-Client-Id/Secret, sent every request, consumed at edge).

## Web UI

Embedded SPA in `server/web/` — vanilla JS + CSS, no framework, no build step. Compiled into binary via `rust-embed` → single binary deploys w/ UI included. Hash-based routing (`#/library`, `#/author/123`, etc).

**Theme:** Ink & Iron brand — dark bg `#0F1115`, teal accent `#095F73`/`#3BB3C9`, EB Garamond display, Inter body.

**Quality bar:** production-quality target. No placeholder lorem ipsum, skeleton loaders during fetch, proper error states (empty, offline, 4xx/5xx), responsive (mobile-first, works desktop).

## Key decisions (locked)

- Backend Rust/Axum. App Flutter. Data = hybrid (Calibre + scan + embedded) + Calibre custom columns.
- API = REST + JSON + OPDS (revisit GraphQL only if hierarchy queries demand).
- Auth = sessions (web) + API key Bearer (app). App MUST support custom request headers (Cloudflare Access service tokens).
- Deps: sqlx (SQLite, runtime-tokio), argon2, tower-http (trace/cors/fs), chrono, uuid.
- Flutter deps: dio, flutter_riverpod, go_router, shared_preferences, cached_network_image, package_info_plus.

## Current state

**All milestones (M0–M5+) complete.** Server fully functional: Calibre RO reader, folder scan, hierarchy API, auth (session + API key + OIDC/SSO), file streaming, progress sync, full-text search (tantivy), OPDS, Kobo sync, WebDAV, webhooks, notifications, highlights, collections, genres, ratings/reviews, reading goals/queue, metadata enrichment, import/export, stats, rate limiting, security headers, graceful shutdown, embedded web UI w/ EPUB/PDF/CBZ readers. Flutter app scaffolded w/ all screens. See `docs/ROADMAP.md` for milestone history.

## Settings screens (global app rules apply)

Flutter app must include the Ink & Iron standard Settings cards: in-app update, version footer, review prompt, what's-new, privacy/terms links, theme (dark/light/system), feedback (`support@inknironapps.com`), onboarding empty state. See global CLAUDE.md.
