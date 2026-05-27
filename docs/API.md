# API

Caveman ultra. REST + JSON. Base `/api/v1`. Auth: session cookie OR `Authorization: Bearer irs_<key>`. OPDS at `/opds`.

## Health (no auth)
- `GET /health` → {status,version,uptime_seconds,libraries_loaded,database}
- `GET /ready` → {ready,database,libraries_loaded} (503 if not ready)
- `GET /alive` → {alive:true}
- `GET /api/v1/server/info` → server version + capabilities

## Auth
- `POST /auth/login` {username,password} → session + token
- `POST /auth/logout`
- `POST /auth/register` {username,password} → first user = admin
- `GET  /auth/me` → user + perms
- `POST /auth/api-keys` {label} → key (shown once) · `GET/DELETE /auth/api-keys` · `DELETE /auth/api-keys/{id}`
- `GET  /auth/oidc/login` → {redirect_url} (OIDC/SSO flow start)
- `GET  /auth/oidc/callback?code=&state=` → session cookie + redirect (provider callback)

## Users (admin)
- `GET  /users` → [{id,username,is_owner,permissions}]
- `POST /users/invite` {username,password,permissions} → invite user
- `DELETE /users/{id}` → remove user
- `PATCH /users/{id}/permissions` {permissions} → set perms

## Libraries
- `GET  /libraries` → [{id,name,type,source_kind}]
- `POST /libraries` (admin) {name,type,source_kind,path,options} → create + scan
- `GET  /libraries/{id}` → detail + custom_columns[]
- `PATCH /libraries/{id}` (admin) → update type/options
- `DELETE /libraries/{id}` (admin) → remove
- `POST /libraries/{id}/scan` (admin) → reindex
- `POST /libraries/{id}/metadata/scan` (admin) → bulk metadata enrichment

## Hierarchy — all take ?sort=&dir=&page=&per_page=
- `GET /libraries/{id}/authors` → [Author] (sortable)
- `GET /libraries/{id}/books` → flat list (filter ?author=&series=&tag=&custom.<col>=&q=)
- `GET /authors/{id}` → author + series[] + standalone_count
- `GET /authors/{id}/series` → [Series]
- `GET /authors/{id}/standalone` → [Book] (no-series books)
- `GET /series/{id}` → series + books[] (default sort series_index)
- `GET /books/{id}` → full Book (incl custom columns map)

## Genres
- `GET /genres` → [{name,book_count}] (all genres across all libraries)
- `GET /genres/{genre_name}` → paginated books in genre (?sort=&dir=&page=&per_page=)
- `GET /genres/{genre_name}/authors` → [Author] in genre
- `GET /genres/{genre_name}/series` → [Series] in genre
- `GET /libraries/{id}/genres` → [{name,book_count}] (genres in library)
- `GET /libraries/{id}/genres/{genre_name}/books` → paginated books in genre within library

## Files / reading
- `GET /books/{id}/cover` → image (jpeg, cached 24h)
- `GET /books/{id}/file?format=EPUB` → bytes (Range supported, 206 partial)
- `GET /books/{id}/progress` · `PUT /books/{id}/progress` {format,locator,percent}
- `GET/POST/DELETE /books/{id}/bookmarks` · `DELETE /books/{id}/bookmarks/{bookmark_id}`
- `GET /books/continue` → recently-read books with progress

## Highlights / annotations
- `GET /books/{id}/highlights` → [{id,cfi_range,text_content,color,note,...}]
- `POST /books/{id}/highlights` {cfi_range,text_content?,color?,note?,format?}
- `PATCH /highlights/{id}` {color?,note?}
- `DELETE /highlights/{id}`
- `GET /me/highlights?book_id=&color=` → all user highlights with optional filters

## Collections (reading lists)
- `GET /collections` → [{id,name,book_count,...}]
- `POST /collections` {name,description?}
- `GET /collections/{id}` → collection + books[]
- `PATCH /collections/{id}` {name?,description?}
- `DELETE /collections/{id}`
- `POST /collections/{id}/books` {book_id}
- `DELETE /collections/{id}/books/{book_id}`

## Search
- `GET /search?q=` → {authors[],series[],books[]} (tantivy full-text)
- `POST /search/rebuild` (admin) → rebuild tantivy index

## Metadata enrichment
- `GET /books/{id}/metadata/search` → external metadata matches
- `POST /books/{id}/metadata/apply` → apply selected metadata

## Import / export
- `GET /export/reading-progress` → JSON export
- `GET /export/bookmarks` → JSON export
- `GET /export/collections` → JSON export
- `GET /export/all` → combined export
- `POST /import` → import user data from JSON
- `GET /export/library-config` (owner) → library configuration backup
- `POST /import/library-config` (owner) → restore library configuration

## Notifications
- `GET /notifications` → [{id,type,title,message,read,...}]
- `GET /notifications/count` → {unread_count}
- `PATCH /notifications/{id}/read` → mark single read
- `POST /notifications/read-all` → mark all read
- `DELETE /notifications/{id}` → delete

## Stats / activity
- `GET /stats` → server-wide stats (book count, user count, etc.)
- `GET /activity` → current user activity log
- `GET /activity/all` (admin) → all user activity

## Webhooks
- `GET /webhooks` → [{id,name,url,events,is_active,...}]
- `POST /webhooks` {name,url,secret?,events[]} (events: book.added, book.completed, library.scanned, user.registered, collection.updated)
- `PATCH /webhooks/{id}` {name?,url?,secret?,events?,is_active?}
- `DELETE /webhooks/{id}`
- `GET /webhooks/{id}/deliveries?limit=` → [{id,event,response_status,is_success,...}]
- `POST /webhooks/{id}/test` → send test event

## Custom columns
- exposed in `GET /libraries/{id}` as [{name,label,datatype,is_multiple}]
- values in Book.custom {name: value}
- usable as sort field + filter `?custom.<name>=`

## OPDS
- `/opds` root → nav: by Author / by Series / Recent
- `/opds/authors`, `/opds/authors/{id}`
- `/opds/series`, `/opds/series/{id}` → acquisition feeds
- `/opds/recent` → recently added
- `/opds/search?q=` → search feed
- works w/ KOReader etc. App sends CF-Access headers if set.

## Kobo Sync
- `/kobo/{auth_token}/v1/initialization` → Kobo init endpoint
- `/kobo/{auth_token}/v1/library/sync` → library sync
- `/kobo/{auth_token}/v1/library/tags` → tag sync
- `/kobo/{auth_token}/v1/books/{book_id}/file/{format}` → book download
- `/kobo/{auth_token}/v1/books/{book_id}/image/{w}/{h}/{q}/image.jpg` → cover
- `/kobo/{auth_token}/v1/library/{book_id}/state` (PUT) → reading state sync

## WebDAV (KOReader sync)
- `/webdav/{auth_token}/` → PROPFIND/GET/PUT/MKCOL/DELETE
- `/webdav/{auth_token}/{*path}` → file operations

## Conventions
- pagination ?page=&per_page= → {items,total,page}
- errors: JSON {error,code}; 401 no auth, 403 perm, 404, 422 bad input
- sort param names match DATA-MODEL sort fields
- rate limits: 100 req/min general, 10 req/min auth endpoints (per IP)
