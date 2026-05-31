//! Authentication: session cookies + Bearer API key.
//! First user to register becomes owner.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use sqlx::Row;

use crate::error::AppError;
use crate::state::AppState;

/// Authenticated user context, extracted by middleware.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: String,
    pub username: String,
    pub is_owner: bool,
    /// The session ID used to authenticate this request (None for API key auth).
    pub session_id: Option<String>,
}

/// Hash a password with argon2.
pub fn hash_password(password: &str) -> Result<String, StatusCode> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// Verify password against hash.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// Auth middleware — checks session cookie OR Bearer token.
/// Injects AuthUser into request extensions.
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_user = extract_auth_user(&state, request.headers()).await?;
    request.extensions_mut().insert(auth_user);
    Ok(next.run(request).await)
}

/// Extract authenticated user from request headers.
///
/// Takes `&HeaderMap` (not `&Request`) to avoid borrowing the non-Sync request
/// body across await points, which would make the future non-Send.
async fn extract_auth_user(state: &AppState, headers: &axum::http::HeaderMap) -> Result<AuthUser, StatusCode> {
    let pool = state.ironshelf_db.pool();

    // Try Bearer token first. API keys look like "irs_<prefix>.<secret>"; any
    // other Bearer value is treated as a session id (used by the hosted web UI,
    // which is cross-origin and so can't rely on the session cookie).
    if let Some(auth_header) = headers.get(header::AUTHORIZATION) {
        let auth_str = auth_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;
        if let Some(token) = auth_str.strip_prefix("Bearer ") {
            if token.starts_with("irs_") {
                return validate_api_key(pool, token).await;
            }
            return validate_session(pool, token).await;
        }
    }

    // Try session cookie
    if let Some(cookie_header) = headers.get(header::COOKIE) {
        let cookie_str = cookie_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;
        if let Some(session_id) = extract_session_cookie(cookie_str) {
            return validate_session(pool, &session_id).await;
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}

/// Validate an API key (format: "irs_<prefix>.<secret>").
/// Public within the crate so Kobo sync routes can authenticate via path token.
pub(crate) async fn validate_api_key(pool: &sqlx::SqlitePool, token: &str) -> Result<AuthUser, StatusCode> {
    // Split into prefix + secret
    let token = token.strip_prefix("irs_").ok_or(StatusCode::UNAUTHORIZED)?;
    let (prefix, secret) = token.split_once('.').ok_or(StatusCode::UNAUTHORIZED)?;

    // Look up key by prefix
    let row = sqlx::query(
        "SELECT ak.key_hash, ak.user_id, u.username, u.is_owner \
         FROM api_keys ak JOIN users u ON u.id = ak.user_id \
         WHERE ak.prefix = ?",
    )
    .bind(prefix)
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    let key_hash: String = row.get("key_hash");
    if !verify_password(secret, &key_hash) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(AuthUser {
        user_id: row.get("user_id"),
        username: row.get("username"),
        is_owner: row.get::<i32, _>("is_owner") != 0,
        session_id: None, // API key auth, no session
    })
}

/// Validate a session ID.
async fn validate_session(pool: &sqlx::SqlitePool, session_id: &str) -> Result<AuthUser, StatusCode> {
    let row = sqlx::query(
        "SELECT s.user_id, u.username, u.is_owner, s.expires_at \
         FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.id = ?",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    // Check expiry
    let expires_at: String = row.get("expires_at");
    let expires = chrono::DateTime::parse_from_rfc3339(&expires_at)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if expires < chrono::Utc::now() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(AuthUser {
        user_id: row.get("user_id"),
        username: row.get("username"),
        is_owner: row.get::<i32, _>("is_owner") != 0,
        session_id: Some(session_id.to_string()),
    })
}

/// Extract session ID from cookie header.
fn extract_session_cookie(cookie_str: &str) -> Option<String> {
    cookie_str
        .split(';')
        .map(|s| s.trim())
        .find(|s| s.starts_with("ironshelf_session="))
        .and_then(|s| s.strip_prefix("ironshelf_session="))
        .map(|s| s.to_string())
}

// --- Permission checking helpers ---

/// Require that the authenticated user is the instance owner.
pub fn require_owner(user: &AuthUser) -> Result<(), AppError> {
    if !user.is_owner {
        return Err(AppError::Forbidden("Owner access required".to_string()));
    }
    Ok(())
}

/// Require that the authenticated user has a specific permission (or is owner).
#[allow(dead_code)]
pub async fn require_permission(
    user: &AuthUser,
    permission: &str,
    pool: &sqlx::SqlitePool,
) -> Result<(), AppError> {
    // Owner bypasses all permission checks
    if user.is_owner {
        return Ok(());
    }

    let has_permission = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM permissions WHERE user_id = ? AND permission = ?",
    )
    .bind(&user.user_id)
    .bind(permission)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if has_permission == 0 {
        return Err(AppError::Forbidden(format!(
            "Missing required permission: {}",
            permission
        )));
    }

    Ok(())
}
