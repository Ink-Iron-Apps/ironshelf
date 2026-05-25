# Data Model

Caveman ultra. Two DBs: Calibre `metadata.db` (RO, external) + Ironshelf DB (RW, ours).

## Domain (unified, in-memory/API)

- **Library** { id, name, type, source_kind (Calibre|Folder), path, sort_config, created_at }
  - type: Book | LightNovel | WebNovel | Fanfiction | Comic | Manga | Mixed
- **Author** { id, name, sort_name, book_count, series_count }
- **Series** { id, name, sort_name, author_ids[], book_count }
- **Book** { id, library_id, title, sort_title, author_ids[], series_id?, series_index?, formats[], cover_url, pubdate, added_at, rating?, tags[], languages[], identifiers{}, description, custom: {col_name: CustomValue} }
- **Format** { kind (EPUB/PDF/CBZ...), size, rel_path }
- **CustomColumn** { name (#foo), label, datatype, is_multiple }
- **CustomValue** = Text|Int|Float|Bool|DateTime|Rating|Enum|List<...>

## Ironshelf DB (sqlx/SQLite, RW)

- **users** (id, username, password_hash[argon2], is_owner, created_at)
- **permissions** (user_id, perm) — read, manage_library, manage_users, etc.
- **sessions** (id, user_id, expires_at)
- **api_keys** (id, user_id, prefix, hash, label, created_at) — Bearer `irs_<...>`
- **reading_progress** (user_id, book_id, format, locator, percent, updated_at)
- **bookmarks** (id, user_id, book_id, locator, note, created_at)
- **library_config** (library_id, type, source_kind, path, options_json)
- **sort_prefs** (user_id, scope[library/author/series], field, dir) — per-user overrides

NOTE book_id stable across rescans: for Calibre use `calibre:<libid>:<calibre_book_id>`; for Folder use hash of rel_path. Keep progress stable.

## Sorting (customizable — req #2)

sort field per scope:
- Authors: name | sort_name | book_count | series_count | recently_added
- Series: name | sort_name | book_count | first_added | series of author
- Books (in series): series_index (default) | title | pubdate | added | rating
- Books (standalone/flat): title | author | added | pubdate | rating | any custom column
dir: asc|desc. Server default in library sort_config; user override in sort_prefs.

## Calibre schema (RO, reference)

books(id,title,sort,timestamp,pubdate,series_index,path,author_sort,has_cover)
authors(id,name,sort) · books_authors_link(book,author)
series(id,name,sort) · books_series_link(book,series)
tags + books_tags_link · ratings(rating) + books_ratings_link
languages + books_languages_link · identifiers(book,type,val)
comments(book,text) · data(book,format,name) = formats on disk
custom_columns(id,label,name,datatype,is_multiple,display) →
  per col: `custom_column_<id>`(id,value) + `books_custom_column_<id>_link`(book,value)
  (non-multiple sometimes value direct in custom_column_<id>.book)
cover = `<library>/<book.path>/cover.jpg` · file = `<library>/<book.path>/<data.name>.<ext>`
