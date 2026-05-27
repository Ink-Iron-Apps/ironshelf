//! OIDC/SSO login flow — authorization code + PKCE.
//! Supports any OpenID Connect provider (Authelia, Authentik, Keycloak, Google, etc).

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::config::OidcConfig;
use crate::error::AppError;
use crate::state::AppState;

/// In-memory store for OIDC state + PKCE verifier pairs (with TTL).
/// Cleaned up lazily on access. Production-safe for single-instance deployments.
#[derive(Clone)]
pub struct OidcStateStore {
    entries: Arc<RwLock<HashMap<String, OidcPendingAuth>>>,
}

struct OidcPendingAuth {
    pkce_verifier: String,
    created_at: Instant,
}

const STATE_TTL: Duration = Duration::from_secs(300); // 5 minutes

impl Default for OidcStateStore {
    fn default() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl OidcStateStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Maximum number of pending OIDC flows stored in memory at once.
    /// Prevents unbounded growth from incomplete authorization flows.
    const MAX_PENDING_ENTRIES: usize = 1000;

    async fn insert(&self, state: String, pkce_verifier: String) {
        let mut entries = self.entries.write().await;
        // Lazy cleanup of expired entries
        entries.retain(|_, entry| entry.created_at.elapsed() < STATE_TTL);
        // Cap total entries to prevent memory exhaustion from abandoned flows.
        if entries.len() >= Self::MAX_PENDING_ENTRIES {
            // Evict the oldest entry to make room.
            if let Some(oldest_key) = entries
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(key, _)| key.clone())
            {
                entries.remove(&oldest_key);
            }
        }
        entries.insert(
            state,
            OidcPendingAuth {
                pkce_verifier,
                created_at: Instant::now(),
            },
        );
    }

    async fn take(&self, state: &str) -> Option<String> {
        let mut entries = self.entries.write().await;
        // Lazy cleanup of expired entries on every access path.
        entries.retain(|_, entry| entry.created_at.elapsed() < STATE_TTL);
        let entry = entries.remove(state)?;
        if entry.created_at.elapsed() >= STATE_TTL {
            return None; // expired (race between retain and remove)
        }
        Some(entry.pkce_verifier)
    }
}

/// Cached OIDC discovery document endpoints.
#[derive(Debug, Clone, Deserialize)]
struct OidcDiscovery {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default, rename = "userinfo_endpoint")]
    _userinfo_endpoint: Option<String>,
}

/// Token response from the provider.
#[derive(Debug, Deserialize)]
struct TokenResponse {
    #[serde(rename = "access_token")]
    _access_token: String,
    id_token: Option<String>,
    #[serde(default, rename = "token_type")]
    _token_type: String,
}

/// Claims extracted from the ID token JWT payload.
#[derive(Debug, Deserialize)]
struct IdTokenClaims {
    sub: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    preferred_username: Option<String>,
    #[serde(default)]
    _name: Option<String>,
}

#[derive(Deserialize)]
pub struct OidcCallbackParams {
    code: String,
    state: String,
}

/// GET /api/v1/auth/oidc/login — returns redirect URL to identity provider.
pub async fn oidc_login(
    State(state): State<AppState>,
) -> Result<Response, AppError> {
    let oidc_config = get_oidc_config(&state)?;
    let discovery = fetch_discovery(&state.http_client, &oidc_config.issuer_url).await?;

    // Generate PKCE challenge (S256)
    let pkce_verifier = generate_random_string(64);
    let pkce_challenge = compute_pkce_challenge(&pkce_verifier);

    // Generate state parameter
    let oauth_state = generate_random_string(32);

    // Store state → verifier mapping
    state.oidc_state_store.insert(oauth_state.clone(), pkce_verifier).await;

    // Build authorization URL
    let scopes = oidc_config.scopes.join(" ");
    let mut authorization_url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        discovery.authorization_endpoint,
        urlencoding::encode(&oidc_config.client_id),
        urlencoding::encode(&oidc_config.redirect_uri),
        urlencoding::encode(&scopes),
        urlencoding::encode(&oauth_state),
        urlencoding::encode(&pkce_challenge),
    );

    // Add nonce for extra security
    let nonce = generate_random_string(32);
    authorization_url.push_str(&format!("&nonce={}", urlencoding::encode(&nonce)));

    let body = serde_json::json!({ "redirect_url": authorization_url });
    Ok(Json(body).into_response())
}

