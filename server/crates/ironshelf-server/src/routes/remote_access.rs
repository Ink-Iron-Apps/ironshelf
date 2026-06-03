//! Remote access API endpoints (UPnP + Cloudflare Tunnel management).
//!
//! All endpoints are owner-only — regular users cannot modify network config.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::state::AppState;
use crate::tunnel::TunnelManager;

/// Auto-install cloudflared for the current platform.
/// Public so cloud_auth can call it during auto-tunnel-on-claim.
pub async fn install_cloudflared_public() -> Result<(), String> {
    install_cloudflared().await
}

async fn install_cloudflared() -> Result<(), String> {
    let result = if cfg!(windows) {
        // Try winget first, fall back to direct download
        let winget_result = tokio::process::Command::new("winget")
            .args(["install", "--id", "Cloudflare.cloudflared", "--accept-source-agreements", "--accept-package-agreements", "--silent"])
            .output()
            .await;

        match winget_result {
            Ok(output) if output.status.success() => Ok(()),
            _ => {
                // Fallback: direct download
                let url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
                let download_path = std::path::PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string()))
                    .join("Ironshelf")
                    .join("cloudflared.exe");

                let response = reqwest::get(url).await.map_err(|e| format!("Download failed: {e}"))?;
                let bytes = response.bytes().await.map_err(|e| format!("Download failed: {e}"))?;
                tokio::fs::write(&download_path, &bytes).await.map_err(|e| format!("Write failed: {e}"))?;
                Ok(())
            }
        }
    } else if cfg!(target_os = "macos") {
        let output = tokio::process::Command::new("brew")
            .args(["install", "cloudflared"])
            .output()
            .await
            .map_err(|e| format!("brew install failed: {e}"))?;
        if output.status.success() { Ok(()) } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    } else {
        // Linux: download binary directly
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" };
        let url = format!("https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}");
        let response = reqwest::get(&url).await.map_err(|e| format!("Download failed: {e}"))?;
        let bytes = response.bytes().await.map_err(|e| format!("Download failed: {e}"))?;
        tokio::fs::write("/usr/local/bin/cloudflared", &bytes).await.map_err(|e| format!("Write failed: {e}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions("/usr/local/bin/cloudflared", std::fs::Permissions::from_mode(0o755));
        }
        Ok(())
    };

    result.map_err(|e| format!("Installation failed: {e}"))
}

