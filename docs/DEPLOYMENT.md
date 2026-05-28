# Deployment Guide

This guide covers installing, configuring, and running Ironshelf on a Linux server. It also includes instructions for reverse proxy setup, Cloudflare Access integration, backup and restore, updating, and troubleshooting.

## Prerequisites

- Linux x86_64 or aarch64 (tested on Ubuntu 22.04+, Debian 12+, Fedora 38+)
- systemd (for managed service installation)
- Root or sudo access
- A Calibre library or a directory of ebook files (EPUB, PDF, CBZ)

## Installation

### Option A: Automated Install Script

The install script handles user creation, binary placement, configuration, and systemd setup in a single step.

**Linux/macOS (one-liner):**

```bash
curl -fsSL https://github.com/LightWraith8268/ironshelf/releases/latest/download/install.sh | sudo bash
```

**Windows (PowerShell as Admin):**

```powershell
irm https://github.com/LightWraith8268/ironshelf/releases/latest/download/install.ps1 | iex
```

The script will:

- Create a dedicated `ironshelf` system user with no login shell
- Install the binary to `/opt/ironshelf/`
- Generate a default `config.toml` with sensible defaults
- Install and enable the systemd service
- Start Ironshelf immediately

After installation, open your browser to `http://<server-ip>:10810` to register the first (admin) user and add your libraries.

### Option B: Manual Installation

If you prefer to control each step, follow these instructions.

1. Create the service user:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin ironshelf
```

2. Set up the install directory and place the binary:

```bash
sudo mkdir -p /opt/ironshelf
sudo cp ironshelf-server /opt/ironshelf/
sudo chmod 755 /opt/ironshelf/ironshelf-server
sudo chown -R ironshelf:ironshelf /opt/ironshelf
```

3. Create a minimal configuration file:

```bash
sudo tee /opt/ironshelf/config.toml > /dev/null << 'EOF'
host = "0.0.0.0"
port = 10810
database_path = "/opt/ironshelf/ironshelf.db"
EOF
sudo chown ironshelf:ironshelf /opt/ironshelf/config.toml
```

4. Install and start the systemd service:

```bash
sudo cp ironshelf.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ironshelf
```

5. Verify the service is running:

```bash
sudo systemctl status ironshelf
curl -s http://localhost:10810/health | python3 -m json.tool
```

## Configuration

Ironshelf reads its configuration from a TOML file. The search order for the config file is:

1. The path specified by the `IRONSHELF_CONFIG` environment variable
2. `./ironshelf.toml` in the current working directory
3. `/etc/ironshelf/config.toml`

If no configuration file is found, Ironshelf starts with built-in defaults.

### Configuration Reference

| TOML Key | Environment Variable | Default | Description |
|----------|---------------------|---------|-------------|
| `host` | `IRONSHELF_HOST` | `0.0.0.0` | Network address to listen on |
| `port` | `IRONSHELF_PORT` | `10810` | HTTP listen port |
| `database_path` | `IRONSHELF_DB` | `./ironshelf.db` | Path to the Ironshelf SQLite database (created automatically) |
| `search_index_path` | `IRONSHELF_SEARCH_INDEX` | `./ironshelf-search-index/` | Directory for the Tantivy full-text search index |
| `thumbnail_cache_path` | `IRONSHELF_THUMBNAIL_CACHE` | `./ironshelf-thumbnail-cache/` | Directory for cached cover thumbnails |
| `tls_enabled` | `IRONSHELF_TLS_ENABLED` | `false` | Set to `true` when behind a TLS-terminating reverse proxy (enables `Secure` flag on session cookies) |
| `trust_proxy_headers` | `IRONSHELF_TRUST_PROXY_HEADERS` | `false` | Set to `true` to trust `X-Forwarded-For` and `X-Real-Ip` headers for rate limiting (only enable behind a trusted reverse proxy) |
| -- | `IRONSHELF_CONFIG` | (see search order) | Override the configuration file path |
| -- | `RUST_LOG` | `ironshelf_server=info` | Log level filter (uses `tracing` syntax) |

Environment variables take precedence over TOML file values.

Libraries are managed through the web UI or the API, not the configuration file. See [API.md](API.md) for the library management endpoints.

### Full Configuration Example

```toml
host = "0.0.0.0"
port = 10810
database_path = "/opt/ironshelf/ironshelf.db"
search_index_path = "/opt/ironshelf/search-index/"
thumbnail_cache_path = "/opt/ironshelf/thumbnail-cache/"
tls_enabled = true
trust_proxy_headers = true

