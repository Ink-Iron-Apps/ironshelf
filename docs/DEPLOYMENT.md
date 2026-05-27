# Deployment Guide

This guide covers installing and running Ironshelf on a Linux server.

## Prerequisites

- Linux x86_64 (tested on Ubuntu 22.04+, Debian 12+, Fedora 38+)
- systemd
- Root or sudo access
- A Calibre library or directory of ebook files

## Installation

### Option A: Automated Install Script

1. Download the install script from the latest release:

```bash
curl -LO https://github.com/LightWraith8268/ironshelf/releases/latest/download/install.sh
chmod +x install.sh
```

2. Run the install script:

```bash
sudo ./install.sh
```

The script will:
- Create a dedicated `ironshelf` system user
- Install the binary to `/opt/ironshelf/`
- Generate a default `config.toml`
- Install and start the systemd service

### Option B: Manual Installation

1. Create the service user:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin ironshelf
```

2. Set up the install directory:

```bash
sudo mkdir -p /opt/ironshelf
sudo cp ironshelf-server /opt/ironshelf/
sudo chmod 755 /opt/ironshelf/ironshelf-server
sudo chown -R ironshelf:ironshelf /opt/ironshelf
```

3. Install the systemd unit:

```bash
sudo cp ironshelf.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ironshelf
```

## Configuration

Ironshelf reads its configuration from `/opt/ironshelf/config.toml`. A minimal example:

```toml
host = "0.0.0.0"
port = 10810
database_path = "/opt/ironshelf/ironshelf.db"
```

Libraries are managed through the web UI (Settings → Libraries → Add Library), not the configuration file.

### Environment Variables

You can override settings with environment variables. To set them persistently for the service:

```bash
sudo systemctl edit ironshelf
```

Then add:

```ini
[Service]
Environment=IRONSHELF_PORT=8080
Environment=RUST_LOG=ironshelf_server=debug,tower_http=debug
```

| Variable | Default | Description |
|----------|---------|-------------|
| `IRONSHELF_CONFIG` | `/opt/ironshelf/config.toml` | Path to configuration file |
| `IRONSHELF_PORT` | `10810` | HTTP listen port |
| `RUST_LOG` | `ironshelf_server=info` | Log level filter |

### Granting Access to Calibre Libraries

If your Calibre library lives outside `/opt/ironshelf`, you need to grant the service read access. Edit the systemd unit:

```bash
sudo systemctl edit ironshelf
```

Add your library path as a read-only mount:

```ini
[Service]
ReadOnlyPaths=/mnt/books/Calibre Library
```

Then restart:

```bash
sudo systemctl restart ironshelf
```

## Reverse Proxy

Ironshelf listens on HTTP only. Use a reverse proxy for HTTPS termination.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name books.example.com;

    ssl_certificate     /etc/letsencrypt/live/books.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/books.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:10810;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Large file downloads (ebooks)
        proxy_read_timeout 300s;
        client_max_body_size 100M;
    }
}
```

### Caddy

```
books.example.com {
    reverse_proxy 127.0.0.1:10810
}
```

Caddy handles TLS certificates automatically via Let's Encrypt.

## Cloudflare Access

If you protect Ironshelf behind Cloudflare Access, the Flutter app needs a service token to authenticate.

1. In the Cloudflare Zero Trust dashboard, create a **Service Token** under Access > Service Auth.
2. Note the `CF-Access-Client-Id` and `CF-Access-Client-Secret` values.
3. In the Ironshelf app, go to **Server Settings** and enter the Client ID and Client Secret. The app will include these headers on every request.

No server-side configuration is needed beyond the standard Cloudflare Access application policy.

## Updating

1. Download the new binary from the latest release.
2. Replace the installed binary:

```bash
sudo systemctl stop ironshelf
sudo cp ironshelf-server /opt/ironshelf/ironshelf-server
sudo chmod 755 /opt/ironshelf/ironshelf-server
sudo chown ironshelf:ironshelf /opt/ironshelf/ironshelf-server
sudo systemctl start ironshelf
```

Your configuration and database are preserved across updates.

## Backup

Ironshelf stores its own data (user accounts, reading progress, preferences) in a SQLite database at `/opt/ironshelf/ironshelf.db`. Your Calibre library is never modified.

To back up Ironshelf state:

```bash
cp /opt/ironshelf/ironshelf.db /path/to/backup/ironshelf.db
cp /opt/ironshelf/config.toml /path/to/backup/config.toml
```

For automated backups, a simple cron job works well:

```bash
# Daily backup at 3 AM
0 3 * * * cp /opt/ironshelf/ironshelf.db /backup/ironshelf-$(date +\%F).db
```

## Troubleshooting

### Viewing Logs

```bash
# Follow live logs
journalctl -u ironshelf -f

# Last 100 lines
journalctl -u ironshelf -n 100

# Logs since last boot
journalctl -u ironshelf -b
```

### Common Issues

**Service fails to start — "Permission denied"**

The `ironshelf` user cannot read your library directory. Add it to `ReadOnlyPaths` in the systemd unit override (see Configuration section above).

**Service fails to start — "Address already in use"**

Another process is using port 10810. Either stop that process or change the Ironshelf port:

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

**Cannot connect from the network**

Check that the firewall allows the port:

```bash
# UFW
sudo ufw allow 10810/tcp

# firewalld
sudo firewall-cmd --add-port=10810/tcp --permanent
sudo firewall-cmd --reload
```

**Calibre library not detected**

Verify the path contains a valid `metadata.db` file and that the `ironshelf` user can read it:

```bash
sudo -u ironshelf ls /path/to/calibre/library/metadata.db
```
