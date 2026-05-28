#!/usr/bin/env bash
set -euo pipefail

# Ironshelf unified installer for Linux and macOS
# Downloads the latest release from GitHub and installs the appropriate binary.

REPO="LightWraith8268/ironshelf"
SERVICE_NAME="ironshelf"
BINARY_NAME="ironshelf-server"
DEFAULT_PORT=10810
MIN_DISK_MB=500

# --- Helpers ---

info() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*" >&2; }
error() { echo "[ERROR] $*" >&2; exit 1; }

detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Linux)  PLATFORM="linux" ;;
        Darwin) PLATFORM="macos" ;;
        *)      error "Unsupported OS: $os" ;;
    esac

    case "$arch" in
        x86_64|amd64)   ARCH="x86_64" ;;
        aarch64|arm64)  ARCH="aarch64" ;;
        *)              error "Unsupported architecture: $arch" ;;
    esac

    ARTIFACT_NAME="${BINARY_NAME}-${PLATFORM}-${ARCH}"
}

# --- Prerequisite checks ---

check_download_tool() {
    if command -v curl &>/dev/null; then
        DOWNLOAD_TOOL="curl"
    elif command -v wget &>/dev/null; then
        DOWNLOAD_TOOL="wget"
    else
        error "Neither curl nor wget found. Install one and retry."
    fi
}

check_disk_space() {
    local target_dir="$1"
    local available_mb

    # Resolve to an existing parent if target doesn't exist yet
    local check_dir="$target_dir"
    while [[ ! -d "$check_dir" ]]; do
        check_dir="$(dirname "$check_dir")"
    done

    if [[ "$PLATFORM" == "macos" ]]; then
        # macOS df outputs 512-byte blocks by default; use -m for MB
        available_mb=$(df -m "$check_dir" 2>/dev/null | awk 'NR==2 {print $4}')
    else
        available_mb=$(df -BM "$check_dir" 2>/dev/null | awk 'NR==2 {gsub(/M/,""); print $4}')
    fi

    if [[ -n "$available_mb" ]] && [[ "$available_mb" -lt "$MIN_DISK_MB" ]]; then
        error "Insufficient disk space: ${available_mb}MB available, ${MIN_DISK_MB}MB required at $target_dir"
    elif [[ -n "$available_mb" ]]; then
        info "Disk space: ${available_mb}MB available at $check_dir"
    else
        warn "Could not determine available disk space. Proceeding anyway."
    fi
}

check_optional_tools() {
    # ebook-convert (Calibre CLI) — used for format conversion
    if command -v ebook-convert &>/dev/null; then
        local ebook_version
        ebook_version=$(ebook-convert --version 2>&1 | head -1 || echo "unknown")
        info "Found ebook-convert: $ebook_version"
        info "  Format conversion feature will be available."
    else
        info "ebook-convert not found (optional)."
        info "  Install Calibre to enable format conversion (epub <-> mobi, pdf, etc.)."
        info "  https://calibre-ebook.com/download"
    fi
}

print_system_summary() {
    echo ""
    echo "=== System Information ==="
    echo ""
    echo "  Platform:     ${PLATFORM}-${ARCH}"
    echo "  OS:           $(uname -sr)"
    echo "  Download via: ${DOWNLOAD_TOOL}"

    if [[ "$PLATFORM" == "linux" ]]; then
        # Show distro info if available
        if [[ -f /etc/os-release ]]; then
            local distro
            distro=$(. /etc/os-release && echo "${PRETTY_NAME:-$NAME}")
            echo "  Distro:       $distro"
        fi

        # Check systemd
        if command -v systemctl &>/dev/null; then
            echo "  Init system:  systemd"
        else
            warn "systemd not found. The installer creates a systemd service unit."
            warn "You will need to manage the process manually or adapt for your init system."
        fi
    fi

    # ebook-convert status (brief)
    if command -v ebook-convert &>/dev/null; then
        echo "  ebook-convert: found (format conversion enabled)"
    else
        echo "  ebook-convert: not found (format conversion unavailable)"
    fi

    # TLS info
    echo "  TLS backend:  rustls (bundled, no system libssl required)"

    echo ""
}

run_preflight_checks() {
    info "Running preflight checks..."
    echo ""

    check_download_tool

    # Determine install target for disk space check
    local install_target
    if [[ "$PLATFORM" == "linux" ]]; then
        install_target="/opt/ironshelf"
    else
        install_target="/usr/local/bin"
    fi
    check_disk_space "$install_target"

    check_optional_tools
    print_system_summary
}

# --- Download helpers ---

get_latest_release_url() {
    local api_url="https://api.github.com/repos/${REPO}/releases/latest"
    local download_url

    if [[ "$DOWNLOAD_TOOL" == "curl" ]]; then
        download_url=$(curl -fsSL "$api_url" | grep -o "\"browser_download_url\": *\"[^\"]*${ARTIFACT_NAME}\"" | head -1 | cut -d'"' -f4)
    else
        download_url=$(wget -qO- "$api_url" | grep -o "\"browser_download_url\": *\"[^\"]*${ARTIFACT_NAME}\"" | head -1 | cut -d'"' -f4)
    fi

    if [[ -z "$download_url" ]]; then
        error "Could not find release asset '${ARTIFACT_NAME}' in the latest release. Check https://github.com/${REPO}/releases"
    fi

    DOWNLOAD_URL="$download_url"
    info "Download URL: $DOWNLOAD_URL"
}

download_binary() {
    local dest="$1"
    info "Downloading binary..."
    if [[ "$DOWNLOAD_TOOL" == "curl" ]]; then
        curl -fsSL -o "$dest" "$DOWNLOAD_URL"
    else
        wget -qO "$dest" "$DOWNLOAD_URL"
    fi
    chmod 755 "$dest"
    info "Binary downloaded to $dest"
}