/// GET /api/v1/auth/oidc/callback — handles callback from identity provider.
pub async fn oidc_callback(
    State(state): State<AppState>,
    request_headers: HeaderMap,
    Query(params): Query<OidcCallbackParams>,
) -> Result<Response, AppError> {
    let oidc_config = get_oidc_config(&state)?;

    // Validate state and retrieve PKCE verifier
    let pkce_verifier = state
        .oidc_state_store
        .take(&params.state)
        .await
        .ok_or_else(|| AppError::BadRequest("Invalid or expired OAuth state".to_string()))?;

    // Fetch discovery for token endpoint
    let discovery = fetch_discovery(&state.http_client, &oidc_config.issuer_url).await?;

    // Exchange authorization code for tokens
    let token_response = exchange_code(
        &state.http_client,
        &discovery.token_endpoint,
        &params.code,
        &oidc_config.client_id,
        oidc_config.client_secret.as_deref(),
        &oidc_config.redirect_uri,
        &pkce_verifier,
    )
    .await?;

    // Extract claims from ID token
    let id_token = token_response
        .id_token
        .ok_or_else(|| AppError::Internal("Provider did not return an id_token".to_string()))?;

    let claims = decode_id_token_claims(&id_token)?;

    // Find or create user
    let pool = state.ironshelf_db.pool();
    let user_row = find_or_create_oidc_user(
        pool,
        &oidc_config,
        &claims,
    )
    .await?;

    let user_id: String = user_row.0;
    let _username: String = user_row.1;

    // Create session
    let session_id = create_session(pool, &user_id).await.map_err(AppError::internal)?;

    // Detect TLS via config flag or X-Forwarded-Proto header from reverse proxy.
    // This matches the same logic used in the regular login route.
    let is_tls = state.config.tls_enabled
        || request_headers
            .get("x-forwarded-proto")
            .and_then(|value| value.to_str().ok())
            .map(|proto| proto.eq_ignore_ascii_case("https"))
            .unwrap_or(false);

    let secure_suffix = if is_tls { "; Secure" } else { "" };

    let cookie = format!(
        "ironshelf_session={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800{}",
        session_id, secure_suffix
    );

    let response = (
        StatusCode::FOUND,
        [
            (header::SET_COOKIE, cookie),
            (header::LOCATION, "/#/".to_string()),
        ],
    )
        .into_response();

    Ok(response)
}

// --- Internal helpers ---

fn get_oidc_config(state: &AppState) -> Result<&OidcConfig, AppError> {
    state
        .config
        .oidc
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("OIDC is not configured on this server".to_string()))
}

async fn fetch_discovery(http_client: &reqwest::Client, issuer_url: &str) -> Result<OidcDiscovery, AppError> {
    let discovery_url = format!(
        "{}/.well-known/openid-configuration",
        issuer_url.trim_end_matches('/')
    );

    let response = http_client
        .get(&discovery_url)
        .send()
        .await
        .map_err(|error| AppError::Internal(format!("Failed to fetch OIDC discovery: {error}")))?;

    if !response.status().is_success() {
        return Err(AppError::Internal(format!(
            "OIDC discovery returned status {}",
            response.status()
        )));
    }

    response
        .json::<OidcDiscovery>()
        .await
        .map_err(|error| AppError::Internal(format!("Failed to parse OIDC discovery: {error}")))
}

async fn exchange_code(
    http_client: &reqwest::Client,
    token_endpoint: &str,
    code: &str,
    client_id: &str,
    client_secret: Option<&str>,
    redirect_uri: &str,
    pkce_verifier: &str,
) -> Result<TokenResponse, AppError> {

    let mut form_params = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("code_verifier", pkce_verifier),
    ];

    // client_secret is optional (public clients with PKCE don't need it)
    let secret_string;
    if let Some(secret) = client_secret {
        secret_string = secret.to_string();
        form_params.push(("client_secret", &secret_string));
    }

    let response = http_client
        .post(token_endpoint)
        .form(&form_params)
        .send()
        .await
        .map_err(|error| AppError::Internal(format!("Token exchange request failed: {error}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "Token exchange failed with status {status}: {body}"
        )));
    }

    response
        .json::<TokenResponse>()
        .await
        .map_err(|error| AppError::Internal(format!("Failed to parse token response: {error}")))
}

/// Decode the JWT ID token payload without full signature verification.
/// For self-hosted trust model this is acceptable — the token came directly from
/// the provider over HTTPS. If signature verification is desired, use `jsonwebtoken`
/// with the provider's JWKS.
fn decode_id_token_claims(id_token: &str) -> Result<IdTokenClaims, AppError> {
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        return Err(AppError::Internal("Invalid JWT format in id_token".to_string()));
    }

    // Decode payload (second segment)
    let payload_bytes = base64_url_decode(parts[1])
        .map_err(|error| AppError::Internal(format!("Failed to decode JWT payload: {error}")))?;

    serde_json::from_slice::<IdTokenClaims>(&payload_bytes)
        .map_err(|error| AppError::Internal(format!("Failed to parse ID token claims: {error}")))
}

fn base64_url_decode(input: &str) -> Result<Vec<u8>, String> {
    // Base64url: replace - with +, _ with /, pad with =
    let mut encoded = input.replace('-', "+").replace('_', "/");
    let padding = (4 - encoded.len() % 4) % 4;
    for _ in 0..padding {
        encoded.push('=');
    }

    // Manual base64 decode using a simple lookup
    base64_decode_standard(&encoded)
}

