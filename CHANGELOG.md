# Changelog

All notable user-visible changes to Ironshelf are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Full-text search powered by Tantivy across all libraries, authors, series, and books.
- In-browser EPUB reader with cross-device reading progress sync.
- In-browser PDF reader with page navigation and zoom controls.
- In-browser CBZ/comic reader with page-turn navigation.
- In-reader highlights and annotations with color coding and notes.
- OPDS 1.2 feeds compatible with KOReader, Moon+ Reader, Librera, and other reader apps.
- Kobo eReader native sync support for library access and reading progress.
- WebDAV endpoint for KOReader progress synchronization.
- OIDC/SSO login support for Authelia, Authentik, Keycloak, Google, and other OpenID Connect providers.
- Genre and tag-based browsing with author and series drill-down within each genre.
- User collections (reading lists) with custom ordering.
- User ratings and reviews for books.
- Reading queue (to-be-read list) management.
- Reading goals with progress tracking.
- Outbound webhooks for book.added, book.completed, library.scanned, and other events.
- Per-library access control for multi-user environments.
- Metadata enrichment from Google Books and Open Library.
- Import and export of reading progress, bookmarks, collections, and library configuration.
- In-app notification system for scan completions, new books, and system events.
- Server statistics dashboard and user activity feed.
- Continue reading feature with cross-device progress tracking.
- Rate limiting (100 req/min general, 10 req/min auth) and security headers (CSP, HSTS, etc.).
- Graceful shutdown with connection draining on SIGTERM/SIGINT.
- Cover thumbnail caching with configurable cache directory.
- Embedded web UI compiled into the single binary via rust-embed.
- Cross-platform release builds for Linux (x86_64, aarch64), macOS (x86_64, aarch64), and Windows (x86_64).
- Install and uninstall scripts for Linux/macOS (shell) and Windows (PowerShell).
- Systemd service unit and macOS launchd plist for managed deployments.
- Cloudflare Access support via custom request header passthrough.
- API key authentication for headless and automation access.
- Multi-user support with invite-based registration and role permissions.
- Calibre integration (read-only) with custom column support.
- Folder scanning with embedded EPUB OPF metadata extraction.
- Author, Series, Book hierarchy browsing — the core feature.

### Fixed
- XSS prevention in web UI dynamic content rendering.
- Race conditions in concurrent scan and search index operations.
- Memory leaks in long-lived web UI event listeners.
- Path traversal protection on file serving endpoints.
- OIDC state parameter leak prevention.
- Idempotent database migrations for safe restarts.
- Proper error handling across all API endpoints with consistent JSON error responses.
