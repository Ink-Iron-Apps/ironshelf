# Ironshelf

> A self-hosted ebook server with true Author → Series → Book hierarchy browsing.

<!-- Badges placeholder -->
<!-- ![Build Status](https://img.shields.io/github/actions/workflow/status/LightWraith8268/ironshelf/release.yml?branch=main) -->
<!-- ![License](https://img.shields.io/github/license/LightWraith8268/ironshelf) -->
<!-- ![Latest Release](https://img.shields.io/github/v/release/LightWraith8268/ironshelf) -->

[![Latest server release](https://img.shields.io/github/v/release/LightWraith8268/ironshelf?filter=v*&label=server&color=095F73)](https://github.com/LightWraith8268/ironshelf/releases/latest)
[![Latest Android app](https://img.shields.io/github/v/release/LightWraith8268/ironshelf?filter=app-v*&label=Android%20app&color=3BB3C9)](https://github.com/LightWraith8268/ironshelf/releases/tag/app-latest)

Ironshelf is a self-hosted ebook management server that finally gets library browsing right. Unlike Calibre-Web, Stump, or Kavita, Ironshelf organizes your collection around the relationship readers actually care about: who wrote it, what series it belongs to, and where it falls in reading order. It reads your existing Calibre database without modification, layers in folder-based scanning for non-Calibre collections, and serves everything through a clean web interface and OPDS-compatible API.

## Features

- **Calibre integration (read-only)** — Reads your existing `metadata.db` directly. No import step, no data duplication, no risk of corruption.
- **Folder scanning with OPF parsing** — Point Ironshelf at any directory of ebooks and it extracts metadata from embedded OPF files automatically.
- **Author → Series → Book hierarchy** — Browse your library the way you think about it. Series are grouped under authors, books are ordered by series index.
- **Custom column support** — Calibre custom columns (read status, tags, ratings, shelves) surface automatically in the UI and API.
- **Genre and tag browsing** — Browse by genre across all libraries with author and series drill-down within each genre.
- **Full-text search** — Fast search powered by Tantivy across all libraries, authors, series, and books.
- **OPDS feeds** — Compatible with any OPDS reader app (KOReader, Moon+ Reader, Librera, and more).
- **Kobo Sync** — Native Kobo eReader sync support for library access and reading progress.
- **WebDAV sync** — KOReader progress sync via built-in WebDAV endpoint.
- **In-browser readers** — Read EPUB, PDF, and CBZ/comic files directly in the web UI without downloading.
- **Highlights and annotations** — Create, color-code, and annotate highlights within books.
- **Collections (reading lists)** — Organize books into custom collections independent of library structure.
- **Continue reading** — Pick up where you left off with cross-device reading progress tracking.
- **Multi-user with permissions** — Invite users, assign library access, manage roles. First registered user becomes admin.
- **OIDC/SSO login** — Single sign-on with any OpenID Connect provider (Authelia, Authentik, Keycloak, Google, etc.).
- **API key authentication** — Headless access for scripts, automation, and the companion mobile app.
- **Webhooks** — Get notified when books are added, completed, or libraries are scanned via configurable webhook endpoints.
- **Notifications** — In-app notification system for scan completions, new books, and system events.
- **Import/export** — Portable data: export and import reading progress, bookmarks, collections, and library configuration.
- **Metadata enrichment** — Search and apply metadata from Google Books and Open Library to improve book information.
- **Activity and stats** — Reading statistics and activity tracking for users and the server.
- **Remote access & Ironshelf Cloud** — Reach your server from anywhere via a built-in Cloudflare Tunnel and optional cloud sign-in. The hosted dashboard requires the server be reachable over **HTTPS** (the tunnel provides this); plain `http://` LAN addresses are blocked by the browser. See [DEPLOYMENT.md](docs/DEPLOYMENT.md#ironshelf-cloud--the-hosted-dashboard-https-required).
- **Cloudflare Access support** — Pass service token headers through to secure your instance behind zero-trust networking.
- **Rate limiting and security headers** — Built-in protection against abuse with per-IP rate limiting and CSP/security headers.
- **Single binary deployment** — One executable, one config file, no Docker required. Run it directly or drop it into systemd.
- **Embedded web UI** — The web interface is compiled into the binary. No separate frontend build or static file hosting needed.
- **Graceful shutdown** — Clean connection draining on SIGTERM/SIGINT for zero-downtime restarts.

## Screenshots

> Screenshots coming soon.
>
> This section will include the library browser, series view, reader interface, and admin panel once the UI reaches beta.

## Quick Start

### 1. Install

#### Quick install (one-liner, uses defaults)

**Linux/macOS:**
```bash
curl -fsSL https://github.com/LightWraith8268/ironshelf/releases/latest/download/install.sh | sudo bash
```

**Windows (PowerShell as Admin):**
```powershell
irm https://github.com/LightWraith8268/ironshelf/releases/latest/download/install.ps1 | iex
```

#### Interactive install (choose install directory and port)

**Linux/macOS:**
```bash
curl -LO https://github.com/LightWraith8268/ironshelf/releases/latest/download/install.sh
chmod +x install.sh
sudo ./install.sh
```

**Windows (PowerShell as Admin):**
```powershell
Invoke-WebRequest -Uri https://github.com/LightWraith8268/ironshelf/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1
```

#### Manual install

Download the binary for your platform from the [Releases](https://github.com/LightWraith8268/ironshelf/releases) page and run it directly.

#### Android app

Download the **[latest app APK](https://github.com/LightWraith8268/ironshelf/releases/download/app-latest/Ironshelf-latest-debug.apk)** directly, or browse the **[latest app release](https://github.com/LightWraith8268/ironshelf/releases/tag/app-latest)** page (the `app-latest` release always points to the newest build, so it never gets lost among server releases). Open the APK on your device to install. Once installed, the app's built-in updater checks for and installs newer versions automatically — no need to revisit Releases.

### 2. Create a configuration file

Create `ironshelf.toml` in the same directory as the binary (or set the `IRONSHELF_CONFIG` environment variable to point elsewhere):

```toml
host = "0.0.0.0"
port = 10810
database_path = "./ironshelf.db"
```

> **Note:** If you skip this step, Ironshelf starts with sensible defaults (listening on `0.0.0.0:10810` with the database in the current directory).

### 3. Run it

```bash
./ironshelf-server
```

### 4. Set up your instance

1. Open your browser to `http://localhost:10810`
2. Register your first user account (this account automatically becomes the admin)
3. Navigate to **Settings → Libraries → Add Library**
4. Choose your source type (Calibre database or folder scan) and point it at your books

That's it. Ironshelf indexes your collection and you can start browsing immediately.

### Managing the Server

**Linux (systemd):**
```bash
sudo systemctl start ironshelf      # Start
sudo systemctl stop ironshelf       # Stop
sudo systemctl restart ironshelf    # Restart
sudo systemctl status ironshelf     # Check status
sudo journalctl -u ironshelf -f     # View logs
```

**macOS (launchd):**
```bash
launchctl load ~/Library/LaunchAgents/com.inknironapps.ironshelf.plist     # Start
launchctl unload ~/Library/LaunchAgents/com.inknironapps.ironshelf.plist   # Stop
launchctl list | grep ironshelf                                             # Check status
tail -f ~/Library/Logs/ironshelf.log                                        # View logs
```

**Windows (PowerShell as Admin):**
```powershell
Start-ScheduledTask -TaskName Ironshelf                                     # Start
Stop-ScheduledTask -TaskName Ironshelf                                      # Stop
Stop-ScheduledTask -TaskName Ironshelf; Start-Sleep 2; Start-ScheduledTask -TaskName Ironshelf  # Restart
Get-ScheduledTask -TaskName Ironshelf | Select-Object State                 # Check status
```

> **Windows interactive install:** Download `install.ps1` and run it directly to choose a custom install directory and port. The `irm | iex` one-liner uses defaults.

For production deployments with reverse proxies and TLS, see the [Deployment Guide](docs/DEPLOYMENT.md).

## Configuration

Ironshelf uses a TOML configuration file with sensible defaults. All settings can also be overridden with environment variables (which take precedence over the file).

| Setting | TOML Key | Environment Variable | Default |
|---------|----------|---------------------|---------|
| Listen address | `host` | `IRONSHELF_HOST` | `0.0.0.0` |
| Listen port | `port` | `IRONSHELF_PORT` | `10810` |
| Database path | `database_path` | `IRONSHELF_DB` | `./ironshelf.db` |
| Search index path | `search_index_path` | `IRONSHELF_SEARCH_INDEX` | `./ironshelf-search-index/` |
| Thumbnail cache path | `thumbnail_cache_path` | `IRONSHELF_THUMBNAIL_CACHE` | `./ironshelf-thumbnail-cache/` |
| TLS enabled | `tls_enabled` | `IRONSHELF_TLS_ENABLED` | `false` |
| Trust proxy headers | `trust_proxy_headers` | `IRONSHELF_TRUST_PROXY_HEADERS` | `false` |
| Config file path | -- | `IRONSHELF_CONFIG` | `./ironshelf.toml` |
| Log level | -- | `RUST_LOG` | `ironshelf_server=info` |

Libraries are managed through the web UI and API, not the configuration file.

### OIDC/SSO Configuration

To enable single sign-on with an external identity provider, add an `[oidc]` section to your config:

```toml
[oidc]
issuer_url = "https://auth.example.com"
client_id = "ironshelf"
client_secret = "your-secret"
redirect_uri = "https://books.example.com/api/v1/auth/oidc/callback"
scopes = ["openid", "profile", "email"]
auto_register = true
```

## API

Ironshelf exposes a REST API (JSON) and OPDS 1.2 feeds for reader app compatibility. All endpoints require authentication via session cookie or API key Bearer token.

- Full API reference: [`docs/API.md`](docs/API.md)
- OpenAPI specification: [`docs/openapi.yaml`](docs/openapi.yaml)

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Rust with Axum |
| Database | SQLite via sqlx |
| Full-text search | Tantivy |
| Web UI | Embedded vanilla JS (compiled into binary via rust-embed) |
| Mobile app | Flutter (Android; iOS coming soon) |
| Authentication | Argon2 password hashing, session cookies, API keys, OIDC/SSO |

## Building from Source

Requirements: Rust 1.75+ and Cargo.

```bash
cd server
cargo build --release
```

The compiled binary will be at `server/target/release/ironshelf-server`. The web UI files in `server/web/` are automatically embedded into the binary at compile time via rust-embed.

For development with verbose logging:

```bash
cd server
RUST_LOG=ironshelf_server=debug,tower_http=debug cargo run -p ironshelf-server
```

## Contributing

Contributions are welcome. To get started:

1. Fork the repository and clone your fork.
2. Create a feature branch from `main` (e.g., `feat/my-feature`).
3. Make your changes and commit using [Conventional Commits](https://www.conventionalcommits.org/) format (`feat:`, `fix:`, `docs:`, etc.).
4. Open a pull request against `main` with a clear description of what your change does and why.

Please open an issue or discussion before starting work on large features to ensure alignment with the project direction.

## Community

- **[GitHub Discussions](https://github.com/LightWraith8268/ironshelf/discussions)** — Ask questions, share ideas, and discuss features.
- **[GitHub Issues](https://github.com/LightWraith8268/ironshelf/issues)** — Report bugs or request features.
- **[Roadmap](docs/ROADMAP.md)** — See what has been built and what is planned next.
- **[Changelog](CHANGELOG.md)** — Track what changed in each release.

## License

The server is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
The Android/iOS app is licensed under the [GNU General Public License v3.0](app/LICENSE) (GPL-3.0).

---

Built by [Ink & Iron Apps](https://inknironapps.com) — Crafted stories. Forged software.
