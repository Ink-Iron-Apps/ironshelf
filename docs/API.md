# API Reference

Ironshelf exposes a REST API with JSON request and response bodies, served under the `/api/v1` prefix. It also provides OPDS 1.2 catalog feeds for compatibility with dedicated reader applications.

For complete schema definitions, request/response models, and field-level documentation, see [openapi.yaml](openapi.yaml).

## Authentication

All API endpoints require authentication unless otherwise noted. Ironshelf supports three authentication methods:

| Method | Header / Mechanism | Use Case |
|--------|-------------------|----------|
| Session cookie | Set automatically after `POST /auth/login` | Web UI and browser-based access |
| API key | `Authorization: Bearer irs_<key>` | Scripts, automation, and the mobile app |
| OIDC/SSO | Redirect flow via `/auth/oidc/login` | Single sign-on with external identity providers |

API keys are created through the `/auth/api-keys` endpoint and are shown only once at creation time.

---

## Health and Readiness (No Authentication Required)

These endpoints are intended for load balancers, monitoring systems, and orchestration tools.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Returns server status, version, uptime, library count, and database state |
| `GET` | `/ready` | Returns readiness status; responds with `503` if the server is not ready |
| `GET` | `/alive` | Simple liveness probe; returns `{"alive": true}` |
| `GET` | `/api/v1/server/info` | Returns server version and supported capabilities |

---

## Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/login` | Authenticate with username and password; returns a session cookie and token |
| `POST` | `/auth/logout` | End the current session |
| `POST` | `/auth/register` | Create a new user account (the first registered user becomes admin) |
| `GET` | `/auth/me` | Return the current user's profile and permissions |
| `POST` | `/auth/api-keys` | Create a new API key (the key value is returned only once) |
| `GET` | `/auth/api-keys` | List the current user's API keys |
| `DELETE` | `/auth/api-keys/{id}` | Revoke an API key |
| `GET` | `/auth/oidc/login` | Begin an OIDC/SSO login flow; returns a redirect URL |
| `GET` | `/auth/oidc/callback` | OIDC provider callback; sets session cookie and redirects to the UI |

### Example: Login

**Request:**

```http
POST /auth/login
Content-Type: application/json

{
  "username": "alice",
  "password": "correct-horse-battery-staple"
}
```

**Response:**

```json
{
  "token": "irs_abc123def456...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "alice",
    "is_owner": true,
    "permissions": ["admin"]
  }
}
```

### Example: Create an API Key

**Request:**

```http
POST /auth/api-keys
Authorization: Bearer irs_abc123def456...
Content-Type: application/json

{
  "label": "backup-script"
}
```

**Response:**

```json
{
  "id": "key-uuid-here",
  "label": "backup-script",
  "key": "irs_newkey789...",
  "created_at": "2025-01-15T10:30:00Z"
}
```

> **Important:** The `key` field is only returned at creation time. Store it securely.

---

## Users (Admin Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/users` | List all users |
| `POST` | `/users/invite` | Invite a new user with a preset username, password, and permissions |
| `DELETE` | `/users/{id}` | Remove a user account |
| `PATCH` | `/users/{id}/permissions` | Update a user's permissions |

---

## Libraries

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/libraries` | Any user | List all libraries the user can access |
| `POST` | `/libraries` | Admin | Create a new library and trigger an initial scan |
| `GET` | `/libraries/{id}` | Any user | Get library details, including custom column definitions |
| `PATCH` | `/libraries/{id}` | Admin | Update library type or options |
| `DELETE` | `/libraries/{id}` | Admin | Remove a library |
| `POST` | `/libraries/{id}/scan` | Admin | Trigger a re-scan of the library |
| `POST` | `/libraries/{id}/metadata/scan` | Admin | Trigger bulk metadata enrichment for all books in the library |

### Example: Create a Calibre Library

**Request:**

```http
POST /libraries
Authorization: Bearer irs_abc123def456...
Content-Type: application/json

{
  "name": "Main Library",
  "type": "ebooks",
  "source_kind": "calibre",
  "path": "/mnt/books/Calibre Library",
  "options": {}
}
```

**Response:**

```json
{
  "id": "lib-uuid-here",
  "name": "Main Library",
  "type": "ebooks",
  "source_kind": "calibre",
  "path": "/mnt/books/Calibre Library",
  "book_count": 0,
  "scan_status": "scanning"
}
```

---

## Hierarchy Browsing

All hierarchy endpoints support pagination and sorting via query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number (1-indexed) |
| `per_page` | integer | `20` | Items per page |
| `sort` | string | varies | Sort field name |
| `dir` | string | `asc` | Sort direction (`asc` or `desc`) |

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/libraries/{id}/authors` | List authors in a library |
| `GET` | `/libraries/{id}/books` | List all books in a library (supports filtering) |
| `GET` | `/authors/{id}` | Get an author with their series list and standalone book count |
| `GET` | `/authors/{id}/series` | List all series by an author |
| `GET` | `/authors/{id}/standalone` | List books by an author that are not part of any series |
| `GET` | `/series/{id}` | Get a series with its books (sorted by series index by default) |
| `GET` | `/books/{id}` | Get full book details, including custom column values |

