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

pub mod media_token;

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
    // Allow auth via an `access_token` query param so cross-origin `<img>` /
    // download requests (which can't set an Authorization header) work. Also
    // accept a `token` param, used by the scoped media-token path.
    let query = request.uri().query();
    let query_token = query.and_then(|q| parse_query_param(q, "access_token"));
    let media_query_token = query.and_then(|q| parse_query_param(q, "token"));
    // Capture the request path up front (owned String) so media-token scoping can
    // be checked in the failure branch without borrowing the non-Sync request body
    // across await points (which would make this future non-Send).
    let request_path = request.uri().path().to_string();

    match extract_auth_user(&state, request.headers(), query_token.as_deref()).await {
        Ok(auth_user) => {
            request.extensions_mut().insert(auth_user);
            Ok(next.run(request).await)
        }
        Err(status) => {
            // Scoped media token: ONLY honoured for GET media routes (cover, book
            // file, author photo). A media token can never authenticate a general
            // API call — if standard auth failed and this isn't a media route, the
            // token is ignored. The token may arrive as either `token=` or, for
            // back-compat with the old client, `access_token=`.
            if is_media_route(&request_path) {
                let candidate = media_query_token
                    .as_deref()
                    .or(query_token.as_deref())
                    .filter(|token| media_token::looks_like_media_token(token));
                if let Some(token) = candidate {
                    if let Some(media_user) = media_token::verify(&state, token).await {
                        request.extensions_mut().insert(media_user);
                        return Ok(next.run(request).await);
                    }
                }
            }
            Err(status)
        }
    }
}

/// Whether `path` is one of the GET media routes that may accept a scoped media
/// token (book cover, book file, author photo). Matches the axum route shapes
/// `/api/v1/books/{id}/cover`, `/api/v1/books/{id}/file`,
/// `/api/v1/authors/{id}/photo`.
fn is_media_route(path: &str) -> bool {
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    // ["api","v1","books","{id}","cover"|"file"] or ["api","v1","authors","{id}","photo"]
    if segments.len() != 5 || segments[0] != "api" || segments[1] != "v1" {
        return false;
    }
    matches!(
        (segments[2], segments[4]),
        ("books", "cover") | ("books", "file") | ("authors", "photo")
    )
}

/// Pull a named value out of a URL query string. Tokens (session ids, `irs_` API
/// keys, media tokens) contain no percent-encoded characters, so no decoding.
fn parse_query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        if key == name {
            Some(value.to_string())
        } else {
            None
        }
    })
}

/// Extract authenticated user from request headers.
///
/// Takes `&HeaderMap` (not `&Request`) to avoid borrowing the non-Sync request
/// body across await points, which would make the future non-Send.
async fn extract_auth_user(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    query_token: Option<&str>,
) -> Result<AuthUser, StatusCode> {
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

    // Try the access_token query param (used by cross-origin <img>/downloads).
    if let Some(token) = query_token {
        if token.starts_with("irs_") {
            return validate_api_key(pool, token).await;
        }
        return validate_session(pool, token).await;
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
/// Hash a raw session id for storage/lookup. The raw id is the bearer
/// credential held by the client; only its SHA-256 is kept server-side, so a DB
/// or backup leak doesn't expose usable sessions. (SHA-256 is fine here — session
/// ids are already high-entropy UUIDs, unlike passwords.)
pub fn hash_session_id(session_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(session_id.as_bytes());
    format!("{:x}", hasher.finalize())
}

async fn validate_session(pool: &sqlx::SqlitePool, session_id: &str) -> Result<AuthUser, StatusCode> {
    let hashed = hash_session_id(session_id);
    let row = sqlx::query(
        "SELECT s.user_id, u.username, u.is_owner, s.expires_at \
         FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.id = ?",
    )
    .bind(&hashed)
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
