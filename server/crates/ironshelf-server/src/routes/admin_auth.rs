//! Owner-only management of DB-driven SSO providers (`auth_providers` table).
//! See `routes/sso.rs` for the login flow and `docs/AUTH-PROVIDERS-DESIGN.md`.

use axum::extract::{Path, State};
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::{require_owner, AuthUser};
use crate::error::AppError;
use crate::routes::sso::{builtin_meta, BUILTIN_PROVIDER_IDS};
use crate::state::AppState;

/// Provider config as returned to the admin UI. The client secret is never
/// echoed back — only whether one is set.
#[derive(Serialize, Clone)]
pub struct AdminProvider {
    pub id: String,
    pub kind: String,
    pub display_name: String,
    pub client_id: String,
    pub has_client_secret: bool,
    pub issuer_url: Option<String>,
    pub authorize_url: Option<String>,
    pub token_url: Option<String>,
    pub userinfo_url: Option<String>,
    pub scopes: Option<String>,
    pub enabled: bool,
    pub auto_register: bool,
    /// True for baked-in providers (Google/GitHub): kind/name/endpoints are
    /// fixed, the owner only edits credentials + enabled/auto-register.
    pub is_builtin: bool,
}

/// GET /api/v1/admin/auth-providers — list all configured providers (owner only).
pub async fn list_auth_providers(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<AdminProvider>>, AppError> {
    require_owner(&auth_user)?;

    let rows = sqlx::query(
        "SELECT id, kind, display_name, client_id, client_secret, issuer_url, \
         authorize_url, token_url, userinfo_url, scopes, enabled, auto_register \
         FROM auth_providers ORDER BY display_name",
    )
    .fetch_all(state.ironshelf_db.pool())
    .await
    .map_err(AppError::internal)?;

    let configured: Vec<AdminProvider> = rows
        .into_iter()
        .map(|row| {
            let secret: Option<String> = row.get("client_secret");
            AdminProvider {
                id: row.get("id"),
                kind: row.get("kind"),
                display_name: row.get("display_name"),
                client_id: row.get("client_id"),
                has_client_secret: secret.as_deref().map(|s| !s.is_empty()).unwrap_or(false),
                issuer_url: row.get("issuer_url"),
                authorize_url: row.get("authorize_url"),
                token_url: row.get("token_url"),
                userinfo_url: row.get("userinfo_url"),
                scopes: row.get("scopes"),
                enabled: row.get::<i64, _>("enabled") != 0,
                auto_register: row.get::<i64, _>("auto_register") != 0,
                is_builtin: false,
            }
        })
        .collect();

    // Built-in providers (Google/GitHub) always appear first, whether or not
    // they've been configured yet, so the owner just fills in credentials.
    let mut result = Vec::new();
    for &builtin_id in BUILTIN_PROVIDER_IDS {
        let (display_name, kind) = builtin_meta(builtin_id).unwrap();
        match configured.iter().find(|provider| provider.id == builtin_id) {
            Some(existing) => {
                let mut provider = existing.clone();
                // Lock the baked-in identity regardless of what's in the row.
                provider.display_name = display_name.to_string();
                provider.kind = kind.to_string();
                provider.is_builtin = true;
                result.push(provider);
            }
            None => result.push(AdminProvider {
                id: builtin_id.to_string(),
                kind: kind.to_string(),
                display_name: display_name.to_string(),
                client_id: String::new(),
                has_client_secret: false,
                issuer_url: None,
                authorize_url: None,
                token_url: None,
                userinfo_url: None,
                scopes: None,
                enabled: false,
                auto_register: true,
                is_builtin: true,
            }),
        }
    }
    // Then any custom (non-built-in) providers, preserving display-name order.
    for provider in configured {
        if builtin_meta(&provider.id).is_none() {
            result.push(provider);
        }
    }

    Ok(Json(result))
}

fn default_true() -> bool {
    true
}

/// Body for creating/updating a provider. Omitting `client_secret` (or sending
/// an empty string) preserves the existing secret on update.
#[derive(Deserialize)]
pub struct UpsertProviderRequest {
    pub kind: String,
    pub display_name: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub issuer_url: Option<String>,
    #[serde(default)]
    pub authorize_url: Option<String>,
    #[serde(default)]
    pub token_url: Option<String>,
    #[serde(default)]
    pub userinfo_url: Option<String>,
    #[serde(default)]
    pub scopes: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub auto_register: bool,
}

/// PUT /api/v1/admin/auth-providers/:id — create or update a provider (owner only).
pub async fn upsert_auth_provider(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(provider_id): Path<String>,
    Json(body): Json<UpsertProviderRequest>,
) -> Result<Json<AdminProvider>, AppError> {
    require_owner(&auth_user)?;

    // Built-in providers have a fixed identity + endpoints; the owner only
    // supplies credentials + toggles. Custom providers use the request body.
    let is_builtin = builtin_meta(&provider_id).is_some();
    let (kind, display_name, issuer_url, authorize_url, token_url, userinfo_url, scopes) =
        if let Some((builtin_name, builtin_kind)) = builtin_meta(&provider_id) {
            // Endpoints/scopes stay NULL → filled from preset at login time.
            (
                builtin_kind.to_string(),
                builtin_name.to_string(),
                None,
                None,
                None,
                None,
                None,
            )
        } else {
            if body.kind != "oidc" && body.kind != "oauth2" {
                return Err(AppError::BadRequest(
                    "kind must be 'oidc' or 'oauth2'".to_string(),
                ));
            }
            (
                body.kind.clone(),
                body.display_name.clone(),
                body.issuer_url.clone(),
                body.authorize_url.clone(),
                body.token_url.clone(),
                body.userinfo_url.clone(),
                body.scopes.clone(),
            )
        };

    let pool = state.ironshelf_db.pool();

    // Preserve existing secret when the request omits it (so the admin doesn't
    // have to re-enter it on every edit).
    let incoming_secret = body
        .client_secret
        .as_deref()
        .filter(|secret| !secret.is_empty())
        .map(|secret| secret.to_string());

    let effective_secret = match incoming_secret {
        Some(secret) => Some(secret),
        None => sqlx::query("SELECT client_secret FROM auth_providers WHERE id = ?")
            .bind(&provider_id)
            .fetch_optional(pool)
            .await
            .map_err(AppError::internal)?
            .and_then(|row| row.get::<Option<String>, _>("client_secret")),
    };

    sqlx::query(
        "INSERT INTO auth_providers \
         (id, kind, display_name, client_id, client_secret, issuer_url, authorize_url, \
          token_url, userinfo_url, scopes, enabled, auto_register) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET \
          kind = excluded.kind, display_name = excluded.display_name, \
          client_id = excluded.client_id, client_secret = excluded.client_secret, \
          issuer_url = excluded.issuer_url, authorize_url = excluded.authorize_url, \
          token_url = excluded.token_url, userinfo_url = excluded.userinfo_url, \
          scopes = excluded.scopes, enabled = excluded.enabled, \
          auto_register = excluded.auto_register",
    )
    .bind(&provider_id)
    .bind(&kind)
    .bind(&display_name)
    .bind(&body.client_id)
    .bind(&effective_secret)
    .bind(&issuer_url)
    .bind(&authorize_url)
    .bind(&token_url)
    .bind(&userinfo_url)
    .bind(&scopes)
    .bind(if body.enabled { 1 } else { 0 })
    .bind(if body.auto_register { 1 } else { 0 })
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(Json(AdminProvider {
        id: provider_id,
        kind,
        display_name,
        client_id: body.client_id,
        has_client_secret: effective_secret.as_deref().map(|s| !s.is_empty()).unwrap_or(false),
        issuer_url,
        authorize_url,
        token_url,
        userinfo_url,
        scopes,
        enabled: body.enabled,
        auto_register: body.auto_register,
        is_builtin,
    }))
}

/// DELETE /api/v1/admin/auth-providers/:id — remove a provider (owner only).
pub async fn delete_auth_provider(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(provider_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_owner(&auth_user)?;

    sqlx::query("DELETE FROM auth_providers WHERE id = ?")
        .bind(&provider_id)
        .execute(state.ironshelf_db.pool())
        .await
        .map_err(AppError::internal)?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}
