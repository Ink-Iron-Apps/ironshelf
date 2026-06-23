//! Owner-only management of DB-driven SSO providers (`auth_providers` table).
//! See `routes/sso.rs` for the login flow and `docs/AUTH-PROVIDERS-DESIGN.md`.

use axum::extract::{Path, State};
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::{require_owner, AuthUser};
use crate::error::AppError;
use crate::state::AppState;

/// Provider config as returned to the admin UI. The client secret is never
/// echoed back — only whether one is set.
#[derive(Serialize)]
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

    let providers = rows
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
            }
        })
        .collect();

    Ok(Json(providers))
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

    if body.kind != "oidc" && body.kind != "oauth2" {
        return Err(AppError::BadRequest(
            "kind must be 'oidc' or 'oauth2'".to_string(),
        ));
    }

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
    .bind(&body.kind)
    .bind(&body.display_name)
    .bind(&body.client_id)
    .bind(&effective_secret)
    .bind(&body.issuer_url)
    .bind(&body.authorize_url)
    .bind(&body.token_url)
    .bind(&body.userinfo_url)
    .bind(&body.scopes)
    .bind(if body.enabled { 1 } else { 0 })
    .bind(if body.auto_register { 1 } else { 0 })
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(Json(AdminProvider {
        id: provider_id,
        kind: body.kind,
        display_name: body.display_name,
        client_id: body.client_id,
        has_client_secret: effective_secret.as_deref().map(|s| !s.is_empty()).unwrap_or(false),
        issuer_url: body.issuer_url,
        authorize_url: body.authorize_url,
        token_url: body.token_url,
        userinfo_url: body.userinfo_url,
        scopes: body.scopes,
        enabled: body.enabled,
        auto_register: body.auto_register,
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
