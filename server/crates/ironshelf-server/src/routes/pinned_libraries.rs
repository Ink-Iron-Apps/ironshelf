//! Per-user pinned-library endpoints — /api/v1/me/pinned-libraries
//!
//! Pins follow the user account so they persist across cache clears, incognito
//! sessions, devices, and the different origins of the hosted dashboard vs. the
//! server's own UI. The browser still keeps a localStorage copy for instant
//! render, but the server is the source of truth.

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

/// A pinned library as exchanged with the client. Mirrors the shape the web UI
/// keeps in localStorage (`id`, `name`, `source_kind`).
#[derive(Debug, Serialize, Deserialize)]
pub struct PinnedLibraryDto {
    pub id: String,
    pub name: String,
    pub source_kind: String,
}

#[derive(Debug, Deserialize)]
pub struct SetPinnedLibrariesRequest {
    pub libraries: Vec<PinnedLibraryDto>,
}

/// Maximum pins per user — matches the web UI's MAX_PINNED_LIBRARIES.
const MAX_PINNED_LIBRARIES: usize = 10;

/// GET /api/v1/me/pinned-libraries — list the user's pinned libraries in order.
pub async fn list_pinned_libraries(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<PinnedLibraryDto>>, AppError> {
    let pinned = state
        .ironshelf_db
        .get_pinned_libraries(&current_user.user_id)
        .await
        .map_err(AppError::internal)?;

    let response = pinned
        .into_iter()
        .map(|pin| PinnedLibraryDto {
            id: pin.library_id,
            name: pin.name,
            source_kind: pin.source_kind,
        })
        .collect();

    Ok(Json(response))
}

/// PUT /api/v1/me/pinned-libraries — replace the user's full ordered pin set.
/// The client sends the complete list (pin/unpin/reorder are all just a new
/// list), and the server replaces what it has.
pub async fn set_pinned_libraries(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Json(request): Json<SetPinnedLibrariesRequest>,
) -> Result<Json<Vec<PinnedLibraryDto>>, AppError> {
    if request.libraries.len() > MAX_PINNED_LIBRARIES {
        return Err(AppError::BadRequest(format!(
            "Cannot pin more than {} libraries",
            MAX_PINNED_LIBRARIES
        )));
    }

    // Reject blank ids/names so the sidebar never renders an empty pin row.
    for library in &request.libraries {
        if library.id.trim().is_empty() || library.name.trim().is_empty() {
            return Err(AppError::BadRequest(
                "Pinned library id and name are required".to_string(),
            ));
        }
    }

    let rows: Vec<(String, String, String)> = request
        .libraries
        .iter()
        .map(|library| {
            (
                library.id.clone(),
                library.name.clone(),
                library.source_kind.clone(),
            )
        })
        .collect();

    state
        .ironshelf_db
        .set_pinned_libraries(&current_user.user_id, &rows)
        .await
        .map_err(AppError::internal)?;

    Ok(Json(request.libraries))
}
