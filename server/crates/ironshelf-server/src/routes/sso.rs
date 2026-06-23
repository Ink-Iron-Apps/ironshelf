//! DB-driven multi-provider SSO — Google (OIDC), GitHub (OAuth2), and custom
//! providers configured at runtime by the owner.
//!
//! Complements the legacy file-config OIDC flow in `routes/oidc.rs`, which is
//! left untouched for back-compat. Shared crypto/session helpers are re-used
//! from `oidc.rs` (`pub(crate)`); the provider config lives in the
//! `auth_providers` table and linked identities in `user_identities`.

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::error::AppError;
use crate::routes::oidc::{
    compute_pkce_challenge, create_session, decode_id_token_claims, ensure_unique_username,
    fetch_discovery, generate_random_string,
};
use crate::state::AppState;

const STATE_TTL: Duration = Duration::from_secs(300); // 5 minutes
const MAX_PENDING_ENTRIES: usize = 1000;

/// In-memory store for OAuth/OIDC `state` → pending-auth (provider + PKCE), with TTL.
/// Same discipline as `OidcStateStore`; OAuth2 entries carry no PKCE verifier.
#[derive(Clone, Default)]
pub struct SsoStateStore {
    entries: Arc<RwLock<HashMap<String, PendingAuth>>>,
}

struct PendingAuth {
    provider_id: String,
    pkce_verifier: Option<String>,
    created_at: Instant,
}

impl SsoStateStore {
    pub fn new() -> Self {
        Self::default()
    }

    async fn insert(&self, state: String, provider_id: String, pkce_verifier: Option<String>) {
        let mut entries = self.entries.write().await;
        entries.retain(|_, entry| entry.created_at.elapsed() < STATE_TTL);
        if entries.len() >= MAX_PENDING_ENTRIES {
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
            PendingAuth {
                provider_id,
                pkce_verifier,
                created_at: Instant::now(),
            },
        );
    }

    /// Consume a pending state, returning (provider_id, pkce_verifier) if valid + unexpired.
    async fn take(&self, state: &str) -> Option<(String, Option<String>)> {
        let mut entries = self.entries.write().await;
        entries.retain(|_, entry| entry.created_at.elapsed() < STATE_TTL);
        let entry = entries.remove(state)?;
        if entry.created_at.elapsed() >= STATE_TTL {
            return None;
        }
        Some((entry.provider_id, entry.pkce_verifier))
    }
}

/// A configured login provider (row from `auth_providers`, presets applied).
#[derive(Clone)]
struct Provider {
    id: String,
    kind: String, // "oidc" | "oauth2"
    #[allow(dead_code)]
    display_name: String,
    client_id: String,
    client_secret: Option<String>,
    issuer_url: Option<String>,
    authorize_url: Option<String>,
    token_url: Option<String>,
    userinfo_url: Option<String>,
    scopes: Option<String>,
    auto_register: bool,
}

/// External identity resolved from a provider after callback.
struct Identity {
    subject: String,
    email: Option<String>,
    username: Option<String>,
}

/// Fill in endpoint/scope defaults for known provider slugs so the owner only
/// has to supply client id/secret. Custom providers (unknown slug) get nothing.
fn apply_preset(provider: &mut Provider) {
    match provider.id.as_str() {
        "google" => {
            if provider.issuer_url.is_none() {
                provider.issuer_url = Some("https://accounts.google.com".to_string());
            }
            if provider.scopes.is_none() {
                provider.scopes = Some("openid email profile".to_string());
            }
        }
        "github" => {
            if provider.authorize_url.is_none() {
                provider.authorize_url =
                    Some("https://github.com/login/oauth/authorize".to_string());
            }
            if provider.token_url.is_none() {
                provider.token_url =
                    Some("https://github.com/login/oauth/access_token".to_string());
            }
            if provider.userinfo_url.is_none() {
                provider.userinfo_url = Some("https://api.github.com/user".to_string());
            }
            if provider.scopes.is_none() {
                provider.scopes = Some("read:user user:email".to_string());
            }
        }
        _ => {}
    }
}

