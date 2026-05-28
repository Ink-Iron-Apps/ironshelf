# Roadmap

This document outlines the development milestones for Ironshelf. Each milestone represents a shippable, self-contained set of features. Completed milestones are listed with their key achievements, and the future section describes what comes next.

## Completed Milestones

### M0 — Project Foundation

Established the project structure, documentation, Cargo workspace, Flutter app scaffold, and initial design documents.

### M1 — Server Core: Calibre Integration and Hierarchy API

- Read-only Calibre `metadata.db` integration (authors, series, books, formats, covers, custom columns)
- Ironshelf's own SQLite database with schema migrations (via sqlx)
- Axum-based HTTP server with health, readiness, and library/author/series/book hierarchy endpoints
- TOML and environment variable configuration

### M2 — Authentication, File Serving, and Reading Progress

- User authentication with Argon2 password hashing, session cookies, and API key Bearer tokens
- Permission system with admin and user roles
- Cover image and book file serving with HTTP Range request support (partial content / 206)
- Reading progress and bookmark tracking per user per book
- Cloudflare Access header passthrough for zero-trust deployments

### M3 — Folder Scanning, OPF Parsing, and Custom Columns

- Folder-based library source: scans directories and extracts metadata from embedded EPUB OPF files
- AO3 fandom and author heuristic detection for fan fiction collections
- Calibre custom column support: read, display, sort, and filter by custom columns
- Library type configuration and per-user sort preferences

### M4 — Flutter Mobile App

- Server connection with URL and custom header fields (Cloudflare Access support)
- Full Author, Series, Book hierarchy browsing with sort controls
- Book detail view with custom column display
- Integrated EPUB reader with cross-device reading progress synchronization
- Ink & Iron brand design and standard settings screens

### M5 — Polish and Production Readiness

- OPDS 1.2 feeds compatible with KOReader, Moon+ Reader, Librera, and other reader apps
- Multi-user administration through the web UI and API
- CI/CD pipeline with automated builds, tests, and release artifact generation
- Systemd service unit and install scripts for Linux deployments
- Rate limiting, security headers (CSP, HSTS), and graceful shutdown with connection draining

### Extended Features (M5+)

- **In-browser readers** for EPUB, PDF, and CBZ/comic files directly in the web UI
- **Full-text search** powered by Tantivy across all libraries, authors, series, and books
- **Kobo eReader sync** for native library access and reading progress synchronization
- **WebDAV endpoint** for KOReader progress synchronization
- **Metadata enrichment** from Google Books and Open Library
- **Collections** (reading lists) for organizing books independently of library structure
- **Notifications** system for scan completions, new books, and system events
- **Import/export** for data portability (reading progress, bookmarks, collections, library config)
- **Statistics dashboard** and user activity feed
- **Genre and tag browsing** with author and series drill-down within each genre
- **Highlights and annotations** with color coding and notes
- **Ratings and reviews** for books
- **Reading queue** and reading goal tracking
- **Outbound webhooks** for event-driven integrations
- **Per-library access control** for multi-user environments
- **OIDC/SSO login** with any OpenID Connect provider
- **Cover thumbnail caching** with configurable cache directory
- **Embedded web UI** compiled into the single binary via rust-embed

## Future

These features are planned but not yet started. Community input on priorities is welcome via [GitHub Discussions](https://github.com/LightWraith8268/ironshelf/discussions).

### iOS App

Bring the Flutter mobile app to iOS, providing feature parity with the Android app including Cloudflare Access support, offline reading, and progress synchronization.

### Audiobook Support

Stream M4A and MP3 audiobooks with chapter navigation, playback speed control, and listening progress tracking. The hierarchy browsing model (Author, Series, Book) will extend naturally to audiobooks.

### Reading Challenges and Social Features

Set reading goals with friends, share reading lists, and track progress on community reading challenges. Designed for book clubs and shared home libraries.

### Plugin and Extension System

A plugin API for extending Ironshelf with custom metadata providers, notification channels, import formats, and UI widgets. Enables the community to build integrations without modifying the core codebase.

### OPDS 2.0

Upgrade the OPDS catalog to version 2.0, which uses JSON-LD and supports richer metadata, streaming, and modern client features.

---

Have a feature idea? Open a discussion on [GitHub](https://github.com/LightWraith8268/ironshelf/discussions) or submit a pull request.
