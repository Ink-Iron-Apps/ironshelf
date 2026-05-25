#!/usr/bin/env bash
set -euo pipefail

# Ironshelf uninstaller for Linux and macOS

SERVICE_NAME="ironshelf"
BINARY_NAME="ironshelf-server"

info() { echo "[INFO] $*"; }
error() { echo "[ERROR] $*" >&2; exit 1; }

confirm_removal() {
    local target="$1"
    read -rp "Remove ${target}? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]]
}

# --- Linux uninstall ---

uninstall_linux() {
    local install_dir="/opt/ironshelf"

    if [[ $EUID -ne 0 ]]; then
        error "Linux uninstallation requires root. Run with sudo."
    fi

    # Stop and disable service
    info "Stopping service..."
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true

    # Remove systemd unit
    if [[ -f /etc/systemd/system/ironshelf.service ]]; then
        info "Removing systemd unit..."
        rm -f /etc/systemd/system/ironshelf.service
        systemctl daemon-reload
    fi

    # Remove binary
    if [[ -f "${install_dir}/${BINARY_NAME}" ]]; then
        info "Removing binary..."
        rm -f "${install_dir}/${BINARY_NAME}"
    fi

    # Ask about config and data
    if [[ -d "$install_dir" ]]; then
        if confirm_removal "config and data directory (${install_dir})"; then
            info "Removing ${install_dir}..."
            rm -rf "$install_dir"
        else
            info "Keeping ${install_dir}"
        fi
    fi

    # Remove user
    if id -u "$SERVICE_NAME" &>/dev/null; then
        if confirm_removal "system user '${SERVICE_NAME}'"; then
            info "Removing user..."
            userdel "$SERVICE_NAME" 2>/dev/null || true
        fi
    fi

    echo ""
    echo "=== Ironshelf Uninstalled (Linux) ==="
}

# --- macOS uninstall ---

uninstall_macos() {
    local binary_path="/usr/local/bin/${BINARY_NAME}"
    local config_dir="${HOME}/.config/ironshelf"
    local plist_label="com.inknironapps.ironshelf"
    local plist_path="${HOME}/Library/LaunchAgents/${plist_label}.plist"
    local log_path="${HOME}/Library/Logs/ironshelf.log"

    # Unload launchd service
    if [[ -f "$plist_path" ]]; then
        info "Unloading launchd service..."
        launchctl unload "$plist_path" 2>/dev/null || true
        info "Removing plist..."
        rm -f "$plist_path"
    fi

    # Remove binary
    if [[ -f "$binary_path" ]]; then
        info "Removing binary..."
        rm -f "$binary_path"
    fi

    # Ask about config
    if [[ -d "$config_dir" ]]; then
        if confirm_removal "config directory (${config_dir})"; then
            info "Removing ${config_dir}..."
            rm -rf "$config_dir"
        fi
    fi

    # Ask about logs
    if [[ -f "$log_path" ]]; then
        if confirm_removal "log file (${log_path})"; then
            rm -f "$log_path"
        fi
    fi

    echo ""
    echo "=== Ironshelf Uninstalled (macOS) ==="
}

# --- Main ---

echo "=== Ironshelf Uninstaller ==="
echo ""

OS="$(uname -s)"
case "$OS" in
    Linux)  uninstall_linux ;;
    Darwin) uninstall_macos ;;
    *)      error "Unsupported OS: $OS" ;;
esac
