# Ironshelf

A self-hosted ebook library server and reader with a true **Author → Series → Book** browse hierarchy — built for people who curate their collections in Calibre.

Ironshelf reads your existing Calibre library (including custom columns) as the source of truth, so the author/series structure and metadata you already maintain show up exactly as you organized them. It also scans plain folders and reads embedded EPUB metadata, so non-Calibre content works too.

## Why it exists

Existing self-hosted readers either model the library as a flat Library → Series → Book tree with no author tier (Stump, Kavita, Komga), or expose Calibre's hierarchy but lack a polished native mobile app (Calibre-Web). Ironshelf aims for both: Calibre's rich hierarchy *and* a polished Flutter app.

## Goals

- **Author → Series → Book** navigation, with standalone books handled cleanly
- Read Calibre `metadata.db` directly, including **custom columns**, as a first-class source
- Hybrid sources: Calibre libraries, plain folder scans, and embedded EPUB metadata
- Per-library **type** (Book, Light Novel, Web Novel, Fanfiction, Comic, Manga, Mixed) affecting display
- Fully **customizable sorting** at every level
- Multi-user with permissions; OPDS feed
- Polished **Flutter** app (Android first, iOS capable) that reflects the full hierarchy and works behind Cloudflare Access (custom request headers)
- Self-hosted, **bare-metal** friendly (no Docker required)

## Stack

- **Server:** Rust + Axum
- **App:** Flutter
- **Brand:** Ink & Iron Apps · `com.inknironapps.ironshelf`

## Status

Early scaffold. See `docs/START-HERE.md` to begin development.

## License

TBD (recommend MIT to match the ecosystem).
