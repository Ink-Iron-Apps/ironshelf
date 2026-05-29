//! Reading queue endpoints — /api/v1/me/queue

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

/// A queue item enriched with book metadata for the response.
#[derive(Debug, Serialize)]
pub struct QueueItemResponse {
    /// The queue entry ID (same as book_id for this table).
    pub id: String,
    pub book_id: String,
    pub position: i64,
    pub title: String,
    pub authors: Vec<String>,
    pub has_cover: bool,
    pub added_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddToQueueRequest {
    pub book_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MoveQueueItemRequest {
    pub direction: String,
}

#[derive(Debug, Deserialize)]
pub struct ReorderQueueRequest {
    pub order: Vec<String>,
}

/// GET /api/v1/me/queue — list user's reading queue with book metadata.
pub async fn list_queue(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<QueueItemResponse>>, AppError> {
    let queue_items = state
        .ironshelf_db
        .get_reading_queue(&current_user.user_id)
        .await
        .map_err(AppError::internal)?;

    let libraries = state.libraries.read().await;
    let mut response_items = Vec::with_capacity(queue_items.len());

    for queue_item in &queue_items {
        // Try to find the book across all loaded libraries to enrich with metadata.
        let mut title = String::from("Unknown Book");
        let mut authors: Vec<String> = Vec::new();
        let mut has_cover = false;

        for library in libraries.iter() {
            if let Ok(Some(book)) = library
                .source
                .book(queue_item.book_id.parse::<i64>().unwrap_or(-1))
                .await
            {
                title = book.title.clone();
                authors = book.author_names.clone();
                has_cover = book.has_cover;
                break;
            }
        }

        response_items.push(QueueItemResponse {
            id: queue_item.book_id.clone(),
            book_id: queue_item.book_id.clone(),
            position: queue_item.position,
            title,
            authors,
            has_cover,
            added_at: queue_item.added_at.clone(),
        });
    }

    Ok(Json(response_items))
}

/// POST /api/v1/me/queue — add a book to the queue.
pub async fn add_to_queue(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Json(request): Json<AddToQueueRequest>,
) -> Result<StatusCode, AppError> {
    if request.book_id.trim().is_empty() {
        return Err(AppError::BadRequest("book_id is required".to_string()));
    }

    state
        .ironshelf_db
        .add_to_reading_queue(&current_user.user_id, &request.book_id)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::CREATED)
}

/// DELETE /api/v1/me/queue/{book_id} — remove a book from the queue.
pub async fn remove_from_queue(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let removed = state
        .ironshelf_db
        .remove_from_reading_queue(&current_user.user_id, &book_id)
        .await
        .map_err(AppError::internal)?;

    if !removed {
        return Err(AppError::not_found("queue item"));
    }

    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/v1/me/queue/{book_id}/move — move a queue item up or down.
pub async fn move_queue_item(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
    Json(request): Json<MoveQueueItemRequest>,
) -> Result<StatusCode, AppError> {
    let direction = request.direction.to_lowercase();
    if direction != "up" && direction != "down" {
        return Err(AppError::BadRequest(
            "direction must be 'up' or 'down'".to_string(),
        ));
    }

    state
        .ironshelf_db
        .move_reading_queue_item(&current_user.user_id, &book_id, &direction)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/me/queue/reorder — reorder the entire queue.
pub async fn reorder_queue(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Json(request): Json<ReorderQueueRequest>,
) -> Result<StatusCode, AppError> {
    if request.order.is_empty() {
        return Err(AppError::BadRequest("order must not be empty".to_string()));
    }

    state
        .ironshelf_db
        .reorder_reading_queue(&current_user.user_id, &request.order)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}