[oidc]
issuer_url = "https://auth.example.com"
client_id = "ironshelf"
client_secret = "your-client-secret"
redirect_uri = "https://books.example.com/api/v1/auth/oidc/callback"
scopes = ["openid", "profile", "email"]
auto_register = true
```

### OIDC/SSO Configuration

To enable single sign-on with an external identity provider (Authelia, Authentik, Keycloak, Google, etc.), add an `[oidc]` section to your configuration file:

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `issuer_url` | Yes | -- | The OpenID Connect issuer URL |
| `client_id` | Yes | -- | OAuth2 client ID for Ironshelf |
| `client_secret` | No | -- | OAuth2 client secret (omit for public clients) |
| `redirect_uri` | Yes | -- | The full callback URL (must match your provider's configuration) |
| `scopes` | No | `["openid", "profile", "email"]` | OAuth2 scopes to request |
| `auto_register` | No | `false` | Automatically create user accounts on first SSO login |

### Setting Environment Variables for the Service

To set environment variables persistently for the systemd service, use an override file:

```bash
sudo systemctl edit ironshelf
```

Then add the variables under the `[Service]` section:

```ini
[Service]
Environment=IRONSHELF_PORT=8080
Environment=RUST_LOG=ironshelf_server=debug,tower_http=debug
```

Save and restart:

```bash
sudo systemctl restart ironshelf
```

### Granting Access to Calibre Libraries

If your Calibre library lives outside `/opt/ironshelf`, you need to grant the service user read access. The recommended approach is to add the library path as a read-only bind mount in the systemd unit:

```bash
sudo systemctl edit ironshelf
```

```ini
[Service]
ReadOnlyPaths=/mnt/books/Calibre Library
```

```bash
sudo systemctl restart ironshelf
```

Alternatively, ensure the `ironshelf` system user has read permission on the library directory and its contents.

## Reverse Proxy

Ironshelf listens on plain HTTP. For production deployments, place it behind a reverse proxy that handles TLS termination. When using a reverse proxy, set `tls_enabled = true` and `trust_proxy_headers = true` in your configuration.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name books.example.com;

    ssl_certificate     /etc/letsencrypt/live/books.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/books.example.com/privkey.pem;

    # Redirect HTTP to HTTPS
    # (place in a separate server block listening on port 80)

    location / {
        proxy_pass http://127.0.0.1:10810;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Ebook downloads can be large
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 100M;

        # WebSocket support (future-proofing)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# HTTP redirect (optional, recommended)
server {
    listen 80;
    server_name books.example.com;
    return 301 https://$host$request_uri;
}
```

### Caddy

Caddy automatically provisions and renews TLS certificates via Let's Encrypt, making it the simplest option for most deployments.

```caddyfile
books.example.com {
    reverse_proxy 127.0.0.1:10810 {
        # Timeout for large ebook downloads
        transport http {
            read_timeout 300s
        }
    }
}
```

That is the complete Caddy configuration. No TLS setup is required.

### Apache (httpd)

```apache
<VirtualHost *:443>
    ServerName books.example.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/books.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/books.example.com/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:10810/
    ProxyPassReverse / http://127.0.0.1:10810/

    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
```

## Cloudflare Access

If you protect your Ironshelf instance behind Cloudflare Access (zero-trust networking), the mobile app and API clients need a service token to authenticate through the Cloudflare proxy.

### Setup Steps

1. In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/), navigate to **Access > Service Auth**.
2. Create a new **Service Token**. Note the `CF-Access-Client-Id` and `CF-Access-Client-Secret` values.
3. Under **Access > Applications**, create an application for your Ironshelf domain. Add a policy that allows your service token.
4. In the Ironshelf mobile app, go to **Server Settings** and enter the Client ID and Client Secret. The app includes these headers on every request automatically.

No server-side configuration is needed beyond setting `trust_proxy_headers = true` (since Cloudflare acts as a reverse proxy). The Cloudflare Access application policy controls who can reach your instance.

OPDS reader apps (KOReader, Moon+ Reader) that support custom headers can also use Cloudflare Access service tokens.

## Updating

Ironshelf uses SQLite with automatic, idempotent migrations. Updating is a straightforward binary replacement.