### Book Filtering

The `GET /libraries/{id}/books` endpoint supports the following filter parameters:

| Parameter | Description |
|-----------|-------------|
| `author` | Filter by author ID |
| `series` | Filter by series ID |
| `tag` | Filter by tag name |
| `custom.<column_name>` | Filter by any Calibre custom column value |
| `q` | Free-text filter within the library |

---

## Genres

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/genres` | List all genres across all libraries with book counts |
| `GET` | `/genres/{genre_name}` | List books in a genre (paginated) |
| `GET` | `/genres/{genre_name}/authors` | List authors who have books in a genre |
| `GET` | `/genres/{genre_name}/series` | List series that belong to a genre |
| `GET` | `/libraries/{id}/genres` | List genres within a specific library |
| `GET` | `/libraries/{id}/genres/{genre_name}/books` | List books in a genre within a specific library |

---

## Files and Reading

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/books/{id}/cover` | Download the book's cover image (JPEG, cached for 24 hours) |
| `GET` | `/books/{id}/file` | Download the book file; supports HTTP Range requests for partial content (206) |
| `GET` | `/books/{id}/progress` | Get the current user's reading progress for a book |
| `PUT` | `/books/{id}/progress` | Update reading progress |
| `GET` | `/books/{id}/bookmarks` | List bookmarks for a book |
| `POST` | `/books/{id}/bookmarks` | Create a bookmark |
| `DELETE` | `/books/{id}/bookmarks/{bookmark_id}` | Delete a bookmark |
| `GET` | `/books/continue` | List recently-read books with progress information |

The `GET /books/{id}/file` endpoint accepts an optional `format` query parameter (e.g., `?format=EPUB`) to select a specific file format when multiple are available.

### Example: Update Reading Progress

```http
PUT /books/{id}/progress
Content-Type: application/json

{
  "format": "EPUB",
  "locator": "/chapter3.xhtml#p42",
  "percent": 0.45
}
```

---

## Highlights and Annotations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/books/{id}/highlights` | List all highlights for a book |
| `POST` | `/books/{id}/highlights` | Create a new highlight |
| `PATCH` | `/highlights/{id}` | Update a highlight's color or note |
| `DELETE` | `/highlights/{id}` | Delete a highlight |
| `GET` | `/me/highlights` | List all of the current user's highlights (filterable by `book_id` and `color`) |

---

## Collections (Reading Lists)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/collections` | List the current user's collections |
| `POST` | `/collections` | Create a new collection |
| `GET` | `/collections/{id}` | Get a collection with its books |
| `PATCH` | `/collections/{id}` | Update a collection's name or description |
| `DELETE` | `/collections/{id}` | Delete a collection |
| `POST` | `/collections/{id}/books` | Add a book to a collection |
| `DELETE` | `/collections/{id}/books/{book_id}` | Remove a book from a collection |

---

## Search

Ironshelf uses a Tantivy-powered full-text search index that spans all libraries.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/search?q={query}` | Search across authors, series, and books |
| `POST` | `/search/rebuild` | Rebuild the search index (admin only) |

### Example: Search

**Request:**

```http
GET /search?q=sanderson
Authorization: Bearer irs_abc123def456...
```

**Response:**

```json
{
  "authors": [
    { "id": "author-uuid", "name": "Brandon Sanderson", "book_count": 42 }
  ],
  "series": [
    { "id": "series-uuid", "name": "The Stormlight Archive", "book_count": 4 }
  ],
  "books": [
    { "id": "book-uuid", "title": "The Way of Kings", "author_name": "Brandon Sanderson" }
  ]
}
```

---

## Metadata Enrichment

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/books/{id}/metadata/search` | Search external providers for metadata matches |
| `POST` | `/books/{id}/metadata/apply` | Apply selected metadata to a book |

---

