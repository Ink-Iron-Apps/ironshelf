//! Short-lived, media-only scoped tokens.
//!
//! Cross-origin `<img>` / download requests from the hosted web UI cannot set an
//! `Authorization` header, so the client historically appended the raw session id
//! as `?access_token=<session-id>`. A leaked URL (logs, Referer) therefore leaked a
//! live session usable for any API call.
//!
//! A media token instead encodes only `{user_id}.{exp}` signed with an
//! instance-local HMAC-SHA256 secret. It is short-lived (~15 min) and is ONLY
//! accepted by the cover / file / author-photo handlers — never the general auth
//! middleware — so a leaked media URL can at most fetch media for the window.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::Row;

use crate::auth::AuthUser;
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

/// Token lifetime in seconds (~15 minutes).
pub const MEDIA_TOKEN_TTL_SECS: i64 = 900;

/// cloud_config key holding the HMAC signing secret for media tokens.
const SECRET_CONFIG_KEY: &str = "media_token_secret";

/// Get the media-token signing secret, creating (and persisting) a random one on
/// first use. Returns the raw hex secret string.
async fn get_or_create_secret(state: &AppState) -> Result<String, String> {
    let db = &state.ironshelf_db;

    if let Some(secret) = db
        .get_cloud_config(SECRET_CONFIG_KEY)
        .await
        .map_err(|e| format!("read media_token_secret: {e}"))?
    {
        if !secret.is_empty() {
            return Ok(secret);
        }
    }

    // Generate a 32-byte random secret, hex-encoded.
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let secret = hex::encode(bytes);

    db.set_cloud_config(SECRET_CONFIG_KEY, &secret)
        .await
        .map_err(|e| format!("store media_token_secret: {e}"))?;

    Ok(secret)
}

/// Compute the base64url(no-pad) HMAC-SHA256 signature over `message` with `secret`.
fn sign(secret: &str, message: &str) -> String {
    use base64::Engine;
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(message.as_bytes());
    let signature = mac.finalize().into_bytes();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(signature)
}

/// Mint a media token for `user_id`, valid for `MEDIA_TOKEN_TTL_SECS`.
/// Format: `{user_id}.{exp_unix}.{base64url(sig)}`.
pub async fn mint(state: &AppState, user_id: &str) -> Result<String, String> {
    let secret = get_or_create_secret(state).await?;
    let exp = chrono::Utc::now().timestamp() + MEDIA_TOKEN_TTL_SECS;
    let message = format!("{user_id}.{exp}");
    let signature = sign(&secret, &message);
    Ok(format!("{message}.{signature}"))
}

/// Verify a media token. On success resolves the encoded user and returns an
/// `AuthUser` (looked up by id for current username / is_owner). Returns `None`
/// for any malformed, expired, or invalid-signature token, or unknown user.
///
/// Takes `&AppState` so it can read the secret and resolve the user; performs no
/// borrow of the request body, keeping caller futures `Send`.
pub async fn verify(state: &AppState, token: &str) -> Option<AuthUser> {
    use base64::Engine;

    // Split into user_id . exp . signature. user_id is a UUID (no '.'), so split
    // from the right to isolate signature then exp.
    let (rest, signature_b64) = token.rsplit_once('.')?;
    let (user_id, exp_str) = rest.rsplit_once('.')?;

    if user_id.is_empty() {
        return None;
    }

    let exp: i64 = exp_str.parse().ok()?;
    if chrono::Utc::now().timestamp() > exp {
        return None;
    }

    let secret = get_or_create_secret(state).await.ok()?;

    // Constant-time signature verification via HMAC verify_slice.
    let provided_signature = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(signature_b64)
        .ok()?;
    let message = format!("{user_id}.{exp_str}");
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(message.as_bytes());
    mac.verify_slice(&provided_signature).ok()?;

    // Resolve the user (id -> username / is_owner). A token whose user no longer
    // exists is rejected.
    let row = sqlx::query("SELECT id, username, is_owner FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_optional(state.ironshelf_db.pool())
        .await
        .ok()??;

    Some(AuthUser {
        user_id: row.get("id"),
        username: row.get("username"),
        is_owner: row.get::<i32, _>("is_owner") != 0,
        // Media tokens are not sessions; never expose a session id.
        session_id: None,
    })
}

/// Whether a query token looks like a media token rather than a session id or
/// `irs_` API key. Media tokens are `{uuid}.{digits}.{base64url}` (three
/// dot-separated parts, middle is all digits). Session ids are UUIDs (no '.')
/// and API keys start with `irs_`.
pub fn looks_like_media_token(token: &str) -> bool {
    if token.starts_with("irs_") {
        return false;
    }
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    !parts[0].is_empty()
        && !parts[1].is_empty()
        && parts[1].chars().all(|c| c.is_ascii_digit())
        && !parts[2].is_empty()
}