1. Download the new binary from the [Releases](https://github.com/LightWraith8268/ironshelf/releases) page.
2. Stop the service, replace the binary, and restart:

```bash
sudo systemctl stop ironshelf
sudo cp ironshelf-server /opt/ironshelf/ironshelf-server
sudo chmod 755 /opt/ironshelf/ironshelf-server
sudo chown ironshelf:ironshelf /opt/ironshelf/ironshelf-server
sudo systemctl start ironshelf
```

Your configuration file, database, search index, and thumbnail cache are all preserved across updates. Database migrations run automatically on startup when a new version requires schema changes.

### Verifying the Update

After restarting, check that the new version is running:

```bash
curl -s http://localhost:10810/health | python3 -m json.tool
```

The `version` field in the response should reflect the new release.

## Backup and Restore

Ironshelf stores all of its own data (user accounts, reading progress, bookmarks, collections, highlights, preferences) in a SQLite database. Your Calibre library is never modified.

### What to Back Up

| File / Directory | Purpose |
|------------------|---------|
| `ironshelf.db` | All server state (users, progress, bookmarks, collections, highlights, etc.) |
| `config.toml` | Server configuration |
| `ironshelf-search-index/` | Full-text search index (can be rebuilt from `/search/rebuild`) |
| `ironshelf-thumbnail-cache/` | Cover thumbnail cache (regenerated automatically) |

The search index and thumbnail cache do not need to be backed up, as they can be regenerated. The database and configuration file are essential.

### Manual Backup

```bash
# Stop the service to ensure a consistent database snapshot
sudo systemctl stop ironshelf

# Copy essential files
cp /opt/ironshelf/ironshelf.db /path/to/backup/ironshelf-$(date +%F).db
cp /opt/ironshelf/config.toml /path/to/backup/config.toml

# Restart the service
sudo systemctl start ironshelf
```

### Automated Backup with Cron

For regular automated backups, you can use SQLite's `.backup` command, which creates a consistent snapshot without stopping the service:

```bash
# Add to crontab: daily backup at 3 AM
0 3 * * * sqlite3 /opt/ironshelf/ironshelf.db ".backup /backup/ironshelf-$(date +\%F).db"
```

To manage backup retention, add a cleanup step:

```bash
# Remove backups older than 30 days
0 4 * * * find /backup/ -name "ironshelf-*.db" -mtime +30 -delete
```

### Restore from Backup

1. Stop the service:

```bash
sudo systemctl stop ironshelf
```

2. Replace the database with your backup:

```bash
sudo cp /path/to/backup/ironshelf-2025-01-15.db /opt/ironshelf/ironshelf.db
sudo chown ironshelf:ironshelf /opt/ironshelf/ironshelf.db
```

3. Optionally restore the configuration:

```bash
sudo cp /path/to/backup/config.toml /opt/ironshelf/config.toml
sudo chown ironshelf:ironshelf /opt/ironshelf/config.toml
```

4. Restart the service and rebuild the search index:

```bash
sudo systemctl start ironshelf

# Rebuild the search index to match the restored data
curl -X POST http://localhost:10810/api/v1/search/rebuild \
  -H "Authorization: Bearer irs_your_admin_key"
```

### API-Based Export and Import

Ironshelf also provides API endpoints for exporting and importing user data (reading progress, bookmarks, collections). See the [Import and Export section of the API reference](API.md#import-and-export) for details.

## Troubleshooting

### Viewing Logs

Ironshelf logs to the systemd journal. Use `journalctl` to view logs:

```bash
# Follow live logs
journalctl -u ironshelf -f

# Last 100 lines
journalctl -u ironshelf -n 100

# Logs since last boot
journalctl -u ironshelf -b

# Logs from the last hour
journalctl -u ironshelf --since "1 hour ago"
```

For more verbose logging, set the `RUST_LOG` environment variable:

```bash
sudo systemctl edit ironshelf
```

```ini
[Service]
Environment=RUST_LOG=ironshelf_server=debug,tower_http=debug
```

```bash
sudo systemctl restart ironshelf
```

### Common Issues

**Service fails to start with "Permission denied"**

The `ironshelf` system user cannot read your library directory. Add the path to `ReadOnlyPaths` in the systemd unit override:

```bash
sudo systemctl edit ironshelf
# Add: ReadOnlyPaths=/path/to/your/library
sudo systemctl restart ironshelf
```

**Service fails to start with "Address already in use"**

Another process is already using port 10810. Either stop that process or change the Ironshelf port:

```bash
sudo systemctl edit ironshelf
# Add: Environment=IRONSHELF_PORT=10811
sudo systemctl restart ironshelf
```

**Database locked errors**

Ensure only one instance of Ironshelf is running:

```bash
systemctl status ironshelf
ps aux | grep ironshelf-server
```

If you recently restored a database from backup while the service was running, restart the service.

**Cannot connect from the network**

Verify that the server is listening on the correct address (not just `127.0.0.1`) and that your firewall allows the port:

```bash
# Check listening address
ss -tlnp | grep 10810

# UFW
sudo ufw allow 10810/tcp

# firewalld
sudo firewall-cmd --add-port=10810/tcp --permanent
sudo firewall-cmd --reload
```

**Calibre library not detected**

Verify the path contains a valid `metadata.db` file and that the `ironshelf` user can read it:

```bash
sudo -u ironshelf ls -la /path/to/calibre/library/metadata.db
```

If the file exists but is not readable, check the directory permissions all the way up the path.

**Search returns no results after restore**

After restoring from a database backup, the Tantivy search index may be out of date. Rebuild it:

```bash
curl -X POST http://localhost:10810/api/v1/search/rebuild \
  -H "Authorization: Bearer irs_your_admin_key"
```