## Import and Export

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/export/reading-progress` | Any user | Export reading progress as JSON |
| `GET` | `/export/bookmarks` | Any user | Export bookmarks as JSON |
| `GET` | `/export/collections` | Any user | Export collections as JSON |
| `GET` | `/export/all` | Any user | Export all user data as a single JSON file |
| `POST` | `/import` | Any user | Import user data from a JSON file |
| `GET` | `/export/library-config` | Owner | Export library configuration |
| `POST` | `/import/library-config` | Owner | Restore library configuration from a backup |

---

## Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/notifications` | List the current user's notifications |
| `GET` | `/notifications/count` | Get the unread notification count |
| `PATCH` | `/notifications/{id}/read` | Mark a single notification as read |
| `POST` | `/notifications/read-all` | Mark all notifications as read |
| `DELETE` | `/notifications/{id}` | Delete a notification |

---

## Statistics and Activity

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/stats` | Any user | Get server-wide statistics (book count, user count, etc.) |
| `GET` | `/activity` | Any user | Get the current user's activity log |
| `GET` | `/activity/all` | Admin | Get activity logs for all users |

---

## Webhooks

Webhooks allow you to receive HTTP callbacks when events occur on the server.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/webhooks` | List configured webhooks |
| `POST` | `/webhooks` | Create a new webhook |
| `PATCH` | `/webhooks/{id}` | Update a webhook |
| `DELETE` | `/webhooks/{id}` | Delete a webhook |
| `GET` | `/webhooks/{id}/deliveries` | List delivery history for a webhook |
| `POST` | `/webhooks/{id}/test` | Send a test event to a webhook |

### Supported Events

| Event | Trigger |
|-------|---------|
| `book.added` | A new book is detected during a library scan |
| `book.completed` | A user marks a book as 100% complete |
| `library.scanned` | A library scan finishes |
| `user.registered` | A new user registers |
| `collection.updated` | A collection is created or modified |

---

## Custom Columns

Calibre custom columns are automatically detected and exposed through the API:

- The `GET /libraries/{id}` response includes a `custom_columns` array with each column's `name`, `label`, `datatype`, and `is_multiple` flag.
- Book detail responses include a `custom` map with column names as keys and their values.
- Custom columns can be used as sort fields and as filter parameters using the `?custom.<name>=` syntax on book listing endpoints.

---

## OPDS Catalog

Ironshelf serves OPDS 1.2 feeds for compatibility with dedicated e-reader applications such as KOReader, Moon+ Reader, and Librera.

| Endpoint | Description |
|----------|-------------|
| `/opds` | Root navigation feed (links to browse by author, series, or recent additions) |
| `/opds/authors` | Author listing feed |
| `/opds/authors/{id}` | Books by a specific author (acquisition feed) |
| `/opds/series` | Series listing feed |
| `/opds/series/{id}` | Books in a specific series (acquisition feed) |
| `/opds/recent` | Recently added books |
| `/opds/search?q={query}` | Search results feed |

OPDS endpoints require the same authentication as the REST API. When accessed behind Cloudflare Access, the client must include the appropriate `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.

---

## Kobo Sync

Ironshelf provides native Kobo eReader sync endpoints. The `{auth_token}` path segment serves as authentication for the Kobo device.

| Endpoint | Description |
|----------|-------------|
| `/kobo/{auth_token}/v1/initialization` | Kobo device initialization |
| `/kobo/{auth_token}/v1/library/sync` | Library synchronization |
| `/kobo/{auth_token}/v1/library/tags` | Tag synchronization |
| `/kobo/{auth_token}/v1/books/{book_id}/file/{format}` | Book file download |
| `/kobo/{auth_token}/v1/books/{book_id}/image/{w}/{h}/{q}/image.jpg` | Cover image at specified dimensions |
| `/kobo/{auth_token}/v1/library/{book_id}/state` | Reading state synchronization (PUT) |

---

## WebDAV (KOReader Sync)

A built-in WebDAV endpoint provides KOReader progress synchronization. The `{auth_token}` path segment serves as authentication.

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/webdav/{auth_token}/` | `PROPFIND`, `GET`, `PUT`, `MKCOL`, `DELETE` | Root directory operations |
| `/webdav/{auth_token}/{*path}` | `PROPFIND`, `GET`, `PUT`, `MKCOL`, `DELETE` | File and directory operations |

---

## Conventions

### Pagination

All list endpoints return paginated results using the following query parameters and response structure:

**Query parameters:** `?page=1&per_page=20`

**Response structure:**

```json
{
  "items": [...],
  "total": 150,
  "page": 1,
  "per_page": 20
}
```

### Error Responses

All errors are returned as JSON with a consistent structure:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| `401` | Not authenticated |
| `403` | Insufficient permissions |
| `404` | Resource not found |
| `422` | Invalid input (validation error) |
| `429` | Rate limit exceeded |

### Rate Limits

| Scope | Limit |
|-------|-------|
| General API | 100 requests per minute per IP |
| Authentication endpoints | 10 requests per minute per IP |