/// `GET /api/v1/server/remote-access` — return combined status for UPnP and tunnel.
pub async fn get_remote_access_status(
    State(application_state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !auth_user.is_owner {
        return Err(StatusCode::FORBIDDEN);
    }

    let upnp_manager = application_state.upnp_manager.read().await;
    let upnp_status = upnp_manager.get_status();
    drop(upnp_manager);

    let tunnel_manager = application_state.tunnel_manager.read().await;
    let mut tunnel_status = tunnel_manager.get_status();
    drop(tunnel_manager);

    // Check cloudflared availability asynchronously.
    tunnel_status.is_available = TunnelManager::is_cloudflared_available().await;

    // Determine the active method: live state first, then the persisted choice
    // (DB), falling back to the config-file default.
    let persisted_method = application_state
        .ironshelf_db
        .get_cloud_config("remote_access_method")
        .await
        .ok()
        .flatten()
        .filter(|method| !method.is_empty());
    let active_method: String = if tunnel_status.is_active {
        "tunnel".to_string()
    } else if upnp_status.is_enabled {
        "upnp".to_string()
    } else {
        persisted_method.unwrap_or_else(|| application_state.config.remote_access_method.clone())
    };

    // Build backward-compatible top-level fields from whichever method is active.
    let (is_enabled, is_active, public_url) = if tunnel_status.is_active {
        (true, true, tunnel_status.public_url.clone())
    } else if upnp_status.is_enabled {
        (true, upnp_status.is_active, upnp_status.public_url.clone())
    } else {
        (false, false, None)
    };

    Ok(Json(json!({
        "method": active_method,
        "enabled": is_enabled,
        "active": is_active,
        "public_url": public_url,
        "upnp": {
            "enabled": upnp_status.is_enabled,
            "active": upnp_status.is_active,
            "public_url": upnp_status.public_url,
            "public_ip": upnp_status.public_ip,
            "external_port": upnp_status.external_port,
            "internal_port": upnp_status.internal_port,
            "error": upnp_status.last_error,
        },
        "tunnel": {
            "available": tunnel_status.is_available,
            "active": tunnel_status.is_active,
            "public_url": tunnel_status.public_url,
            "error": tunnel_status.last_error,
        },
    })))
}

#[derive(Deserialize)]
pub struct EnableRemoteAccessRequest {
    #[serde(default)]
    pub external_port: Option<u16>,
}

/// Body for starting a Cloudflare tunnel. With no fields → a quick tunnel
/// (random *.trycloudflare.com). With `token` + `hostname` → a named tunnel
/// (stable hostname configured in the Cloudflare dashboard).
#[derive(Debug, Default, serde::Deserialize)]
pub struct StartTunnelRequest {
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub hostname: Option<String>,
}

/// `POST /api/v1/server/remote-access/enable` — enable UPnP port forwarding.
pub async fn enable_remote_access(
    State(application_state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
    Json(request_body): Json<EnableRemoteAccessRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !auth_user.is_owner {
        return Err(StatusCode::FORBIDDEN);
    }

    let mut upnp_manager = application_state.upnp_manager.write().await;

    // If a different external port was requested, update it first.
    if let Some(requested_port) = request_body.external_port {
        if requested_port != upnp_manager.get_status().external_port {
            // Disable the old mapping before switching ports.
            upnp_manager.disable().await;
            upnp_manager.set_external_port(requested_port);
        }
    }

    match upnp_manager.enable().await {
        Ok(public_url) => {
            let status = upnp_manager.get_status();
            Ok(Json(json!({
                "enabled": status.is_enabled,
                "active": status.is_active,
                "public_url": public_url,
                "public_ip": status.public_ip,
                "external_port": status.external_port,
                "internal_port": status.internal_port,
                "error": null,
            })))
        }
        Err(enable_error) => {
            let status = upnp_manager.get_status();
            Ok(Json(json!({
                "enabled": status.is_enabled,
                "active": false,
                "public_url": null,
                "public_ip": null,
                "external_port": status.external_port,
                "internal_port": status.internal_port,
                "error": enable_error,
            })))
        }
    }
}

/// `POST /api/v1/server/remote-access/disable` — disable UPnP port forwarding.
pub async fn disable_remote_access(
    State(application_state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !auth_user.is_owner {
        return Err(StatusCode::FORBIDDEN);
    }

    let mut upnp_manager = application_state.upnp_manager.write().await;
    upnp_manager.disable().await;

    let status = upnp_manager.get_status();
    Ok(Json(json!({
        "enabled": status.is_enabled,
        "active": status.is_active,
        "public_url": null,
        "public_ip": null,
        "external_port": status.external_port,
        "internal_port": status.internal_port,
        "error": null,
    })))
}

/// `POST /api/v1/server/remote-access/test` — check if the UPnP port mapping is registered.
pub async fn test_remote_access(
    State(application_state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !auth_user.is_owner {
        return Err(StatusCode::FORBIDDEN);
    }

    let upnp_manager = application_state.upnp_manager.read().await;
    let is_reachable = upnp_manager.test_reachability().await;

    Ok(Json(json!({
        "reachable": is_reachable,
    })))
}

// =========================================================================
// Cloudflare Tunnel endpoints
// =========================================================================

/// `POST /api/v1/server/remote-access/tunnel/start` — start the Cloudflare Quick Tunnel.
pub async fn start_tunnel(
    State(application_state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
    body: Option<Json<StartTunnelRequest>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !auth_user.is_owner {
        return Err(StatusCode::FORBIDDEN);
    }

    let request = body.map(|json| json.0).unwrap_or_default();
    // Named tunnel when both a token and a hostname are supplied.
    let named = match (&request.token, &request.hostname) {
        (Some(token), Some(hostname))
            if !token.trim().is_empty() && !hostname.trim().is_empty() =>
        {
            Some((token.trim().to_string(), hostname.trim().to_string()))
        }
        _ => None,
    };

    // Auto-install cloudflared if not available
    if !TunnelManager::is_cloudflared_available().await {
        tracing::info!("cloudflared not found, attempting auto-install...");
        if let Err(install_error) = install_cloudflared().await {
            return Ok(Json(json!({
                "active": false,
                "public_url": null,
                "error": format!("Failed to install cloudflared: {install_error}"),
            })));
        }
    }

    let mut tunnel_manager = application_state.tunnel_manager.write().await;

    let start_result = match &named {
        Some((token, hostname)) => tunnel_manager.start_named(token, hostname).await,
        None => tunnel_manager.start().await,
    };

    match start_result {
        Ok(public_url) => {
            // Persist the choice so the tunnel auto-starts on the next boot.
            let _ = application_state
                .ironshelf_db
                .set_cloud_config("remote_access_method", "tunnel")
                .await;
            // Persist named-tunnel config (or clear it for a quick tunnel).
            if let Some((token, hostname)) = &named {
                let _ = application_state
                    .ironshelf_db
                    .set_cloud_config("tunnel_mode", "named")
                    .await;
                let _ = application_state
                    .ironshelf_db
                    .set_cloud_config("cf_tunnel_token", token)
                    .await;
                let _ = application_state
                    .ironshelf_db
                    .set_cloud_config("cf_tunnel_hostname", hostname)
                    .await;
            } else {
                let _ = application_state
                    .ironshelf_db
                    .set_cloud_config("tunnel_mode", "quick")
                    .await;
            }

            // If the server is claimed, update the cloud URL in the background.
            let cloud_state = application_state.clone();
            let tunnel_url = public_url.clone();
            drop(tunnel_manager);
            tokio::spawn(async move {
                crate::update_cloud_server_url(&cloud_state, &tunnel_url).await;
            });

            Ok(Json(json!({
                "active": true,
                "public_url": public_url,
                "error": null,
            })))
        }
        Err(start_error) => Ok(Json(json!({
            "active": false,
            "public_url": null,
            "error": start_error,
        }))),
    }
}

/// `POST /api/v1/server/remote-access/tunnel/stop` — stop the Cloudflare Quick Tunnel.
/// Body for setting a manually-managed public URL (own tunnel / reverse proxy).
#[derive(Debug, serde::Deserialize)]
pub struct ManualUrlRequest {
    pub url: String,
}

/// `POST /api/v1/server/remote-access/manual-url` — record a public URL the user
/// manages themselves (their own named tunnel, reverse proxy, etc.). Ironshelf
/// does NOT launch anything; it just stores the URL and reports it to the cloud
/// (and the heartbeat keeps it fresh).
pub async fn set_manual_url(
    State(application_state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
    Json(request_body): Json<ManualUrlRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !auth_user.is_owner {
        return Err(StatusCode::FORBIDDEN);
    }

    let trimmed = request_body.url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(Json(json!({ "ok": false, "error": "URL must not be empty" })));
    }
    let normalized = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let _ = application_state
        .ironshelf_db
        .set_cloud_config("remote_access_method", "manual")
        .await;

    // Report to the cloud now; persists public_url so the heartbeat re-sends it.
    crate::update_cloud_server_url(&application_state, &normalized).await;

    Ok(Json(json!({ "ok": true, "public_url": normalized, "error": null })))
}

pub async fn stop_tunnel(
    State(application_state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !auth_user.is_owner {
        return Err(StatusCode::FORBIDDEN);
    }

    let mut tunnel_manager = application_state.tunnel_manager.write().await;
    tunnel_manager.stop().await;
    drop(tunnel_manager);

    let _ = application_state
        .ironshelf_db
        .set_cloud_config("remote_access_method", "none")
        .await;

    Ok(Json(json!({
        "active": false,
        "public_url": null,
        "error": null,
    })))
}
