//! Remote access API endpoints (UPnP port forwarding management).
//!
//! All endpoints are owner-only — regular users cannot modify network config.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::state::AppState;

/// `GET /api/v1/server/remote-access` — return current UPnP status.
pub async fn get_remote_access_status(
    State(application_state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !auth_user.is_owner {
        return Err(StatusCode::FORBIDDEN);
    }

    let upnp_manager = application_state.upnp_manager.read().await;
    let status = upnp_manager.get_status();

    Ok(Json(json!({
        "enabled": status.is_enabled,
        "active": status.is_active,
        "public_url": status.public_url,
        "public_ip": status.public_ip,
        "external_port": status.external_port,
        "internal_port": status.internal_port,
        "error": status.last_error,
    })))
}

#[derive(Deserialize)]
pub struct EnableRemoteAccessRequest {
    #[serde(default)]
    pub external_port: Option<u16>,
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

/// `POST /api/v1/server/remote-access/test` — check if the port mapping is registered.
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
