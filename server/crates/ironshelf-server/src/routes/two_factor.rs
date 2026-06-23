//! TOTP 2FA management routes (all require an authenticated session).
//!
//! Setup flow:
//!   1. POST /auth/2fa/setup   → generates secret, returns {secret, otpauth_uri, qr_png_base64}
//!   2. POST /auth/2fa/enable  → user enters first code to confirm → enabled=1, returns recovery codes
//!   3. POST /auth/2fa/disable → user enters password → deletes rows

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use sqlx::Row;
use totp_rs::{Algorithm, Secret, TOTP};

use crate::auth::{hash_password, verify_password, AuthUser};
use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_totp(secret_bytes: Vec<u8>, username: &str) -> Result<TOTP, AppError> {
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        Some("Ironshelf".to_string()),
        username.to_string(),
    )
    .map_err(|totp_error| AppError::Internal(format!("totp init failed: {totp_error}")))
}

fn verify_totp_code(totp: &TOTP, code: &str) -> bool {
    totp.check_current(code).unwrap_or(false)
}

fn hash_recovery_code(code: &str) -> Result<String, AppError> {
    hash_password(code)
        .map_err(|hashing_error| AppError::Internal(format!("recovery hash failed: {hashing_error}")))
}

fn generate_recovery_codes() -> Vec<String> {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    (0..10)
        .map(|_| {
            let mut bytes = [0u8; 5];
            OsRng.fill_bytes(&mut bytes);
            // Format as XXXXX-XXXXX (10 hex chars split for readability)
            let hex = hex::encode(bytes);
            format!("{}-{}", &hex[..5], &hex[5..])
        })
        .collect()
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/2fa/setup
// ---------------------------------------------------------------------------

/// Generates a new TOTP secret, stores it (enabled=0), returns QR + secret.
/// Calling again before enable replaces the pending secret.
pub async fn setup_totp(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = state.ironshelf_db.pool();

    let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
        .bind(&user.user_id)
        .fetch_one(pool)
        .await
        .map_err(AppError::internal)?;

    let secret = Secret::generate_secret();
    // Secret::Raw implements Display as base32; to_bytes() returns raw bytes.
    let secret_base32 = secret.to_string();
    let secret_bytes = secret
        .to_bytes()
        .map_err(|totp_error| AppError::Internal(format!("secret bytes failed: {totp_error}")))?;

    let totp = make_totp(secret_bytes, &username)?;
    let otpauth_uri = totp.get_url();
    let qr_base64 = totp
        .get_qr_base64()
        .map_err(|qr_error| AppError::Internal(format!("QR gen failed: {qr_error}")))?;

    // Upsert: replace any existing pending (or even enabled) entry so setup is idempotent.
    sqlx::query(
        "INSERT INTO user_totp (user_id, secret, enabled) VALUES (?, ?, 0)
         ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0",
    )
    .bind(&user.user_id)
    .bind(&secret_base32)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(Json(serde_json::json!({
        "secret": secret_base32,
        "otpauth_uri": otpauth_uri,
        "qr_png_base64": qr_base64,
    })))
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/2fa/enable
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct EnableTotpRequest {
    pub code: String,
}

/// Verifies the first TOTP code, marks 2FA enabled, generates recovery codes.
/// Returns the 10 recovery codes ONCE — user must save them.
pub async fn enable_totp(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Json(request): Json<EnableTotpRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = state.ironshelf_db.pool();

    let row = sqlx::query(
        "SELECT u.username, t.secret FROM users u JOIN user_totp t ON t.user_id = u.id \
         WHERE u.id = ? AND t.enabled = 0",
    )
    .bind(&user.user_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?
    .ok_or_else(|| AppError::BadRequest("No pending 2FA setup found".to_string()))?;

    let username: String = row.get("username");
    let secret_base32: String = row.get("secret");

    let secret_bytes = Secret::Encoded(secret_base32)
        .to_bytes()
        .map_err(|totp_error| AppError::Internal(format!("secret decode failed: {totp_error}")))?;

    let totp = make_totp(secret_bytes, &username)?;

    if !verify_totp_code(&totp, &request.code) {
        return Err(AppError::Unauthorized("Invalid TOTP code".to_string()));
    }

    // Enable 2FA and replace any old recovery codes.
    sqlx::query("UPDATE user_totp SET enabled = 1 WHERE user_id = ?")
        .bind(&user.user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    sqlx::query("DELETE FROM user_totp_recovery WHERE user_id = ?")
        .bind(&user.user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    let plain_codes = generate_recovery_codes();
    for plain_code in &plain_codes {
        let code_hash = hash_recovery_code(plain_code)?;
        sqlx::query(
            "INSERT INTO user_totp_recovery (user_id, code_hash, used) VALUES (?, ?, 0)",
        )
        .bind(&user.user_id)
        .bind(&code_hash)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;
    }

    Ok(Json(serde_json::json!({
        "enabled": true,
        "recovery_codes": plain_codes,
    })))
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/2fa/disable
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct DisableTotpRequest {
    pub password: String,
}

/// Verifies current password, then removes all 2FA data for the user.
pub async fn disable_totp(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Json(request): Json<DisableTotpRequest>,
) -> Result<impl IntoResponse, AppError> {
    let pool = state.ironshelf_db.pool();

    let password_hash: String =
        sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?")
            .bind(&user.user_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::internal)?;

    if !verify_password(&request.password, &password_hash) {
        return Err(AppError::Unauthorized("Invalid password".to_string()));
    }

    sqlx::query("DELETE FROM user_totp WHERE user_id = ?")
        .bind(&user.user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    // Recovery codes deleted by cascade on user_totp_recovery.
    // Explicit delete for clarity in case ON DELETE CASCADE not fully trusted.
    sqlx::query("DELETE FROM user_totp_recovery WHERE user_id = ?")
        .bind(&user.user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}
