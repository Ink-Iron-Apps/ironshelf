//! Cloud authentication routes.
//!
//! These routes allow the Ironshelf server to integrate with the central
//! Ironshelf Cloud service for authentication relay and server claiming.
//!
//! Flow:
//! 1. Server owner claims server via cloud UI, receives claim_token
//! 2. Owner sends claim_token to this server via POST /api/v1/auth/claim
//! 3. Users authenticate via cloud, receive short-lived server_access_token
//! 4. Token is sent to POST /api/v1/auth/cloud-login
//! 5. Server verifies token using stored claim_token, creates local session

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// POST /api/v1/auth/claim — store the claim_token from cloud service
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ClaimRequest {
    pub claim_token: String,
    /// URL of the cloud service (e.g., "https://ironshelf.inknironapps.com")
    pub cloud_service_url: Option<String>,
    /// Server ID assigned by the cloud service
    pub server_id: Option<String>,
}

#[derive(Serialize)]
pub struct ClaimResponse {
    pub claimed: bool,
    pub message: String,
}

pub async fn claim_server(
    State(state): State<AppState>,
    Json(request): Json<ClaimRequest>,
) -> Result<Json<ClaimResponse>, AppError> {
    let claim_token = request.claim_token.trim();
    if claim_token.is_empty() {
        return Err(AppError::BadRequest(
            "claim_token is required".to_string(),
        ));
    }

    // Validate claim_token format — should be a hex string of reasonable length
    if claim_token.len() < 32 || claim_token.len() > 256 {
        return Err(AppError::BadRequest(
            "Invalid claim_token format".to_string(),
        ));
    }

    let ironshelf_db = &state.ironshelf_db;

    // Store the claim token
    ironshelf_db
        .set_cloud_config("claim_token", claim_token)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to store claim token: {e}")))?;

    // Store cloud service URL if provided
    if let Some(cloud_url) = &request.cloud_service_url {
        let trimmed_url = cloud_url.trim();
        if !trimmed_url.is_empty() {
            ironshelf_db
                .set_cloud_config("cloud_service_url", trimmed_url)
                .await
                .map_err(|e| {
                    AppError::Internal(format!("Failed to store cloud service URL: {e}"))
                })?;
        }
    }

    // Store server ID if provided
    if let Some(server_id) = &request.server_id {
        let trimmed_id = server_id.trim();
        if !trimmed_id.is_empty() {
            ironshelf_db
                .set_cloud_config("server_id", trimmed_id)
                .await
                .map_err(|e| {
                    AppError::Internal(format!("Failed to store server ID: {e}"))
                })?;
        }
    }

    tracing::info!("server claimed via cloud service");

    Ok(Json(ClaimResponse {
        claimed: true,
        message: "Server successfully claimed. Cloud login is now enabled.".to_string(),
    }))
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/auth/claim — unclaim the server (owner only)
// ---------------------------------------------------------------------------

pub async fn unclaim_server(
    State(state): State<AppState>,
) -> Result<Json<ClaimResponse>, AppError> {
    let ironshelf_db = &state.ironshelf_db;

    // Delete all cloud config entries
    ironshelf_db
        .delete_cloud_config("claim_token")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to delete claim token: {e}")))?;
    ironshelf_db
        .delete_cloud_config("cloud_service_url")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to delete cloud service URL: {e}")))?;
    ironshelf_db
        .delete_cloud_config("server_id")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to delete server ID: {e}")))?;

    tracing::info!("server unclaimed from cloud service");

    Ok(Json(ClaimResponse {
        claimed: false,
        message: "Server unclaimed. Cloud login is now disabled.".to_string(),
    }))
}

// ---------------------------------------------------------------------------
// GET /api/v1/auth/claim-status — check if server is claimed
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ClaimStatusResponse {
    pub is_claimed: bool,
    pub cloud_service_url: Option<String>,
    pub server_id: Option<String>,
}

pub async fn claim_status(
    State(state): State<AppState>,
) -> Result<Json<ClaimStatusResponse>, AppError> {
    let ironshelf_db = &state.ironshelf_db;

    let claim_token = ironshelf_db
        .get_cloud_config("claim_token")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read cloud config: {e}")))?;

    let cloud_service_url = ironshelf_db
        .get_cloud_config("cloud_service_url")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read cloud config: {e}")))?;

    let server_id = ironshelf_db
        .get_cloud_config("server_id")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read cloud config: {e}")))?;

    Ok(Json(ClaimStatusResponse {
        is_claimed: claim_token.is_some(),
        cloud_service_url,
        server_id,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/cloud-login — validate a cloud access token, create session
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CloudLoginRequest {
    pub cloud_token: String,
}

#[derive(Serialize)]
pub struct CloudLoginResponse {
    pub user_id: String,
    pub username: String,
    pub is_owner: bool,
    pub session_id: String,
}

pub async fn cloud_login(
    State(state): State<AppState>,
    Json(request): Json<CloudLoginRequest>,
) -> Result<Response, AppError> {
    let ironshelf_db = &state.ironshelf_db;
    let pool = ironshelf_db.pool();

    // Get the stored claim_token
    let claim_token = ironshelf_db
        .get_cloud_config("claim_token")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read cloud config: {e}")))?
        .ok_or_else(|| {
            AppError::BadRequest("Server is not claimed — cloud login not available".to_string())
        })?;

    // Decode and verify the JWT token using the claim_token as HMAC-SHA256 key
    let token_payload = verify_cloud_token(&request.cloud_token, &claim_token)
        .await
        .map_err(|error_message| AppError::Unauthorized(error_message))?;

    // Find or create a local user for this cloud user
    let cloud_username = format!("cloud_{}", token_payload.username);
    let existing_user = sqlx::query(
        "SELECT id, username, is_owner FROM users WHERE username = ?",
    )
    .bind(&cloud_username)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("Database error: {e}")))?;

    let (user_id, username, is_owner) = if let Some(row) = existing_user {
        (
            row.get::<String, _>("id"),
            row.get::<String, _>("username"),
            row.get::<bool, _>("is_owner"),
        )
    } else {
        // Auto-create a local user for the cloud user.
        // Cloud users are never owners (the local admin must elevate if needed).
        let new_user_id = uuid::Uuid::new_v4().to_string();
        // Use a random password hash since cloud users authenticate via token, not password.
        let placeholder_hash = format!("cloud_auth_only_{}", uuid::Uuid::new_v4());

        sqlx::query(
            "INSERT INTO users (id, username, password_hash, is_owner) VALUES (?, ?, ?, 0)",
        )
        .bind(&new_user_id)
        .bind(&cloud_username)
        .bind(&placeholder_hash)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create cloud user: {e}")))?;

        tracing::info!(
            username = %cloud_username,
            cloud_user_id = %token_payload.user_id,
            "created local user for cloud login"
        );

        (new_user_id, cloud_username.clone(), false)
    };

    // Create a session for the user
    let session_id = uuid::Uuid::new_v4().to_string();
    let expires_at =
        chrono::Utc::now() + chrono::Duration::days(7);

    sqlx::query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .bind(&session_id)
    .bind(&user_id)
    .bind(expires_at.to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("Failed to create session: {e}")))?;

    // Build response with Set-Cookie header
    let cookie_value = format!(
        "ironshelf_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
        session_id,
        if state.config.tls_enabled { "; Secure" } else { "" },
    );

    let response = (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie_value)],
        Json(CloudLoginResponse {
            user_id,
            username,
            is_owner,
            session_id: session_id.clone(),
        }),
    )
        .into_response();

    Ok(response)
}

