//! Reading-status endpoints: per-user read / in-progress state and mark read/unread.
//!
//! Reading state is derived from two tables:
//! - `reading_progress` (0 < percent < 1) => "in progress"
//! - `completed_books`                      => "read / finished"
//! A book in neither is "unread". The UI fetches a single snapshot and overlays
//! it onto book cards, so this avoids per-card round trips.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

/// One in-progress book and its furthest-read percent (0.0–1.0).
#[derive(Debug, Serialize)]
pub struct InProgressEntry {
    pub book_id: String,
    pub percent: f64,
}

/// Snapshot of the user's reading state across the whole library.
#[derive(Debug, Serialize)]
pub struct ReadingStatesResponse {
    pub in_progress: Vec<InProgressEntry>,
    pub completed: Vec<String>,
}

/// GET /api/v1/me/reading-states — the user's in-progress + completed book IDs.
pub async fn get_reading_states(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<ReadingStatesResponse>, AppError> {
    let in_progress = state
        .ironshelf_db
        .get_in_progress_states(&user.user_id)
        .await
        .map_err(AppError::internal)?;
    let completed = state
        .ironshelf_db
        .get_completed_book_ids(&user.user_id)
        .await
        .map_err(AppError::internal)?;

    Ok(Json(ReadingStatesResponse {
        in_progress: in_progress
            .into_iter()
            .map(|(book_id, percent)| InProgressEntry { book_id, percent })
            .collect(),
        completed,
    }))
}

/// POST /api/v1/books/{id}/complete — mark a book read for the user.
pub async fn mark_read(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .mark_book_completed(&user.user_id, &book_id)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/books/{id}/complete — mark a book unread.
///
/// Clears the completed flag AND wipes saved progress so the next open starts
/// from the beginning ("read again from the start").
pub async fn mark_unread(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .unmark_book_completed(&user.user_id, &book_id)
        .await
        .map_err(AppError::internal)?;
    state
        .ironshelf_db
        .clear_reading_progress(&user.user_id, &book_id)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}
