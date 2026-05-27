//! Highlights and annotations API routes.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

/// Valid highlight colors.
const VALID_COLORS: &[&str] = &["yellow", "green", "blue", "pink", "purple"];

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateHighlightRequest {
    pub cfi_range: String,
    pub text_content: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    pub note: Option<String>,
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_color() -> String {
    "yellow".to_string()
}

fn default_format() -> String {
    "EPUB".to_string()
}

#[derive(Deserialize)]
pub struct UpdateHighlightRequest {
    pub color: Option<String>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct HighlightFilterQuery {
    pub book_id: Option<String>,
    pub color: Option<String>,
}

#[derive(Serialize)]
pub struct HighlightResponse {
    pub id: String,
    pub user_id: String,
    pub book_id: String,
    pub format: String,
    pub cfi_range: String,
    pub text_content: Option<String>,
    pub color: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/v1/books/{id}/highlights — list user's highlights for this book.
pub async fn list_book_highlights(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(book_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let highlights = state
        .ironshelf_db
        .get_book_highlights(&auth_user.user_id, &book_id)
        .await
        .map_err(|error| AppError::internal(error))?;

    let response: Vec<HighlightResponse> = highlights
        .into_iter()
        .map(|highlight| HighlightResponse {
            id: highlight.id,
            user_id: highlight.user_id,
            book_id: highlight.book_id,
            format: highlight.format,
            cfi_range: highlight.cfi_range,
            text_content: highlight.text_content,
            color: highlight.color,
            note: highlight.note,
            created_at: highlight.created_at,
            updated_at: highlight.updated_at,
        })
        .collect();

    Ok(Json(response))
}

/// POST /api/v1/books/{id}/highlights — create a highlight on a book.
pub async fn create_highlight(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(book_id): Path<String>,
    Json(request): Json<CreateHighlightRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate color
    if !VALID_COLORS.contains(&request.color.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid color '{}'. Valid colors: yellow, green, blue, pink, purple",
            request.color
        )));
    }

    // Validate cfi_range is not empty
    if request.cfi_range.trim().is_empty() {
        return Err(AppError::BadRequest(
            "cfi_range must not be empty".to_string(),
        ));
    }

    let highlight_id = state
        .ironshelf_db
        .create_highlight(
            &auth_user.user_id,
            &book_id,
            &request.format,
            &request.cfi_range,
            request.text_content.as_deref(),
            &request.color,
            request.note.as_deref(),
        )
        .await
        .map_err(|error| AppError::internal(error))?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "id": highlight_id })),
    ))
}

/// PATCH /api/v1/highlights/{id} — update a highlight's note or color.
pub async fn update_highlight(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(highlight_id): Path<String>,
    Json(request): Json<UpdateHighlightRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate color if provided
    if let Some(ref color) = request.color {
        if !VALID_COLORS.contains(&color.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Invalid color '{}'. Valid colors: yellow, green, blue, pink, purple",
                color
            )));
        }
    }

    state
        .ironshelf_db
        .update_highlight(
            &highlight_id,
            &auth_user.user_id,
            request.color.as_deref(),
            request.note.as_deref(),
        )
        .await
        .map_err(|error| match error {
            ironshelf_core::db::DbError::NotFound => {
                AppError::not_found("highlight")
            }
            other => AppError::internal(other),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/highlights/{id} — delete a highlight.
pub async fn delete_highlight(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(highlight_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    state
        .ironshelf_db
        .delete_highlight(&highlight_id, &auth_user.user_id)
        .await
        .map_err(|error| match error {
            ironshelf_core::db::DbError::NotFound => {
                AppError::not_found("highlight")
            }
            other => AppError::internal(other),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/v1/me/highlights?book_id=&color= — all user highlights with optional filters.
pub async fn list_all_highlights(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<HighlightFilterQuery>,
) -> Result<impl IntoResponse, AppError> {
    // Validate color filter if provided
    if let Some(ref color) = query.color {
        if !VALID_COLORS.contains(&color.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Invalid color filter '{}'. Valid colors: yellow, green, blue, pink, purple",
                color
            )));
        }
    }

    let highlights = state
        .ironshelf_db
        .get_all_highlights(
            &auth_user.user_id,
            query.book_id.as_deref(),
            query.color.as_deref(),
        )
        .await
        .map_err(|error| AppError::internal(error))?;

    let response: Vec<HighlightResponse> = highlights
        .into_iter()
        .map(|highlight| HighlightResponse {
            id: highlight.id,
            user_id: highlight.user_id,
            book_id: highlight.book_id,
            format: highlight.format,
            cfi_range: highlight.cfi_range,
            text_content: highlight.text_content,
            color: highlight.color,
            note: highlight.note,
            created_at: highlight.created_at,
            updated_at: highlight.updated_at,
        })
        .collect();

    Ok(Json(response))
}