// ---------------------------------------------------------------------------
// Cloud token verification (HMAC-SHA256 JWT using claim_token as key)
// ---------------------------------------------------------------------------

#[allow(dead_code)]
struct CloudTokenPayload {
    user_id: String,
    username: String,
    server_id: String,
    permissions: String,
}

/// Verify a cloud access token JWT signed with HMAC-SHA256 using the claim_token.
///
/// Token format: standard JWT with HS256 algorithm.
/// Payload contains: sub (user_id), username, server_id, permissions, iat, exp.
async fn verify_cloud_token(
    token: &str,
    claim_token: &str,
) -> Result<CloudTokenPayload, String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err("Invalid token format".to_string());
    }

    let header_payload = format!("{}.{}", parts[0], parts[1]);

    // Verify HMAC-SHA256 signature using claim_token as key
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(claim_token.as_bytes())
        .map_err(|_| "Failed to create HMAC key".to_string())?;
    mac.update(header_payload.as_bytes());

    let signature_bytes = base64_url_decode(parts[2])
        .map_err(|_| "Invalid signature encoding".to_string())?;
    mac.verify_slice(&signature_bytes)
        .map_err(|_| "Invalid token signature".to_string())?;

    // Decode payload
    let payload_bytes = base64_url_decode(parts[1])
        .map_err(|_| "Invalid payload encoding".to_string())?;
    let payload_str = String::from_utf8(payload_bytes)
        .map_err(|_| "Invalid payload encoding".to_string())?;
    let payload: serde_json::Value = serde_json::from_str(&payload_str)
        .map_err(|_| "Invalid payload JSON".to_string())?;

    // Check expiration
    let now = chrono::Utc::now().timestamp();
    let expiration = payload["exp"]
        .as_i64()
        .ok_or("Token missing expiration")?;
    if now > expiration {
        return Err("Token expired".to_string());
    }

    let user_id = payload["sub"]
        .as_str()
        .ok_or("Token missing sub (user_id)")?
        .to_string();
    let username = payload["username"]
        .as_str()
        .ok_or("Token missing username")?
        .to_string();
    let server_id = payload["server_id"]
        .as_str()
        .ok_or("Token missing server_id")?
        .to_string();
    let permissions = payload["permissions"]
        .as_str()
        .unwrap_or("read")
        .to_string();

    Ok(CloudTokenPayload {
        user_id,
        username,
        server_id,
        permissions,
    })
}

/// Decode a base64url-encoded string to bytes.
fn base64_url_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;

    // Convert base64url to standard base64
    let standard: String = input
        .replace('-', "+")
        .replace('_', "/");

    // Add padding if needed
    let padded = match standard.len() % 4 {
        2 => format!("{standard}=="),
        3 => format!("{standard}="),
        _ => standard,
    };

    base64::engine::general_purpose::STANDARD
        .decode(&padded)
        .map_err(|e| format!("Base64 decode error: {e}"))
}
