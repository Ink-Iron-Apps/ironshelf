use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::AuthUser;
use crate::state::AppState;

#[derive(Serialize, Deserialize)]
pub struct ReadingProgress {
    pub book_id: String,
    pub format: String,
    pub locator: Option<String>,
    pub percent: f64,
    pub updated_at: String,
}

#[derive(Deserialize)]
pub struct UpdateProgressRequest {
    pub format: String,
    pub locator: Option<String>,
    pub percent: f64,
}

#[derive(Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub book_id: String,
    pub locator: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct CreateBookmarkRequest {
    pub locator: String,
    pub note: Option<String>,
}

/// GET /api/v1/books/:id/progress
pub async fn get_progress(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
) -> Result<Json<Vec<ReadingProgress>>, StatusCode> {
    let pool = state.ironshelf_db.pool();

    let rows = sqlx::query(
        "SELECT book_id, format, locator, percent, updated_at \
         FROM reading_progress WHERE user_id = ? AND book_id = ?",
    )
    .bind(&user.user_id)
    .bind(&book_id)
    .fetch_all(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let progress = rows
        .iter()
        .map(|row| ReadingProgress {
            book_id: row.get("book_id"),
            format: row.get("format"),
            locator: row.get("locator"),
            percent: row.get("percent"),
            updated_at: row.get("updated_at"),
        })
        .collect();

    Ok(Json(progress))
}

/// PUT /api/v1/books/:id/progress
pub async fn update_progress(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
    Json(request): Json<UpdateProgressRequest>,
) -> Result<StatusCode, StatusCode> {
    let pool = state.ironshelf_db.pool();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO reading_progress (user_id, book_id, format, locator, percent, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(user_id, book_id, format) DO UPDATE SET \
         locator = excluded.locator, percent = excluded.percent, updated_at = excluded.updated_at",
    )
    .bind(&user.user_id)
    .bind(&book_id)
    .bind(&request.format)
    .bind(&request.locator)
    .bind(request.percent)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/v1/books/:id/bookmarks
pub async fn list_bookmarks(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
) -> Result<Json<Vec<Bookmark>>, StatusCode> {
    let pool = state.ironshelf_db.pool();

    let rows = sqlx::query(
        "SELECT id, book_id, locator, note, created_at \
         FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY created_at",
    )
    .bind(&user.user_id)
    .bind(&book_id)
    .fetch_all(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let bookmarks = rows
        .iter()
        .map(|row| Bookmark {
            id: row.get("id"),
            book_id: row.get("book_id"),
            locator: row.get("locator"),
            note: row.get("note"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(Json(bookmarks))
}

/// POST /api/v1/books/:id/bookmarks
pub async fn create_bookmark(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
    Json(request): Json<CreateBookmarkRequest>,
) -> Result<(StatusCode, Json<Bookmark>), StatusCode> {
    let pool = state.ironshelf_db.pool();
    let bookmark_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO bookmarks (id, user_id, book_id, locator, note, created_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&bookmark_id)
    .bind(&user.user_id)
    .bind(&book_id)
    .bind(&request.locator)
    .bind(&request.note)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((
        StatusCode::CREATED,
        Json(Bookmark {
            id: bookmark_id,
            book_id,
            locator: request.locator,
            note: request.note,
            created_at: now,
        }),
    ))
}

/// DELETE /api/v1/books/:id/bookmarks/:bookmark_id
pub async fn delete_bookmark(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path((_book_id, bookmark_id)): Path<(String, String)>,
) -> StatusCode {
    let pool = state.ironshelf_db.pool();
    let _ = sqlx::query("DELETE FROM bookmarks WHERE id = ? AND user_id = ?")
        .bind(&bookmark_id)
        .bind(&user.user_id)
        .execute(pool)
        .await;
    StatusCode::NO_CONTENT
}