fn base64_decode_standard(input: &str) -> Result<Vec<u8>, String> {
    // Standard base64 alphabet
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut output = Vec::new();
    let bytes: Vec<u8> = input
        .bytes()
        .filter(|&byte| byte != b'=')
        .collect();

    let mut buffer: u32 = 0;
    let mut bits_collected = 0;

    for byte in bytes {
        let value = ALPHABET
            .iter()
            .position(|&alphabet_byte| alphabet_byte == byte)
            .ok_or_else(|| format!("Invalid base64 character: {}", byte as char))?
            as u32;

        buffer = (buffer << 6) | value;
        bits_collected += 6;

        if bits_collected >= 8 {
            bits_collected -= 8;
            output.push((buffer >> bits_collected) as u8);
            buffer &= (1 << bits_collected) - 1;
        }
    }

    Ok(output)
}

async fn find_or_create_oidc_user(
    pool: &sqlx::SqlitePool,
    oidc_config: &OidcConfig,
    claims: &IdTokenClaims,
) -> Result<(String, String), AppError> {
    let issuer = &oidc_config.issuer_url;

    // Try to find existing user by OIDC subject + issuer
    let existing = sqlx::query(
        "SELECT id, username FROM users WHERE oidc_issuer = ? AND oidc_subject = ?",
    )
    .bind(issuer)
    .bind(&claims.sub)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    if let Some(row) = existing {
        let user_id: String = row.get("id");
        let username: String = row.get("username");
        return Ok((user_id, username));
    }

    // User not found — check if auto_register is enabled
    if !oidc_config.auto_register {
        return Err(AppError::Forbidden(
            "No linked account found and auto-registration is disabled".to_string(),
        ));
    }

    // Determine username from claims (prefer preferred_username > email > sub)
    let username = claims
        .preferred_username
        .as_deref()
        .or(claims.email.as_deref())
        .unwrap_or(&claims.sub)
        .to_string();

    // Ensure username uniqueness by appending suffix if needed
    let final_username = ensure_unique_username(pool, &username).await?;

    let user_id = uuid::Uuid::new_v4().to_string();

    // Create user with OIDC fields, no password hash (SSO-only user)
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, is_owner, oidc_subject, oidc_issuer) \
         VALUES (?, ?, '', 0, ?, ?)",
    )
    .bind(&user_id)
    .bind(&final_username)
    .bind(&claims.sub)
    .bind(issuer)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    // Grant default permissions (read + download)
    let _ = sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, 'read')")
        .bind(&user_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, 'download')")
        .bind(&user_id)
        .execute(pool)
        .await;

    tracing::info!(
        "auto-registered OIDC user '{}' (sub={}, issuer={})",
        final_username,
        claims.sub,
        issuer
    );

    Ok((user_id, final_username))
}

async fn ensure_unique_username(
    pool: &sqlx::SqlitePool,
    base_username: &str,
) -> Result<String, AppError> {
    let existing: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT id FROM users WHERE username = ?")
            .bind(base_username)
            .fetch_optional(pool)
            .await
            .map_err(AppError::internal)?;

    if existing.is_none() {
        return Ok(base_username.to_string());
    }

    // Append numeric suffix
    for suffix in 2..100 {
        let candidate = format!("{base_username}{suffix}");
        let exists: Option<sqlx::sqlite::SqliteRow> =
            sqlx::query("SELECT id FROM users WHERE username = ?")
                .bind(&candidate)
                .fetch_optional(pool)
                .await
                .map_err(AppError::internal)?;

        if exists.is_none() {
            return Ok(candidate);
        }
    }

    Err(AppError::Internal(
        "Could not generate unique username".to_string(),
    ))
}

async fn create_session(pool: &sqlx::SqlitePool, user_id: &str) -> Result<String, sqlx::Error> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(7)).to_rfc3339();

    sqlx::query("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(&session_id)
        .bind(user_id)
        .bind(&expires_at)
        .execute(pool)
        .await?;

    Ok(session_id)
}

fn generate_random_string(length: usize) -> String {
    use argon2::password_hash::rand_core::OsRng;
    use argon2::password_hash::rand_core::RngCore;

    let mut bytes = vec![0u8; length];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>()
        .chars()
        .take(length)
        .collect()
}

fn compute_pkce_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};

    let hash = Sha256::digest(verifier.as_bytes());
    base64_url_encode(&hash)
}

fn base64_url_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut output = String::new();
    let mut buffer: u32 = 0;
    let mut bits_in_buffer = 0;

    for &byte in input {
        buffer = (buffer << 8) | byte as u32;
        bits_in_buffer += 8;

        while bits_in_buffer >= 6 {
            bits_in_buffer -= 6;
            let index = ((buffer >> bits_in_buffer) & 0x3F) as usize;
            output.push(ALPHABET[index] as char);
        }
    }

    if bits_in_buffer > 0 {
        buffer <<= 6 - bits_in_buffer;
        let index = (buffer & 0x3F) as usize;
        output.push(ALPHABET[index] as char);
    }

    // Convert to base64url (no padding, URL-safe chars)
    output.replace('+', "-").replace('/', "_").trim_end_matches('=').to_string()
}
