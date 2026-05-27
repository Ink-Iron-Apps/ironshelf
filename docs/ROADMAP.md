# Roadmap

Caveman ultra. Build order = milestones. Each = shippable slice.

## M0 — scaffold (DONE)
Folders, docs, Cargo workspace stubs, Flutter stub, git init.

## M1 — server core: Calibre read + hierarchy API (DONE)
- ironshelf-core: CalibreSource RO reader (authors/series/books/formats/cover/custom cols)
- Ironshelf DB schema + migrations (sqlx)
- axum: `/health`, `/api/v1/libraries`, authors/series/books hierarchy endpoints (read)
- config (TOML/env): calibre lib path(s), ironshelf db path, port

## M2 — auth + files + progress (DONE)
- login/session + API key Bearer; argon2; perms
- cover + file stream (Range), epub bytes
- reading_progress + bookmarks
- custom-header passthrough confirmed (CF Access)

## M3 — folder/embedded source + custom columns (DONE)
- FolderSource: scan + epub OPF parse; AO3 fandom/author heuristic
- custom columns: read, expose, sort, filter
- library types + per-user sort prefs

## M4 — Flutter app (DONE)
- server connect (URL + custom headers field for CF Access)
- browse Author→Series→Book; sort controls; book detail (incl custom cols)
- epub reader + progress sync
- Ink & Iron brand + standard Settings cards

## M5 — polish + deploy (DONE)
- OPDS feed (KOReader compat)
- multiuser admin UI (web + API)
- CI: cargo build/test + release builds; systemd unit; deploy scripts
- rate limiting, security headers, graceful shutdown

## M5+ — extended features (DONE)
- web EPUB/PDF/CBZ readers
- full-text search (tantivy)
- Kobo eReader sync
- WebDAV (KOReader sync)
- metadata enrichment (Google Books + Open Library)
- collections (reading lists)
- notifications + background scheduler
- import/export for data portability
- stats dashboard + activity feed
- genres/tag browsing
- highlights/annotations
- ratings + reviews
- reading queue + goals
- webhooks (outbound)
- per-library access control
- OIDC/SSO login
- cover thumbnail cache

## Future
- iOS Flutter build
- Audiobook support (M4A/MP3 streaming)
- Reading challenges / social features
- Plugin/extension system
- OPDS 2.0
