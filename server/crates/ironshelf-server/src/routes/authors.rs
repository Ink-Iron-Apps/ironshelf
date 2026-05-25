use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct AuthorDetail {
    #[serde(flatten)]
    pub author: ironshelf_core::model::Author,
    pub series: Vec<ironshelf_core::model::Series>,
    pub standalone_count: usize,
}

/// GET /api/v1/libraries/:id/authors
pub async fn list_authors(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<Json<Vec<ironshelf_core::model::Author>>, StatusCode> {
    let library = state
        .libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let authors = library
        .source
        .authors()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(authors))
}

/// GET /api/v1/authors/:id — author detail with series list
pub async fn get_author(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<AuthorDetail>, StatusCode> {
    // Search across all libraries for this author
    for library in &state.libraries {
        let authors = library
            .source
            .authors()
            .await
            .unwrap_or_default();

        if let Some(author) = authors.into_iter().find(|a| a.id == author_id) {
            let series = library
                .source
                .series_by_author(author_id)
                .await
                .unwrap_or_default();

            let standalone = library
                .source
                .standalone_books(author_id)
                .await
                .unwrap_or_default();

            return Ok(Json(AuthorDetail {
                author,
                series,
                standalone_count: standalone.len(),
            }));
        }
    }

    Err(StatusCode::NOT_FOUND)
}

/// GET /api/v1/authors/:id/series
pub async fn author_series(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<Vec<ironshelf_core::model::Series>>, StatusCode> {
    for library in &state.libraries {
        let series = library
            .source
            .series_by_author(author_id)
            .await
            .unwrap_or_default();

        if !series.is_empty() {
            return Ok(Json(series));
        }
    }

    // Author may exist but have no series
    Ok(Json(vec![]))
}

/// GET /api/v1/authors/:id/standalone
pub async fn author_standalone(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<Vec<ironshelf_core::model::Book>>, StatusCode> {
    for library in &state.libraries {
        let books = library
            .source
            .standalone_books(author_id)
            .await
            .unwrap_or_default();

        if !books.is_empty() {
            return Ok(Json(books));
        }
    }

    Ok(Json(vec![]))
}
