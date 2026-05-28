# Changelog

All notable user-visible changes to Ironshelf are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Core Library Management
- Author → Series → Book hierarchy browsing — the organizing principle that sets Ironshelf apart.
- Read-only Calibre integration that reads `metadata.db` directly without modification or data duplication.
- Folder scanning with embedded EPUB OPF metadata extraction for non-Calibre collections.
- Calibre custom column support: automatic detection, display, sorting, and filtering.
- Genre and tag-based browsing with author and series drill-down within each genre.
- Metadata enrichment from Google Books and Open Library.

#### Reading Experience
- In-browser EPUB reader with cross-device reading progress synchronization.
- In-browser PDF reader with page navigation and zoom controls.
- In-browser CBZ/comic reader with page-turn navigation.
- Highlights and annotations with color coding and notes.
- Bookmarks with per-book management.
- Continue reading feature for picking up where you left off across devices.
- User collections (reading lists) with custom ordering.
- User ratings and reviews for books.
- Reading queue (to-be-read list) management.
- Reading goals with progress tracking.

#### Search
- Full-text search powered by Tantivy across all libraries, authors, series, and books.

#### Device Sync and Compatibility
- OPDS 1.2 feeds compatible with KOReader, Moon+ Reader, Librera, and other reader apps.
- Kobo eReader native sync support for library access and reading progress.
- WebDAV endpoint for KOReader progress synchronization.

#### Authentication and Multi-User
- Multi-user support with invite-based registration and role permissions.
- First registered user automatically becomes admin.
- API key authentication for headless and automation access.
- OIDC/SSO login support for Authelia, Authentik, Keycloak, Google, and other OpenID Connect providers.
- Per-library access control for multi-user environments.

#### Integrations
- Outbound webhooks for book.added, book.completed, library.scanned, user.registered, and collection.updated events.
- Import and export of reading progress, bookmarks, collections, and library configuration.
- Cloudflare Access support via custom request header passthrough.

#### Server and Infrastructure
- In-app notification system for scan completions, new books, and system events.
- Server statistics dashboard and user activity feed.
- Rate limiting (100 requests/min general, 10 requests/min auth) and security headers (CSP, HSTS).
- Graceful shutdown with connection draining on SIGTERM/SIGINT.
- Cover thumbnail caching with configurable cache directory.
- Embedded web UI compiled into a single binary via rust-embed.
- Cross-platform release builds for Linux (x86_64, aarch64), macOS (x86_64, aarch64), and Windows (x86_64).
- Install and uninstall scripts for Linux/macOS (shell) and Windows (PowerShell).
- Systemd service unit and macOS launchd plist for managed deployments.

### Fixed
- XSS prevention in web UI dynamic content rendering.
- Race conditions in concurrent scan and search index operations.
- Memory leaks in long-lived web UI event listeners.
- Path traversal protection on file serving endpoints.
- OIDC state parameter leak prevention.
- Idempotent database migrations for safe restarts.
- Consistent JSON error responses across all API endpoints.
