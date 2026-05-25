# Ironshelf

> A self-hosted ebook server with true Author → Series → Book hierarchy browsing.

<!-- Badges placeholder -->
<!-- ![Build Status](https://img.shields.io/github/actions/workflow/status/LightWraith8268/ironshelf/release.yml?branch=main) -->
<!-- ![License](https://img.shields.io/github/license/LightWraith8268/ironshelf) -->
<!-- ![Latest Release](https://img.shields.io/github/v/release/LightWraith8268/ironshelf) -->

Ironshelf is a self-hosted ebook management server that finally gets library browsing right. Unlike Calibre-Web, Stump, or Kavita, Ironshelf organizes your collection around the relationship readers actually care about: who wrote it, what series it belongs to, and where it falls in reading order. It reads your existing Calibre database without modification, layers in folder-based scanning for non-Calibre collections, and serves everything through a clean web interface and OPDS-compatible API.

## Features

- **Calibre integration (read-only)** — Reads your existing `metadata.db` directly. No import step, no data duplication, no risk of corruption.
- **Folder scanning with OPF parsing** — Point Ironshelf at any directory of epubs and it extracts metadata from embedded OPF files automatically.
- **Author → Series → Book hierarchy** — Browse your library the way you think about it. Series are grouped under authors, books are ordered by series index.
- **Custom column support** — Calibre custom columns (read status, tags, ratings, shelves) surface automatically in the UI and API.
- **OPDS feeds** — Compatible with any OPDS reader app (KOReader, Moon+ Reader, Librera, and more).
- **In-browser epub reader** — Read directly in the web UI without downloading or switching apps.
- **Multi-user with permissions** — Invite users, assign library access, manage roles. First registered user becomes admin.
- **API key authentication** — Headless access for scripts, automation, and the companion mobile app.
- **Cloudflare Access support** — Pass service token headers through to secure your instance behind zero-trust networking.
- **Single binary deployment** — One executable, one config file, no Docker required. Run it directly or drop it into systemd.
- **Embedded web UI** — The web interface is compiled into the binary. No separate frontend build or static file hosting needed.

## Screenshots

> Screenshots coming soon.
>
> This section will include the library browser, series view, reader interface, and admin panel once the UI reaches beta.

## Quick Start

### 1. Download

Grab the latest binary for your platform from the [Releases](https://github.com/LightWraith8268/ironshelf/releases) page.

### 2. Create a configuration file

Create `ironshelf.toml` in the same directory as the binary (or at `~/.config/ironshelf/ironshelf.toml`):

```toml
host = "0.0.0.0"
port = 10810
database_path = "/var/lib/ironshelf/ironshelf.db"
```

### 3. Run it

```bash
./ironshelf-server
```

### 4. Set up your instance

1. Open your browser to `http://localhost:10810`
2. Register your first user account (this account automatically becomes the admin)
3. Navigate to Settings → Libraries → Add Library
4. Choose your source type (Calibre database or folder scan) and point it at your books

That's it. Ironshelf indexes your collection and you can start browsing immediately.

## Configuration

Ironshelf uses a TOML configuration file with sensible defaults. All settings can also be overridden with environment variables.

| Setting | TOML key | Environment variable | Default |
|---------|----------|---------------------|---------|
| Listen address | `host` | `IRONSHELF_HOST` | `127.0.0.1` |
| Listen port | `port` | `IRONSHELF_PORT` | `10810` |
| Database path | `database_path` | `IRONSHELF_DB` | `./ironshelf.db` |
| Config file path | — | `IRONSHELF_CONFIG` | `./ironshelf.toml` |

Environment variables take precedence over the TOML file. The config file location itself can only be set via `IRONSHELF_CONFIG`.

## API

Ironshelf exposes a REST API (JSON) and OPDS 1.2 feeds for reader app compatibility. All endpoints require authentication via session cookie or API key Bearer token.

For the full API specification, see [`docs/API.md`](docs/API.md).

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Rust with Axum |
| Database | SQLite via sqlx |
| Web UI | Embedded (vanilla JS) |
| Mobile app | Flutter (coming soon) |
| Authentication | Argon2 password hashing, session cookies, API keys |

## Building from Source

Requirements: Rust 1.75+ and Cargo.

```bash
cd server
cargo build --release
```

The compiled binary will be at `target/release/ironshelf-server`.

For development with verbose logging:

```bash
cd server
RUST_LOG=ironshelf_server=debug,tower_http=debug cargo run -p ironshelf-server
```

## License

This project is licensed under the [MIT License](LICENSE).

---

Built by [Ink & Iron Apps](https://inknironapps.com) — Crafted stories. Forged software.
