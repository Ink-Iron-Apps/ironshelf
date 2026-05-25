use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use crate::state::AppState;

/// GET /api/v1/books/:id — full book detail
pub async fn get_book(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
) -> Result<Json<ironshelf_core::model::Book>, StatusCode> {
    for library in &state.libraries {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            return Ok(Json(book));
        }
    }

    Err(StatusCode::NOT_FOUND)
}

/// GET /api/v1/libraries/:id/books — flat book list for a library
pub async fn list_books(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<Json<Vec<ironshelf_core::model::Book>>, StatusCode> {
    let library = state
        .libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let books = library
        .source
        .all_books()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(books))
}
