use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use totp_rs::{Algorithm, Secret, TOTP};

use crate::auth::{hash_password, verify_password, AuthUser};
use crate::error::AppError;
use crate::routes::login_state::PendingTotp;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    /// Required when at least one user already exists.
    pub invite_code: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub user_id: String,
    pub username: String,
    pub is_owner: bool,
    pub session_id: String,
}

#[derive(Deserialize)]
pub struct CreateApiKeyRequest {
    pub label: String,
}

#[derive(Serialize)]
pub struct ApiKeyResponse {
    /// Full key shown once: "irs_<prefix>.<secret>"
    pub key: String,
    pub prefix: String,
    pub label: String,
}

#[derive(Serialize)]
pub struct ApiKeySummary {
    pub id: String,
    pub prefix: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct TwoFactorLoginRequest {
    pub token: String,
    pub code: String,
}

/// POST /api/v1/auth/register — first user becomes owner
pub async fn register(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), AppError> {
    let pool = state.ironshelf_db.pool();

    // SAFETY: Enforce minimum password length to prevent trivially guessable passwords.
    // Use .chars().count() to count Unicode characters, not bytes.
    let password_char_count = request.password.chars().count();
    if password_char_count < 8 {
        return Err(AppError::BadRequest(
            "Password must be at least 8 characters".to_string(),
        ));
    }

    // SAFETY: Cap password length to prevent argon2 DoS with extremely long inputs.
    if password_char_count > 1024 {
        return Err(AppError::BadRequest(
            "Password must not exceed 1024 characters".to_string(),
        ));
    }

    // SAFETY: Enforce username length limits and character restrictions.
    let trimmed_username = request.username.trim();
    if trimmed_username.is_empty() || trimmed_username.len() > 64 {
        return Err(AppError::BadRequest(
            "Username must be 1-64 characters".to_string(),
        ));
    }

    // Reject control characters (newlines, tabs, null bytes, etc.) in usernames.
    if trimmed_username.chars().any(|character| character.is_control()) {
        return Err(AppError::BadRequest(
            "Username must not contain control characters".to_string(),
        ));
    }

    // Check if any users exist (first = owner)
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .map_err(AppError::internal)?;

    let is_owner = user_count == 0;

    // If users already exist, require a valid invite code
    if !is_owner {
        let invite_code = request.invite_code.as_deref().unwrap_or("");
        if invite_code.is_empty() {
            return Err(AppError::Forbidden(
                "Invite code required".to_string(),
            ));
        }
        // We'll consume the invite after user creation (need user_id)
    }

    // Check username not taken
    let existing: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT id FROM users WHERE username = ?")
            .bind(trimmed_username)
            .fetch_optional(pool)
            .await
            .map_err(AppError::internal)?;

    if existing.is_some() {
        return Err(AppError::Conflict(
            "Username already taken".to_string(),
        ));
    }

    let password_hash = hash_password(&request.password)
        .map_err(|error| AppError::Internal(format!("password hash failed: {error}")))?;

    let user_id = uuid::Uuid::new_v4().to_string();

    sqlx::query("INSERT INTO users (id, username, password_hash, is_owner) VALUES (?, ?, ?, ?)")
        .bind(&user_id)
        .bind(trimmed_username)
        .bind(&password_hash)
        .bind(is_owner as i32)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    // Consume invite code (if not first user)
    if !is_owner {
        let invite_code = request.invite_code.as_deref().unwrap_or("");
        let consumed = sqlx::query(
            "UPDATE invites SET used_by = ?, used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
             WHERE code = ? AND used_by IS NULL",
        )
        .bind(&user_id)
        .bind(invite_code)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

        if consumed.rows_affected() == 0 {
            // Rollback: delete the user we just created
            let _ = sqlx::query("DELETE FROM users WHERE id = ?")
                .bind(&user_id)
                .execute(pool)
                .await;
            return Err(AppError::Forbidden(
                "Invalid or already used invite code".to_string(),
            ));
        }

        // Grant default permissions (read + download) to non-owner users
        let _ = sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, 'read')")
            .bind(&user_id)
            .execute(pool)
            .await;
        let _ = sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, 'download')")
            .bind(&user_id)
            .execute(pool)
            .await;
    }

    // Create session
    let session_id = crate::routes::sso::create_session(pool, &user_id).await
        .map_err(AppError::internal)?;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            user_id,
            username: trimmed_username.to_string(),
            is_owner,
            session_id,
        }),
    ))
}