/// Load an enabled provider by id, applying presets. 404 if missing/disabled.
async fn load_enabled_provider(state: &AppState, id: &str) -> Result<Provider, AppError> {
    let row = sqlx::query(
        "SELECT id, kind, display_name, client_id, client_secret, issuer_url, \
         authorize_url, token_url, userinfo_url, scopes, auto_register \
         FROM auth_providers WHERE id = ? AND enabled = 1",
    )
    .bind(id)
    .fetch_optional(state.ironshelf_db.pool())
    .await
    .map_err(AppError::internal)?
    .ok_or_else(|| AppError::not_found("auth provider"))?;

    let mut provider = Provider {
        id: row.get("id"),
        kind: row.get("kind"),
        display_name: row.get("display_name"),
        client_id: row.get("client_id"),
        client_secret: row.get("client_secret"),
        issuer_url: row.get("issuer_url"),
        authorize_url: row.get("authorize_url"),
        token_url: row.get("token_url"),
        userinfo_url: row.get("userinfo_url"),
        scopes: row.get("scopes"),
        auto_register: row.get::<i64, _>("auto_register") != 0,
    };
    apply_preset(&mut provider);
    Ok(provider)
}

/// Derive the externally-visible base URL from request headers + TLS config.
/// Prefers `X-Forwarded-Proto`/`X-Forwarded-Host` (reverse proxy), falls back
/// to `Host` and the `tls_enabled` flag.
fn external_base(headers: &HeaderMap, state: &AppState) -> String {
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .map(|proto| proto.split(',').next().unwrap_or(proto).trim().to_string())
        .unwrap_or_else(|| {
            if state.config.tls_enabled {
                "https".to_string()
            } else {
                "http".to_string()
            }
        });

    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|value| value.to_str().ok())
        .map(|host| host.split(',').next().unwrap_or(host).trim().to_string())
        .unwrap_or_else(|| format!("localhost:{}", state.config.port));

    format!("{scheme}://{host}")
}

/// The OAuth redirect/callback URI for a provider. MUST match exactly what the
/// owner registered in the provider's console.
fn callback_uri(headers: &HeaderMap, state: &AppState, provider_id: &str) -> String {
    format!(
        "{}/api/v1/auth/sso/{}/callback",
        external_base(headers, state),
        provider_id
    )
}

// --- Public endpoints ---

/// Summary of an enabled provider for the login screen.
#[derive(Serialize)]
pub struct ProviderSummary {
    pub id: String,
    pub display_name: String,
    pub kind: String,
}

/// GET /api/v1/auth/providers — enabled login providers (for rendering buttons).
pub async fn list_providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProviderSummary>>, AppError> {
    let rows = sqlx::query(
        "SELECT id, display_name, kind FROM auth_providers WHERE enabled = 1 ORDER BY display_name",
    )
    .fetch_all(state.ironshelf_db.pool())
    .await
    .map_err(AppError::internal)?;

    let providers = rows
        .into_iter()
        .map(|row| ProviderSummary {
            id: row.get("id"),
            display_name: row.get("display_name"),
            kind: row.get("kind"),
        })
        .collect();

    Ok(Json(providers))
}

/// GET /api/v1/auth/sso/:provider/login — redirect (302) to the provider.
pub async fn sso_login(
    State(state): State<AppState>,
    request_headers: HeaderMap,
    Path(provider_id): Path<String>,
) -> Result<Response, AppError> {
    let provider = load_enabled_provider(&state, &provider_id).await?;
    let redirect_uri = callback_uri(&request_headers, &state, &provider_id);
    let oauth_state = generate_random_string(32);
    let scopes = provider.scopes.clone().unwrap_or_default();

    let authorization_url = match provider.kind.as_str() {
        "oidc" => {
            let issuer = provider.issuer_url.as_deref().ok_or_else(|| {
                AppError::BadRequest("OIDC provider missing issuer_url".to_string())
            })?;
            let discovery = fetch_discovery(&state.http_client, issuer).await?;
            let pkce_verifier = generate_random_string(64);
            let pkce_challenge = compute_pkce_challenge(&pkce_verifier);
            state
                .sso_state_store
                .insert(oauth_state.clone(), provider_id.clone(), Some(pkce_verifier))
                .await;
            format!(
                "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
                discovery.authorization_endpoint,
                urlencoding::encode(&provider.client_id),
                urlencoding::encode(&redirect_uri),
                urlencoding::encode(&scopes),
                urlencoding::encode(&oauth_state),
                urlencoding::encode(&pkce_challenge),
            )
        }
        "oauth2" => {
            let authorize = provider.authorize_url.as_deref().ok_or_else(|| {
                AppError::BadRequest("OAuth2 provider missing authorize_url".to_string())
            })?;
            state
                .sso_state_store
                .insert(oauth_state.clone(), provider_id.clone(), None)
                .await;
            format!(
                "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
                authorize,
                urlencoding::encode(&provider.client_id),
                urlencoding::encode(&redirect_uri),
                urlencoding::encode(&scopes),
                urlencoding::encode(&oauth_state),
            )
        }
        other => {
            return Err(AppError::BadRequest(format!(
                "Unknown provider kind '{other}'"
            )))
        }
    };

    Ok((
        StatusCode::FOUND,
        [(header::LOCATION, authorization_url)],
    )
        .into_response())
}