write_default_config() {
    local config_path="$1"
    local data_dir="$2"
    if [[ -f "$config_path" ]]; then
        info "Config already exists at $config_path, not overwriting."
        return
    fi

    mkdir -p "$(dirname "$config_path")"
    cat > "$config_path" << EOF
# Ironshelf Configuration
# See https://github.com/LightWraith8268/ironshelf for documentation.

host = "0.0.0.0"
port = 10810
database_path = "${data_dir}/ironshelf.db"

# search_index_path = "${data_dir}/ironshelf-search-index/"
# thumbnail_cache_path = "${data_dir}/ironshelf-thumbnail-cache/"
# tls_enabled = false
# trust_proxy_headers = false

# Libraries are managed through the web UI, not this file.

# Optional: OIDC/SSO login (Authelia, Authentik, Keycloak, etc.)
# [oidc]
# issuer_url = "https://auth.example.com"
# client_id = "ironshelf"
# client_secret = "your-secret"
# redirect_uri = "https://books.example.com/api/v1/auth/oidc/callback"
# scopes = ["openid", "profile", "email"]
# auto_register = true
EOF
    info "Default config written to $config_path"
}

# --- Linux installation ---

install_linux() {
    local install_dir="/opt/ironshelf"
    local config_path="${install_dir}/config.toml"
    local binary_path="${install_dir}/${BINARY_NAME}"

    if [[ $EUID -ne 0 ]]; then
        error "Linux installation requires root. Run with sudo."
    fi

    # Create dedicated user
    if ! id -u "$SERVICE_NAME" &>/dev/null; then
        info "Creating ironshelf system user..."
        useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_NAME"
    fi

    # Create install directory
    mkdir -p "$install_dir"

    # Download binary
    download_binary "$binary_path"

    # Config
    write_default_config "$config_path" "$install_dir"

    # Ownership
    chown -R "$SERVICE_NAME":"$SERVICE_NAME" "$install_dir"

    # Install systemd unit
    info "Installing systemd service..."
    cat > /etc/systemd/system/ironshelf.service << 'EOF'
[Unit]
Description=Ironshelf ebook server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ironshelf
Group=ironshelf
WorkingDirectory=/opt/ironshelf

ExecStart=/opt/ironshelf/ironshelf-server

Environment=IRONSHELF_CONFIG=/opt/ironshelf/config.toml
Environment=RUST_LOG=ironshelf_server=info

Restart=on-failure
RestartSec=5

StandardOutput=journal
StandardError=journal

# Hardening
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictNamespaces=true
ReadWritePaths=/opt/ironshelf

# Calibre library directories (add your paths here)
# ReadOnlyPaths=/path/to/calibre/library

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl start "$SERVICE_NAME"

    echo ""
    echo "=== Ironshelf Installed (Linux) ==="
    echo ""
    systemctl status "$SERVICE_NAME" --no-pager || true
    echo ""
    local server_ip
    server_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
    echo "Running at: http://${server_ip}:${DEFAULT_PORT}"
    echo "Config:     ${config_path}"
    echo "Logs:       journalctl -u ${SERVICE_NAME} -f"
    echo ""
    echo "Next steps:"
    echo "  1. Open http://localhost:${DEFAULT_PORT} and register your admin account"
    echo "  2. Add libraries via Settings → Libraries in the web UI"
    echo "  3. Config file: ${config_path}"
}

# --- macOS installation ---

install_macos() {
    local binary_path="/usr/local/bin/${BINARY_NAME}"
    local config_dir="${HOME}/.config/ironshelf"
    local config_path="${config_dir}/config.toml"
    local plist_label="com.inknironapps.ironshelf"
    local plist_dir="${HOME}/Library/LaunchAgents"
    local plist_path="${plist_dir}/${plist_label}.plist"
    local log_path="${HOME}/Library/Logs/ironshelf.log"

    # May need sudo for /usr/local/bin on some systems
    if [[ ! -w "/usr/local/bin" ]]; then
        error "Cannot write to /usr/local/bin. Run with sudo or fix permissions."
    fi

    # Download binary
    download_binary "$binary_path"

    # Config
    write_default_config "$config_path" "$config_dir"

    # Install launchd plist
    mkdir -p "$plist_dir"
    cat > "$plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plist_label}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/${BINARY_NAME}</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>IRONSHELF_CONFIG</key>
        <string>${config_path}</string>
        <key>RUST_LOG</key>
        <string>ironshelf_server=info</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${log_path}</string>

    <key>StandardErrorPath</key>
    <string>${log_path}</string>
</dict>
</plist>
EOF

    # Load the service
    launchctl unload "$plist_path" 2>/dev/null || true
    launchctl load "$plist_path"

    echo ""
    echo "=== Ironshelf Installed (macOS) ==="
    echo ""
    echo "Running at: http://localhost:${DEFAULT_PORT}"
    echo "Binary:     ${binary_path}"
    echo "Config:     ${config_path}"
    echo "Logs:       ${log_path}"
    echo "Plist:      ${plist_path}"
    echo ""
    echo "Next steps:"
    echo "  1. Open http://localhost:${DEFAULT_PORT} and register your admin account"
    echo "  2. Add libraries via Settings → Libraries in the web UI"
    echo "  3. Config file: ${config_path}"
    echo "  4. Restart after config changes:"
    echo "     launchctl unload ${plist_path} && launchctl load ${plist_path}"
}

# --- Main ---

echo "=== Ironshelf Installer ==="
echo ""

detect_platform
run_preflight_checks
get_latest_release_url

case "$PLATFORM" in
    linux)  install_linux ;;
    macos)  install_macos ;;
esac
