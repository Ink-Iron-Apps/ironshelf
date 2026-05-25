//! User management endpoints (owner / manage_users permission required).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::AuthUser;
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
) -> Result<Json<Vec<UserListEntry>>, (StatusCode, Json<serde_json::Value>)> {
    require_user_management(&current_user, state.ironshelf_db.pool()).await?;

    let pool = state.ironshelf_db.pool();

    let user_rows = sqlx::query("SELECT id, username, is_owner, created_at FROM users ORDER BY created_at")
        .fetch_all(pool)
        .await
        .map_err(|_| internal_error("db_error"))?;

    let mut users: Vec<UserListEntry> = Vec::new();

    for row in &user_rows {
        let user_id: String = row.get("id");

        let permission_rows = sqlx::query("SELECT permission FROM permissions WHERE user_id = ?")
            .bind(&user_id)
            .fetch_all(pool)
            .await
            .map_err(|_| internal_error("db_error"))?;

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
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    require_owner(&current_user)?;

    if current_user.user_id == target_user_id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Cannot delete yourself", "code": "cannot_delete_self"})),
        ));
    }

    let pool = state.ironshelf_db.pool();

    // Verify target user exists
    let target_exists: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT id FROM users WHERE id = ?")
            .bind(&target_user_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| internal_error("db_error"))?;

    if target_exists.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "User not found", "code": "user_not_found"})),
        ));
    }

    // CASCADE handles sessions, api_keys, permissions, reading_progress, bookmarks, sort_prefs
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(&target_user_id)
        .execute(pool)
        .await
        .map_err(|_| internal_error("db_error"))?;

    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/v1/users/{id}/permissions — set permissions for a user
pub async fn set_permissions(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(target_user_id): Path<String>,
    Json(request): Json<SetPermissionsRequest>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    require_user_management(&current_user, state.ironshelf_db.pool()).await?;

    let pool = state.ironshelf_db.pool();

    // Verify target user exists
    let target_row = sqlx::query("SELECT id, is_owner FROM users WHERE id = ?")
        .bind(&target_user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| internal_error("db_error"))?;

    let target_row = target_row.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "User not found", "code": "user_not_found"})),
        )
    })?;

    let target_is_owner: bool = target_row.get::<i32, _>("is_owner") != 0;
    if target_is_owner {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Cannot modify owner permissions", "code": "cannot_modify_owner"})),
        ));
    }

    // Validate permission strings
    let valid_permissions = ["read", "download", "manage_library", "manage_users"];
    for permission in &request.permissions {
        if !valid_permissions.contains(&permission.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("Invalid permission: {}", permission),
                    "code": "invalid_permission"
                })),
            ));
        }
    }

    // Replace all permissions: delete existing, insert new
    sqlx::query("DELETE FROM permissions WHERE user_id = ?")
        .bind(&target_user_id)
        .execute(pool)
        .await
        .map_err(|_| internal_error("db_error"))?;

    for permission in &request.permissions {
        sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, ?)")
            .bind(&target_user_id)
            .bind(permission)
            .execute(pool)
            .await
            .map_err(|_| internal_error("db_error"))?;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/users/invite — create an invite code
pub async fn create_invite(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<(StatusCode, Json<InviteResponse>), (StatusCode, Json<serde_json::Value>)> {
    require_user_management(&current_user, state.ironshelf_db.pool()).await?;

    let pool = state.ironshelf_db.pool();

    let invite_code = generate_invite_code();

    sqlx::query("INSERT INTO invites (code, created_by) VALUES (?, ?)")
        .bind(&invite_code)
        .bind(&current_user.user_id)
        .execute(pool)
        .await
        .map_err(|_| internal_error("db_error"))?;

    let created_at = chrono::Utc::now().to_rfc3339();

    Ok((
        StatusCode::CREATED,
        Json(InviteResponse {
            code: invite_code,
            created_at,
        }),
    ))
}

// --- helpers ---

/// Require the current user to be the instance owner.
fn require_owner(
    user: &AuthUser,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if !user.is_owner {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Owner access required", "code": "forbidden"})),
        ));
    }
    Ok(())
}

/// Require the current user to be owner OR have manage_users permission.
async fn require_user_management(
    user: &AuthUser,
    pool: &sqlx::SqlitePool,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
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
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Insufficient permissions", "code": "forbidden"})),
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

fn internal_error(code: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": "Internal server error", "code": code})),
    )
}
