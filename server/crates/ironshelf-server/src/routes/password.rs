//! Password change endpoint — PUT /api/v1/auth/password

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use sqlx::Row;

use crate::auth::{hash_password, verify_password, AuthUser};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

/// PUT /api/v1/auth/password — change the current user's password.
pub async fn change_password(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<StatusCode, AppError> {
    // Validate new password length.
    let new_password_char_count = request.new_password.chars().count();
    if new_password_char_count < 8 {
        return Err(AppError::BadRequest(
            "New password must be at least 8 characters".to_string(),
        ));
    }
    if new_password_char_count > 1024 {
        return Err(AppError::BadRequest(
            "New password must not exceed 1024 characters".to_string(),
        ));
    }

    let pool = state.ironshelf_db.pool();

    // Fetch the current password hash.
    let row = sqlx::query("SELECT password_hash FROM users WHERE id = ?")
        .bind(&current_user.user_id)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?
        .ok_or_else(|| AppError::not_found("user"))?;

    let stored_hash: String = row.get("password_hash");

    // Verify the current password.
    if !verify_password(&request.current_password, &stored_hash) {
        return Err(AppError::Unauthorized(
            "Current password is incorrect".to_string(),
        ));
    }

    // Hash the new password and update.
    let new_hash = hash_password(&request.new_password)
        .map_err(|_| AppError::Internal("Failed to hash new password".to_string()))?;

    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(&new_hash)
        .bind(&current_user.user_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    // Invalidate all other sessions for this user (security: force re-login on other devices).
    if let Some(ref current_session_id) = current_user.session_id {
        sqlx::query("DELETE FROM sessions WHERE user_id = ? AND id != ?")
            .bind(&current_user.user_id)
            .bind(current_session_id)
            .execute(pool)
            .await
            .map_err(AppError::internal)?;
    }

    Ok(StatusCode::NO_CONTENT)
}
