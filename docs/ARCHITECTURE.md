# Architecture

Caveman ultra. Internal doc.

## Big picture

```
Flutter app ──HTTP/JSON+OPDS──> Axum server ──read──> Calibre metadata.db (SQLite, RO)
                                      │      ──read──> book files (epub/pdf/cbz)
                                      │      ──scan──> plain folders + embedded epub OPF
                                      └──read/write──> Ironshelf DB (SQLite: users/progress/prefs)
```

## Server crates

- **ironshelf-core** — no HTTP. Domain + IO:
  - `calibre/` — RO reader of `metadata.db`. Books/authors/series/tags/ratings/identifiers/comments/data(formats)/languages + **custom_columns** (dynamic).
  - `scan/` — folder walker + embedded epub OPF parser (dc:creator, calibre:series, series_index, title, subjects). Reuse logic from existing `organize.py` heuristics (AO3 fandom, author split).
  - `model/` — unified domain: Library, Author, Series, Book, Format, CustomColumn, value types.
  - `db/` — Ironshelf own DB (sqlx): users, sessions, api_keys, reading_progress, bookmarks, library_config, sort_prefs.
  - `epub/` — epub open/read (rbook or epub crate), cover extract, chapter/locator for reader.
- **ironshelf-server** — axum bin:
  - routers: `/api/v1/...` REST, `/opds` feed, `/health`.
  - middleware: auth (session cookie OR `Authorization: Bearer <apikey>`), CORS, trace.
  - aggregates core sources into one library view.

## Source abstraction

`trait LibrarySource { authors(), series_by_author(), books_by_series(), book(), file(), custom_columns() ... }`
Impls: `CalibreSource` (metadata.db), `FolderSource` (scan+embedded). A Library picks one source + type + sort config. Hybrid = multiple libraries, mixed kinds.

## Hierarchy (the point)

Browse path: **Library → Authors → (Series | Standalone) → Books**.
- Author = entity (Calibre authors table, OR derived from embedded dc:creator for FolderSource).
- Series under author; series_index orders books. Standalone bucket per author for no-series books.
- Every level sortable (see DATA-MODEL sort config).

## Custom columns

Calibre `custom_columns` → dynamic fields. Expose as: displayable on book detail, filterable, sortable. Datatypes: text, comments, int, float, bool, datetime, rating, enumeration, series. is_multiple → list. Map to generic `CustomValue` enum.

## Auth / Cloudflare Access

- App stores per-server custom headers (CF-Access-Client-Id/Secret) → sent every request. Server ignores them (CF edge consumes). Server auth = own API key Bearer + session. This combo = works behind CF Access AND own multiuser.

## No Docker

Server: `cargo build --release` → systemd unit, reads config (TOML/env) for metadata.db path(s) + Ironshelf DB path + port. App: Flutter → APK/AAB via CI.