#[derive(Deserialize)]
pub struct SsoCallbackParams {
    code: String,
    state: String,
}

/// GET /api/v1/auth/sso/:provider/callback — exchange code, sign in, redirect.
pub async fn sso_callback(
    State(state): State<AppState>,
    request_headers: HeaderMap,
    Path(provider_id): Path<String>,
    Query(params): Query<SsoCallbackParams>,
) -> Result<Response, AppError> {
    // Validate state (CSRF) and recover provider + PKCE verifier.
    let (stored_provider, pkce_verifier) = state
        .sso_state_store
        .take(&params.state)
        .await
        .ok_or_else(|| AppError::BadRequest("Invalid or expired OAuth state".to_string()))?;

    if stored_provider != provider_id {
        return Err(AppError::BadRequest(
            "OAuth state/provider mismatch".to_string(),
        ));
    }

    let provider = load_enabled_provider(&state, &provider_id).await?;
    let redirect_uri = callback_uri(&request_headers, &state, &provider_id);

    let identity = match provider.kind.as_str() {
        "oidc" => resolve_oidc_identity(&state, &provider, &params.code, &redirect_uri, pkce_verifier).await?,
        "oauth2" => resolve_oauth2_identity(&state, &provider, &params.code, &redirect_uri).await?,
        other => {
            return Err(AppError::BadRequest(format!(
                "Unknown provider kind '{other}'"
            )))
        }
    };

    let (user_id, _username) = find_or_create_identity(&state, &provider, &identity).await?;

    let pool = state.ironshelf_db.pool();
    let session_id = create_session(pool, &user_id)
        .await
        .map_err(AppError::internal)?;

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

    Ok((
        StatusCode::FOUND,
        [
            (header::SET_COOKIE, cookie),
            (header::LOCATION, "/#/".to_string()),
        ],
    )
        .into_response())
}

// --- Identity resolution ---

/// Token endpoint response (OIDC returns id_token; OAuth2 returns access_token).
#[derive(Deserialize)]
struct TokenResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

async fn exchange_code(
    state: &AppState,
    token_url: &str,
    code: &str,
    client_id: &str,
    client_secret: Option<&str>,
    redirect_uri: &str,
    pkce_verifier: Option<&str>,
) -> Result<TokenResponse, AppError> {
    let mut form_params = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
    ];
    let secret_owned;
    if let Some(secret) = client_secret {
        secret_owned = secret.to_string();
        form_params.push(("client_secret", &secret_owned));
    }
    if let Some(verifier) = pkce_verifier {
        form_params.push(("code_verifier", verifier));
    }

    let response = state
        .http_client
        .post(token_url)
        // GitHub returns form-encoded unless JSON is explicitly requested; OIDC
        // providers already return JSON, so this header is safe for both.
        .header(header::ACCEPT, "application/json")
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

async fn resolve_oidc_identity(
    state: &AppState,
    provider: &Provider,
    code: &str,
    redirect_uri: &str,
    pkce_verifier: Option<String>,
) -> Result<Identity, AppError> {
    let issuer = provider
        .issuer_url
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("OIDC provider missing issuer_url".to_string()))?;
    let discovery = fetch_discovery(&state.http_client, issuer).await?;

    let token_response = exchange_code(
        state,
        &discovery.token_endpoint,
        code,
        &provider.client_id,
        provider.client_secret.as_deref(),
        redirect_uri,
        pkce_verifier.as_deref(),
    )
    .await?;

    let id_token = token_response
        .id_token
        .ok_or_else(|| AppError::Internal("Provider did not return an id_token".to_string()))?;
    let claims = decode_id_token_claims(&id_token)?;

    Ok(Identity {
        subject: claims.sub,
        email: claims.email,
        username: claims.preferred_username,
    })
}

