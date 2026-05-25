#!/usr/bin/env bash
set -euo pipefail

# Ironshelf unified installer for Linux and macOS
# Downloads the latest release from GitHub and installs the appropriate binary.

REPO="LightWraith8268/ironshelf"
SERVICE_NAME="ironshelf"
BINARY_NAME="ironshelf-server"
DEFAULT_PORT=10810

# --- Helpers ---

info() { echo "[INFO] $*"; }
error() { echo "[ERROR] $*" >&2; exit 1; }

detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Linux)  PLATFORM="linux" ;;
        Darwin) PLATFORM="darwin" ;;
        *)      error "Unsupported OS: $os" ;;
    esac

    case "$arch" in
        x86_64|amd64)   ARCH="x86_64" ;;
        aarch64|arm64)  ARCH="aarch64" ;;
        *)              error "Unsupported architecture: $arch" ;;
    esac

    ARTIFACT_NAME="${BINARY_NAME}-${PLATFORM}-${ARCH}"
    info "Detected platform: ${PLATFORM}-${ARCH}"
}

get_latest_release_url() {
    local api_url="https://api.github.com/repos/${REPO}/releases/latest"
    local download_url

    if command -v curl &>/dev/null; then
        download_url=$(curl -fsSL "$api_url" | grep -o "\"browser_download_url\": *\"[^\"]*${ARTIFACT_NAME}\"" | head -1 | cut -d'"' -f4)
    elif command -v wget &>/dev/null; then
        download_url=$(wget -qO- "$api_url" | grep -o "\"browser_download_url\": *\"[^\"]*${ARTIFACT_NAME}\"" | head -1 | cut -d'"' -f4)
    else
        error "Neither curl nor wget found. Install one and retry."
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
    if command -v curl &>/dev/null; then
        curl -fsSL -o "$dest" "$DOWNLOAD_URL"
    else
        wget -qO "$dest" "$DOWNLOAD_URL"
    fi
    chmod 755 "$dest"
    info "Binary downloaded to $dest"
}

write_default_config() {
    local config_path="$1"
    if [[ -f "$config_path" ]]; then
        info "Config already exists at $config_path, not overwriting."
        return
    fi

    mkdir -p "$(dirname "$config_path")"
    cat > "$config_path" << 'EOF'
# Ironshelf Configuration

[server]
host = "0.0.0.0"
port = 10810

# Add library sources below.
# Each [[library]] entry defines one library.

# Example: Calibre library
# [[library]]
# name = "Main Library"
# source = "calibre"
# path = "/path/to/calibre/library"

# Example: Folder scan
# [[library]]
# name = "Unsorted Books"
# source = "folder"
# path = "/path/to/ebooks"
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
    write_default_config "$config_path"

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
    echo "Running at: http://$(hostname -I | awk '{print $1}'):${DEFAULT_PORT}"
    echo "Config:     ${config_path}"
    echo "Logs:       journalctl -u ${SERVICE_NAME} -f"
    echo ""
    echo "Next steps:"
    echo "  1. Edit ${config_path} to add your library paths"
    echo "  2. Restart after config changes: systemctl restart ironshelf"
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
    write_default_config "$config_path"

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
    echo "  1. Edit ${config_path} to add your library paths"
    echo "  2. Restart after config changes:"
    echo "     launchctl unload ${plist_path} && launchctl load ${plist_path}"
}

# --- Main ---

echo "=== Ironshelf Installer ==="
echo ""

detect_platform
get_latest_release_url

case "$PLATFORM" in
    linux)  install_linux ;;
    darwin) install_macos ;;
esac
