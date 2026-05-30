//! User management endpoints (owner / manage_users permission required).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Serialize)]
pub struct UserListEntry {
    pub id: String,
    pub username: String,
    pub is_owner: bool,
    pub created_at: String,
    pub permissions: Vec<String>,
}

#[derive(Deserialize)]
pub struct SetPermissionsRequest {
    pub permissions: Vec<String>,
}

#[derive(Serialize)]
pub struct InviteResponse {
    pub code: String,
    pub created_at: String,
}

/// GET /api/v1/users — list all users with permissions (owner or manage_users)
pub async fn list_users(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<UserListEntry>>, AppError> {
    require_user_management(&current_user, state.ironshelf_db.pool()).await?;

    let pool = state.ironshelf_db.pool();

    let user_rows = sqlx::query("SELECT id, username, is_owner, created_at FROM users ORDER BY created_at")
        .fetch_all(pool)
        .await
        .map_err(AppError::internal)?;

    let mut users: Vec<UserListEntry> = Vec::new();

    for row in &user_rows {
        let user_id: String = row.get("id");

        let permission_rows = sqlx::query("SELECT permission FROM permissions WHERE user_id = ?")
            .bind(&user_id)
            .fetch_all(pool)
            .await
            .map_err(AppError::internal)?;

        let permissions: Vec<String> = permission_rows
            .iter()
            .map(|permission_row| permission_row.get("permission"))
            .collect();

        users.push(UserListEntry {
            id: user_id,
            username: row.get("username"),
            is_owner: row.get::<i32, _>("is_owner") != 0,
            created_at: row.get("created_at"),
            permissions,
        });
    }

    Ok(Json(users))
}

/// DELETE /api/v1/users/{id} — delete a user (owner only, can't delete self)
pub async fn delete_user(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(target_user_id): Path<String>,
) -> Result<StatusCode, AppError> {
    require_owner(&current_user)?;

    if current_user.user_id == target_user_id {
        return Err(AppError::BadRequest(
            "Cannot delete yourself".to_string(),
        ));
    }

    let pool = state.ironshelf_db.pool();

    // Verify target user exists
    let target_exists: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT id FROM users WHERE id = ?")
            .bind(&target_user_id)
            .fetch_optional(pool)
            .await
            .map_err(AppError::internal)?;

    if target_exists.is_none() {
        return Err(AppError::not_found("user"));
    }

    // CASCADE handles sessions, api_keys, permissions, reading_progress, bookmarks, sort_prefs
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&target_user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/v1/users/{id}/permissions — set permissions for a user
pub async fn set_permissions(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(target_user_id): Path<String>,
    Json(request): Json<SetPermissionsRequest>,
) -> Result<StatusCode, AppError> {
    require_user_management(&current_user, state.ironshelf_db.pool()).await?;

    let pool = state.ironshelf_db.pool();

    // Verify target user exists
    let target_row = sqlx::query("SELECT id, is_owner FROM users WHERE id = ?")
        .bind(&target_user_id)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?;

    let target_row = target_row.ok_or_else(|| AppError::not_found("user"))?;

    let target_is_owner: bool = target_row.get::<i32, _>("is_owner") != 0;
    if target_is_owner {
        return Err(AppError::BadRequest(
            "Cannot modify owner permissions".to_string(),
        ));
    }

    // Validate permission strings
    let valid_permissions = ["read", "download", "manage_library", "manage_users"];
    for permission in &request.permissions {
        if !valid_permissions.contains(&permission.as_str()) {
            return Err(AppError::BadRequest(
                format!("Invalid permission: {}", permission),
            ));
        }
    }

    // Replace all permissions: delete existing, insert new
    sqlx::query("DELETE FROM permissions WHERE user_id = ?")
        .bind(&target_user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    for permission in &request.permissions {
        sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, ?)")
            .bind(&target_user_id)
            .bind(permission)
            .execute(pool)
            .await
            .map_err(AppError::internal)?;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/users/invite — create an invite code
pub async fn create_invite(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<(StatusCode, Json<InviteResponse>), AppError> {
    require_user_management(&current_user, state.ironshelf_db.pool()).await?;

    let pool = state.ironshelf_db.pool();

    let invite_code = generate_invite_code();

    sqlx::query("INSERT INTO invites (code, created_by) VALUES (?, ?)")
        .bind(&invite_code)
        .bind(&current_user.user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    let created_at = chrono::Utc::now().to_rfc3339();

    Ok((
        StatusCode::CREATED,
        Json(InviteResponse {
            code: invite_code,
            created_at,
        }),
    ))
}

/// GET /api/v1/users/invites — list pending (unused) invite codes
pub async fn list_invites(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<InviteResponse>>, AppError> {
    require_user_management(&current_user, state.ironshelf_db.pool()).await?;

    let pool = state.ironshelf_db.pool();

    let rows = sqlx::query(
        "SELECT code, created_at FROM invites WHERE used_by IS NULL ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::internal)?;

    let invites = rows
        .iter()
        .map(|row| InviteResponse {
            code: row.get("code"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(Json(invites))
}

// --- helpers ---

/// Require the current user to be the instance owner.
fn require_owner(user: &AuthUser) -> Result<(), AppError> {
    if !user.is_owner {
        return Err(AppError::Forbidden(
            "Owner access required".to_string(),
        ));
    }
    Ok(())
}

/// Require the current user to be owner OR have manage_users permission.
async fn require_user_management(
    user: &AuthUser,
    pool: &sqlx::SqlitePool,
) -> Result<(), AppError> {
    if user.is_owner {
        return Ok(());
    }

    let has_permission = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM permissions WHERE user_id = ? AND permission = 'manage_users'",
    )
    .bind(&user.user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    if has_permission == 0 {
        return Err(AppError::Forbidden(
            "Insufficient permissions".to_string(),
        ));
    }

    Ok(())
}

fn generate_invite_code() -> String {
    use argon2::password_hash::rand_core::OsRng;
    use argon2::password_hash::rand_core::RngCore;

    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>()
}

