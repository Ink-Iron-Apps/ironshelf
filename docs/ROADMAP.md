# Roadmap

Caveman ultra. Build order = milestones. Each = shippable slice.

## M0 — scaffold (DONE)
Folders, docs, Cargo workspace stubs, Flutter stub, git init.

## M1 — server core: Calibre read + hierarchy API
- ironshelf-core: CalibreSource RO reader (authors/series/books/formats/cover/custom cols)
- Ironshelf DB schema + migrations (sqlx)
- axum: `/health`, `/api/v1/libraries`, authors/series/books hierarchy endpoints (read)
- config (TOML/env): calibre lib path(s), ironshelf db path, port
- DELIVER: curl the author→series→book tree from a real Calibre lib

## M2 — auth + files + progress
- login/session + API key Bearer; argon2; perms
- cover + file stream (Range), epub bytes
- reading_progress + bookmarks
- custom-header passthrough confirmed (CF Access)

## M3 — folder/embedded source + custom columns
- FolderSource: scan + epub OPF parse; AO3 fandom/author heuristic (port organize.py)
- custom columns: read, expose, sort, filter
- library types + per-user sort prefs

## M4 — Flutter app (Android first)
- server connect (URL + custom headers field for CF Access)
- browse Author→Series→Book; sort controls; book detail (incl custom cols)
- epub reader + progress sync
- Ink & Iron brand + standard Settings cards (update/version/review/whatsnew/legal/theme/feedback/onboarding)

## M5 — polish + deploy
- OPDS feed (KOReader compat)
- multiuser admin UI (web minimal or in-app)
- CI: cargo build/test + flutter build (per global CI/CD patterns); systemd unit; cloudflare tunnel host
- in-app update (sideload/GitHub-mirror pipeline per global rules)

## Later
- iOS build · web reader · metadata fetch · Kobo sync · search across libs

## Open decisions (revisit in clean session)
- REST vs GraphQL (default REST; GraphQL if hierarchy/sort queries get gnarly)
- epub reader lib (Flutter): epub_view / vocsy / folioreader / custom — eval
- search engine: SQL LIKE first, tantivy later
- thumbnail cache strategy