/// POST /api/v1/auth/login
///
/// Two-step when 2FA is enabled:
///   Step 1 returns {two_factor_required: true, two_factor_token: "<token>"}.
///   Step 2 is POST /api/v1/auth/login/2fa {token, code}.
pub async fn login(
    State(state): State<AppState>,
    request_headers: axum::http::HeaderMap,
    Json(request): Json<LoginRequest>,
) -> Result<Response, AppError> {
    let pool = state.ironshelf_db.pool();

    // 1. Lockout check — before any DB work.
    let (is_locked, retry_after) = state.login_attempt_store.check_locked(&request.username).await;
    if is_locked {
        return Err(AppError::TooManyRequests(retry_after));
    }

    let row = sqlx::query(
        "SELECT id, username, password_hash, is_owner FROM users WHERE username = ?",
    )
    .bind(&request.username)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    let row = match row {
        Some(row) => row,
        None => {
            // Run a dummy hash so a missing username takes the same time as a wrong password.
            let _ = crate::auth::hash_password(&request.password);
            state.login_attempt_store.record_failure(&request.username).await;
            return Err(AppError::Unauthorized("Invalid credentials".to_string()));
        }
    };

    let password_hash: String = row.get("password_hash");
    if !verify_password(&request.password, &password_hash) {
        let (now_locked, locked_retry_after) = state
            .login_attempt_store
            .record_failure(&request.username)
            .await;
        if now_locked {
            return Err(AppError::TooManyRequests(locked_retry_after));
        }
        return Err(AppError::Unauthorized("Invalid credentials".to_string()));
    }

    // Credentials OK — reset lockout counter.
    state.login_attempt_store.record_success(&request.username).await;

    let user_id: String = row.get("id");
    let username: String = row.get("username");
    let is_owner: bool = row.get::<i32, _>("is_owner") != 0;

    // 2. Check whether 2FA is enabled for this user.
    let totp_enabled: bool = sqlx::query_scalar::<_, i32>(
        "SELECT enabled FROM user_totp WHERE user_id = ?",
    )
    .bind(&user_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?
    .map(|enabled| enabled != 0)
    .unwrap_or(false);

    if totp_enabled {
        // Issue a short-lived pending token; don't create a session yet.
        let totp_token = uuid::Uuid::new_v4().to_string();
        state
            .pending_totp_store
            .insert(totp_token.clone(), PendingTotp::new(user_id, username, is_owner))
            .await;

        return Ok((
            StatusCode::OK,
            Json(serde_json::json!({
                "two_factor_required": true,
                "two_factor_token": totp_token,
            })),
        )
            .into_response());
    }

    // No 2FA — create session immediately.
    let session_id = crate::routes::sso::create_session(pool, &user_id).await
        .map_err(AppError::internal)?;

    let body = serde_json::json!({
        "user_id": user_id,
        "username": username,
        "is_owner": is_owner,
        "session_id": session_id,
    });

    let cookie = build_session_cookie(&session_id, &state, &request_headers);

    Ok((
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(body),
    )
        .into_response())
}

/// POST /api/v1/auth/login/2fa
///
/// Step 2 of two-factor login: validate TOTP code (or a recovery code)
/// then create the real session.
pub async fn login_two_factor(
    State(state): State<AppState>,
    request_headers: axum::http::HeaderMap,
    Json(request): Json<TwoFactorLoginRequest>,
) -> Result<Response, AppError> {
    let pool = state.ironshelf_db.pool();

    // Peek attempt count — auto-removes token on MAX_TOTP_ATTEMPTS.
    let attempt = state
        .pending_totp_store
        .increment_attempt(&request.token)
        .await;

    if attempt.is_none() {
        return Err(AppError::Unauthorized(
            "Invalid or expired 2FA token".to_string(),
        ));
    }

    // Consume the token to get user details for verification.
    let pending = state
        .pending_totp_store
        .take(&request.token)
        .await
        .ok_or_else(|| AppError::Unauthorized("Invalid or expired 2FA token".to_string()))?;

    let user_id = &pending.user_id;

    // Try TOTP code first.
    let totp_row = sqlx::query("SELECT secret FROM user_totp WHERE user_id = ? AND enabled = 1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?;

    let mut code_valid = false;

    if let Some(totp_row) = totp_row {
        let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::internal)?;

        let secret_base32: String = totp_row.get("secret");
        let secret_bytes = Secret::Encoded(secret_base32)
            .to_bytes()
            .map_err(|totp_error| AppError::Internal(format!("secret decode: {totp_error}")))?;

        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            secret_bytes,
            Some("Ironshelf".to_string()),
            username,
        )
        .map_err(|totp_error| AppError::Internal(format!("totp init: {totp_error}")))?;

        code_valid = totp.check_current(&request.code).unwrap_or(false);
    }

    // If TOTP failed, try recovery codes.
    if !code_valid {
        let recovery_rows = sqlx::query(
            "SELECT rowid, code_hash FROM user_totp_recovery WHERE user_id = ? AND used = 0",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(AppError::internal)?;

        for recovery_row in &recovery_rows {
            let code_hash: String = recovery_row.get("code_hash");
            if verify_password(&request.code, &code_hash) {
                // Mark this code as used.
                let row_id: i64 = recovery_row.get("rowid");
                sqlx::query(
                    "UPDATE user_totp_recovery SET used = 1 WHERE rowid = ?",
                )
                .bind(row_id)
                .execute(pool)
                .await
                .map_err(AppError::internal)?;
                code_valid = true;
                break;
            }
        }
    }

    if !code_valid {
        // Re-insert so the user can retry with the same token (up to MAX_TOTP_ATTEMPTS).
        // Preserve original created_at so the 5-minute window is not reset on each wrong code.
        state
            .pending_totp_store
            .insert(
                request.token.clone(),
                PendingTotp {
                    user_id: pending.user_id.clone(),
                    username: pending.username.clone(),
                    is_owner: pending.is_owner,
                    created_at: pending.created_at,
                    attempt_count: pending.attempt_count,
                },
            )
            .await;
        return Err(AppError::Unauthorized("Invalid 2FA code".to_string()));
    }

    // Code valid — create session.
    let session_id = crate::routes::sso::create_session(pool, user_id).await
        .map_err(AppError::internal)?;

    let body = serde_json::json!({
        "user_id": pending.user_id,
        "username": pending.username,
        "is_owner": pending.is_owner,
        "session_id": session_id,
    });

    let cookie = build_session_cookie(&session_id, &state, &request_headers);

    Ok((
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(body),
    )
        .into_response())
}

/// POST /api/v1/auth/logout
pub async fn logout(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<StatusCode, AppError> {
    let pool = state.ironshelf_db.pool();

    // Delete only the current session, not all sessions for the user.
    // This preserves sessions on other devices (phone, tablet, etc).
    if let Some(ref current_session_id) = user.session_id {
        sqlx::query("DELETE FROM sessions WHERE id = ? AND user_id = ?")
            .bind(crate::auth::hash_session_id(current_session_id))
            .bind(&user.user_id)
            .execute(pool)
            .await
            .map_err(AppError::internal)?;
    } else {
        // Authenticated via API key — delete all sessions for a clean logout.
        sqlx::query("DELETE FROM sessions WHERE user_id = ?")
            .bind(&user.user_id)
            .execute(pool)
            .await
            .map_err(AppError::internal)?;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/v1/auth/me
pub async fn me(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pool = state.ironshelf_db.pool();

    let permissions = state
        .ironshelf_db
        .get_permissions(&user.user_id)
        .await
        .unwrap_or_default();

    let two_factor_enabled: bool = sqlx::query_scalar::<_, i32>(
        "SELECT enabled FROM user_totp WHERE user_id = ?",
    )
    .bind(&user.user_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None)
    .map(|enabled| enabled != 0)
    .unwrap_or(false);

    // Whether this local user is linked to an Ironshelf Cloud account.
    let cloud_linked = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE id = ? AND oidc_issuer = 'ironshelf-cloud'",
    )
    .bind(&user.user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0)
        > 0;

    Ok(Json(serde_json::json!({
        "user_id": user.user_id,
        "username": user.username,
        "is_owner": user.is_owner,
        "permissions": permissions,
        "two_factor_enabled": two_factor_enabled,
        "cloud_linked": cloud_linked,
    })))
}

/// GET /api/v1/auth/media-token — mint a short-lived, media-only token.
///
/// Cross-origin `<img>` / download requests from the hosted web UI can't set an
/// `Authorization` header. Instead of leaking the raw session id in the URL, the
/// client fetches this scoped token and appends it as `?token=...`. The token is
/// only honoured by the cover / file / author-photo routes.
pub async fn media_token(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    let token = crate::auth::media_token::mint(&state, &user.user_id)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(serde_json::json!({
        "token": token,
        "expires_in": crate::auth::media_token::MEDIA_TOKEN_TTL_SECS,
    })))
}

/// POST /api/v1/auth/api-keys — create new API key
pub async fn create_api_key(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Json(request): Json<CreateApiKeyRequest>,
) -> Result<(StatusCode, Json<ApiKeyResponse>), AppError> {
    let pool = state.ironshelf_db.pool();

    // Generate prefix (8 chars) + secret (32 chars)
    let prefix = generate_random_string(8);
    let secret = generate_random_string(32);
    let full_key = format!("irs_{prefix}.{secret}");

    let secret_hash = hash_password(&secret)
        .map_err(|error| AppError::Internal(format!("key hash failed: {error}")))?;

    let key_id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO api_keys (id, user_id, prefix, key_hash, label) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&key_id)
    .bind(&user.user_id)
    .bind(&prefix)
    .bind(&secret_hash)
    .bind(&request.label)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok((
        StatusCode::CREATED,
        Json(ApiKeyResponse {
            key: full_key,
            prefix,
            label: request.label,
        }),
    ))
}

/// GET /api/v1/auth/api-keys — list user's API keys
pub async fn list_api_keys(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<ApiKeySummary>>, AppError> {
    let pool = state.ironshelf_db.pool();

    let rows = sqlx::query(
        "SELECT id, prefix, label, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(&user.user_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::internal)?;

    let keys = rows
        .iter()
        .map(|row| ApiKeySummary {
            id: row.get("id"),
            prefix: row.get("prefix"),
            label: row.get("label"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(Json(keys))
}

/// DELETE /api/v1/auth/api-keys/:id
pub async fn delete_api_key(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    axum::extract::Path(key_id): axum::extract::Path<String>,
) -> Result<StatusCode, AppError> {
    let pool = state.ironshelf_db.pool();
    let result = sqlx::query("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
        .bind(&key_id)
        .bind(&user.user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found("API key"));
    }

    Ok(StatusCode::NO_CONTENT)
}

// --- helpers ---

fn build_session_cookie(
    session_id: &str,
    state: &AppState,
    request_headers: &axum::http::HeaderMap,
) -> String {
    let is_tls = state.config.tls_enabled
        || request_headers
            .get("x-forwarded-proto")
            .and_then(|value| value.to_str().ok())
            .map(|proto| proto.eq_ignore_ascii_case("https"))
            .unwrap_or(false);

    let secure_suffix = if is_tls { "; Secure" } else { "" };

    format!(
        "ironshelf_session={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800{}",
        session_id, secure_suffix
    )
}

fn generate_random_string(len: usize) -> String {
    use argon2::password_hash::rand_core::OsRng;
    use argon2::password_hash::rand_core::RngCore;

    let mut bytes = vec![0u8; len];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>()
        .chars()
        .take(len)
        .collect()
}