async fn resolve_oauth2_identity(
    state: &AppState,
    provider: &Provider,
    code: &str,
    redirect_uri: &str,
) -> Result<Identity, AppError> {
    let token_url = provider
        .token_url
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("OAuth2 provider missing token_url".to_string()))?;
    let userinfo_url = provider
        .userinfo_url
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("OAuth2 provider missing userinfo_url".to_string()))?;

    let token_response = exchange_code(
        state,
        token_url,
        code,
        &provider.client_id,
        provider.client_secret.as_deref(),
        redirect_uri,
        None,
    )
    .await?;

    let access_token = token_response
        .access_token
        .ok_or_else(|| AppError::Internal("Provider did not return an access_token".to_string()))?;

    let response = state
        .http_client
        .get(userinfo_url)
        .header(header::AUTHORIZATION, format!("Bearer {access_token}"))
        .header(header::ACCEPT, "application/json")
        // GitHub (and good API etiquette) requires a User-Agent.
        .header(header::USER_AGENT, "ironshelf")
        .send()
        .await
        .map_err(|error| AppError::Internal(format!("Userinfo request failed: {error}")))?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(AppError::Internal(format!(
            "Userinfo request returned status {status}"
        )));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| AppError::Internal(format!("Failed to parse userinfo: {error}")))?;

    // Subject: prefer `id` (GitHub numeric) then `sub` (generic OIDC-like).
    let subject = json_to_string(body.get("id"))
        .or_else(|| json_to_string(body.get("sub")))
        .ok_or_else(|| AppError::Internal("Userinfo missing id/sub".to_string()))?;

    let username = body
        .get("login")
        .or_else(|| body.get("preferred_username"))
        .or_else(|| body.get("username"))
        .or_else(|| body.get("name"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let mut email = body
        .get("email")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    // GitHub often returns a null top-level email; fetch the primary verified one.
    if email.is_none() && provider.id == "github" {
        email = fetch_github_primary_email(state, userinfo_url, &access_token).await;
    }

    Ok(Identity {
        subject,
        email,
        username,
    })
}

/// GitHub-specific: GET /user/emails and pick the primary, verified address.
async fn fetch_github_primary_email(
    state: &AppState,
    userinfo_url: &str,
    access_token: &str,
) -> Option<String> {
    let emails_url = format!("{}/emails", userinfo_url.trim_end_matches('/'));
    let response = state
        .http_client
        .get(&emails_url)
        .header(header::AUTHORIZATION, format!("Bearer {access_token}"))
        .header(header::ACCEPT, "application/json")
        .header(header::USER_AGENT, "ironshelf")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let emails: Vec<serde_json::Value> = response.json().await.ok()?;
    emails
        .iter()
        .find(|entry| {
            entry.get("primary").and_then(|v| v.as_bool()).unwrap_or(false)
                && entry.get("verified").and_then(|v| v.as_bool()).unwrap_or(false)
        })
        .or_else(|| emails.first())
        .and_then(|entry| entry.get("email").and_then(|v| v.as_str()))
        .map(|value| value.to_string())
}

/// Stringify a JSON value that may be a number or a string (provider ids vary).
fn json_to_string(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        Some(serde_json::Value::String(string)) => Some(string.clone()),
        Some(serde_json::Value::Number(number)) => Some(number.to_string()),
        _ => None,
    }
}

/// Find the local user linked to (provider, subject), or auto-register one.
async fn find_or_create_identity(
    state: &AppState,
    provider: &Provider,
    identity: &Identity,
) -> Result<(String, String), AppError> {
    let pool = state.ironshelf_db.pool();

    // Existing linked identity?
    let existing = sqlx::query(
        "SELECT u.id AS id, u.username AS username \
         FROM user_identities ui JOIN users u ON u.id = ui.user_id \
         WHERE ui.provider_id = ? AND ui.subject = ?",
    )
    .bind(&provider.id)
    .bind(&identity.subject)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    if let Some(row) = existing {
        return Ok((row.get("id"), row.get("username")));
    }

    if !provider.auto_register {
        return Err(AppError::Forbidden(
            "No linked account found and auto-registration is disabled for this provider"
                .to_string(),
        ));
    }

    // Username preference: provider username → email → subject.
    let username_base = identity
        .username
        .as_deref()
        .or(identity.email.as_deref())
        .unwrap_or(&identity.subject)
        .to_string();
    let final_username = ensure_unique_username(pool, &username_base).await?;

    let user_id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO users (id, username, password_hash, is_owner) VALUES (?, ?, '', 0)",
    )
    .bind(&user_id)
    .bind(&final_username)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    sqlx::query(
        "INSERT INTO user_identities (provider_id, subject, user_id, email) VALUES (?, ?, ?, ?)",
    )
    .bind(&provider.id)
    .bind(&identity.subject)
    .bind(&user_id)
    .bind(&identity.email)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    // Default permissions (mirror legacy OIDC auto-register).
    let _ = sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, 'read')")
        .bind(&user_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, 'download')")
        .bind(&user_id)
        .execute(pool)
        .await;

    tracing::info!(
        "auto-registered SSO user '{}' (provider={}, subject={})",
        final_username,
        provider.id,
        identity.subject
    );

    Ok((user_id, final_username))
}
