# API

Caveman ultra. REST + JSON. Base `/api/v1`. Auth: session cookie OR `Authorization: Bearer irs_<key>`. OPDS at `/opds`.

## Auth
- `POST /auth/login` {username,password} → session + token
- `POST /auth/logout`
- `GET  /auth/me` → user + perms
- `POST /auth/api-keys` {label} → key (shown once) · `GET/DELETE /auth/api-keys`

## Libraries
- `GET  /libraries` → [{id,name,type,source_kind}]
- `POST /libraries` (admin) {name,type,source_kind,path,options} → scan/index
- `GET  /libraries/{id}` → detail + sort_config + custom_columns[]
- `POST /libraries/{id}/scan` (admin) → reindex
- `PATCH /libraries/{id}` (admin) → type/sort/options

## Hierarchy (the point) — all take ?sort=&dir=&page=
- `GET /libraries/{id}/authors` → [Author] (sortable)
- `GET /authors/{id}` → author + series[] + standalone_count
- `GET /authors/{id}/series` → [Series]
- `GET /authors/{id}/standalone` → [Book] (no-series books)
- `GET /series/{id}` → series + books[] (default sort series_index)
- `GET /books/{id}` → full Book (incl custom columns map)
- `GET /libraries/{id}/books` → flat list (filter ?author=&series=&tag=&custom.<col>=&q=)

## Files / reading
- `GET /books/{id}/cover` → image
- `GET /books/{id}/file?format=EPUB` → bytes (Range supported)
- `GET /books/{id}/progress` · `PUT /books/{id}/progress` {format,locator,percent}
- `GET/POST/DELETE /books/{id}/bookmarks`

## Custom columns
- exposed in `GET /libraries/{id}` as [{name,label,datatype,is_multiple}]
- values in Book.custom {name: value}
- usable as sort field + filter `?custom.<name>=`

## OPDS
- `/opds` root → nav: by Author / by Series / Recent
- `/opds/authors`, `/opds/authors/{id}`, `/opds/series/{id}` → acquisition feeds
- works w/ KOReader etc. App sends CF-Access headers if set.

## Conventions
- pagination ?page=&per_page= → {items,total,page}
- errors: JSON {error,code}; 401 no auth, 403 perm, 404, 422 bad input
- sort param names match DATA-MODEL sort fields
