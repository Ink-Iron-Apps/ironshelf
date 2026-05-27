# START HERE — Ironshelf context (clean session)

Caveman ultra. Read this first, then ARCHITECTURE → DATA-MODEL → API → CALIBRE-INTEGRATION → ROADMAP.

## What this is

Ironshelf = self-host ebook server + Flutter reader. Killer feature: **Author → Series → Book** browse hierarchy. Reads Calibre `metadata.db` (incl **custom columns**) as source of truth + folder scan + embedded epub (hybrid). Backend Rust/Axum. App Flutter. Brand Ink & Iron, id `com.inknironapps.ironshelf`. NO Docker (bare-metal).

## State now

**All milestones complete (M0–M5+).** Server fully functional: Calibre RO reader, folder scan, hierarchy API, auth (session + API key + OIDC/SSO), file streaming, reading progress sync, full-text search (tantivy), OPDS, Kobo sync, WebDAV, webhooks, notifications, highlights/annotations, collections, genres, ratings/reviews, reading goals/queue, metadata enrichment, import/export, stats, rate limiting, security headers, graceful shutdown. Embedded web UI w/ EPUB/PDF/CBZ readers. Flutter app scaffolded w/ all screens + Riverpod state. CI/CD: auto-merge + release workflows. 14 rounds of audit completed.

## Hard rules (also in CLAUDE.md + global)

- Calibre `metadata.db` = READ-ONLY. Never write.
- No Docker. No local builds to "check" — CI compiles (EXCEPT user explicit ask).
- Tests: fail = fix code, never weaken.
- Var naming: full words, bool prefixes (is/has/can), no `data/result/temp`.
- Git: branch `claude/dev`, conventional commits, never direct `main`.
- Internal `.md` = caveman ultra. Public `.md` (README/store) = normal prose.

## Context: why this exists (don't re-litigate)

Evaluated Stump (forking), Calibre-Web/CWA, Kavita, Komga, Readarr(dead). None give polished native app + true author→series→book + Calibre custom columns. Decision = build own. Stack chosen: Rust/Axum + Flutter + hybrid Calibre/scan source. Locked.

## Dev notes

- AO3 fanfic heuristic (fandom from dc:subject, author from dc:creator, skip noise) implemented in scan module.
- Cloudflare Access: app sends `CF-Access-Client-Id`/`CF-Access-Client-Secret` custom headers; server ignores (CF edge consumes). App MUST expose a custom-headers field per server.

## Session prompt

> Working on Ironshelf. Read docs/START-HERE.md then CLAUDE.md. Follow CLAUDE.md rules.
