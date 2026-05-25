# Ironshelf — Project Rules

Inherits global + `/mnt/s/coding/CLAUDE.md`. Below = project-specific. Internal `.md` = caveman ultra (this file too). Public `.md` (README, store listings) = normal prose.

## What

Self-host ebook server + reader. Killer feature: **Author → Series → Book** hierarchy. Reads Calibre `metadata.db` (incl custom columns) as truth, + folder scan + embedded epub. Stack: Rust/Axum backend, Flutter app. Brand Ink & Iron, id `com.inknironapps.ironshelf`.

## Layout

- `server/` — Rust workspace. `ironshelf-server` (axum bin), `ironshelf-core` (domain: calibre reader, scanner, epub parse, models).
- `app/` — Flutter.
- `docs/` — design. START-HERE = kickoff. ARCHITECTURE, DATA-MODEL, API, CALIBRE-INTEGRATION, ROADMAP.

## Hard rules

- **No Docker** (user pref). Bare-metal: server = `cargo build` → systemd; app = Flutter build via CI.
- **Calibre `metadata.db` = READ-ONLY.** Never write it. Own state (users/progress/prefs) in separate Ironshelf DB.
- **No local builds to "check"** (global rule) — CI compiles. EXCEPT user explicit ask.
- Tests: fail = fix code, never weaken test (global rule).
- Var naming: full words, bool prefixes, no vague `data/result/temp` (global standard).
- Git: work `claude/dev`, never direct `main`. Conventional commits.

## Build (when CI set up)

- Server: `cd server && cargo build --release` → JDK n/a. Bin `ironshelf-server`.
- App: `cd app && flutter build apk --release` / `appbundle`.

## Key decisions (locked)

- Backend Rust/Axum. App Flutter. Data = hybrid (Calibre + scan + embedded) + Calibre custom columns.
- API = REST + JSON + OPDS (revisit GraphQL only if hierarchy queries demand).
- Auth = sessions (web) + API key Bearer (app). App MUST support custom request headers (Cloudflare Access service tokens).

## Settings screens (global app rules apply)

Flutter app must include the Ink & Iron standard Settings cards: in-app update, version footer, review prompt, what's-new, privacy/terms links, theme (dark/light/system), feedback (`support@inknironapps.com`), onboarding empty state. See global CLAUDE.md.
