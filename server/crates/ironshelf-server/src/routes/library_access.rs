//! Per-user library access control — /api/v1/users/{id}/library-access

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct LibraryAccessResponse {
    pub user_id: String,
    /// List of library IDs the user may access. Empty means all libraries (unrestricted).
    pub library_ids: Vec<String>,
    pub is_restricted: bool,
}

#[derive(Debug, Deserialize)]
pub struct SetLibraryAccessRequest {
    /// Library IDs the user may access. Empty array means unrestricted.
    pub library_ids: Vec<String>,
}

/// GET /api/v1/users/{id}/library-access — get a user's library access list.
pub async fn get_library_access(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(target_user_id): Path<String>,
) -> Result<Json<LibraryAccessResponse>, AppError> {
    // Only owners or the user themselves can view access.
    if !current_user.is_owner && current_user.user_id != target_user_id {
        return Err(AppError::Forbidden(
            "Insufficient permissions".to_string(),
        ));
    }

    let accessible = state
        .ironshelf_db
        .get_accessible_libraries(&target_user_id)
        .await
        .map_err(AppError::internal)?;

    let (library_ids, is_restricted) = match accessible {
        Some(ids) => (ids, true),
        None => (Vec::new(), false),
    };

    Ok(Json(LibraryAccessResponse {
        user_id: target_user_id,
        library_ids,
        is_restricted,
    }))
}

/// PATCH /api/v1/users/{id}/library-access — set a user's library access list.
pub async fn set_library_access(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(target_user_id): Path<String>,
    Json(request): Json<SetLibraryAccessRequest>,
) -> Result<StatusCode, AppError> {
    if !current_user.is_owner {
        return Err(AppError::Forbidden(
            "Owner access required".to_string(),
        ));
    }

    if request.library_ids.is_empty() {
        // Unrestricted: clear all access entries.
        state
            .ironshelf_db
            .clear_library_access(&target_user_id)
            .await
            .map_err(AppError::internal)?;
    } else {
        state
            .ironshelf_db
            .set_library_access(&target_user_id, &request.library_ids)
            .await
            .map_err(AppError::internal)?;
    }

    Ok(StatusCode::NO_CONTENT)
}
