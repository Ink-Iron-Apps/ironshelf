use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::pagination::{Paginated, PaginationParams, SortDirection, SortParams};
use crate::state::AppState;

#[derive(Serialize)]
pub struct AuthorDetail {
    #[serde(flatten)]
    pub author: ironshelf_core::model::Author,
    pub series: Vec<ironshelf_core::model::Series>,
    pub standalone_count: usize,
}

/// Combined query params for list_authors: pagination + sorting.
#[derive(Deserialize)]
pub struct ListAuthorsQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
    pub sort: Option<String>,
    pub dir: Option<String>,
}

/// GET /api/v1/libraries/:id/authors
///
/// Supports pagination (?page=&per_page=) and sorting (?sort=name|sort_name|book_count|series_count&dir=asc|desc).
pub async fn list_authors(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
    Query(query): Query<ListAuthorsQuery>,
) -> Result<Json<Paginated<ironshelf_core::model::Author>>, AppError> {
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(AppError::not_found("library"))?;

    let mut authors = library.source.authors().await?;

    // Sort
    let sort_params = SortParams {
        sort: query.sort,
        dir: query.dir,
    };
    let direction = sort_params.direction();
    let is_descending = direction == SortDirection::Descending;

    match sort_params.field() {
        Some("name") => {
            authors.sort_by_key(|a| a.name.to_lowercase());
        }
        Some("sort_name") => {
            authors.sort_by_key(|a| a.sort_name.to_lowercase());
        }
        Some("book_count") => {
            authors.sort_by_key(|a| a.book_count);
        }
        Some("series_count") => {
            authors.sort_by_key(|a| a.series_count);
        }
        _ => {
            // Default: sort by sort_name ascending
            authors.sort_by_key(|a| a.sort_name.to_lowercase());
        }
    }

    if is_descending {
        authors.reverse();
    }

    // Paginate
    let pagination = PaginationParams {
        page: query.page,
        per_page: query.per_page,
    };
    let paginated = Paginated::from_vec(authors, &pagination);

    Ok(Json(paginated))
}

/// GET /api/v1/authors/:id
pub async fn get_author(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<AuthorDetail>, AppError> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        let authors = library.source.authors().await?;

        if let Some(author) = authors.into_iter().find(|a| a.id == author_id) {
            let series = library.source.series_by_author(author_id).await?;

            let standalone = library.source.standalone_books(author_id).await?;

            return Ok(Json(AuthorDetail {
                author,
                series,
                standalone_count: standalone.len(),
            }));
        }
    }

    Err(AppError::not_found("author"))
}

/// GET /api/v1/authors/:id/series
pub async fn author_series(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<Vec<ironshelf_core::model::Series>>, AppError> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        let series = library.source.series_by_author(author_id).await?;

        if !series.is_empty() {
            return Ok(Json(series));
        }
    }

    Ok(Json(vec![]))
}

/// GET /api/v1/authors/:id/standalone
pub async fn author_standalone(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<Vec<ironshelf_core::model::Book>>, AppError> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        let books = library.source.standalone_books(author_id).await?;

        if !books.is_empty() {
            return Ok(Json(books));
        }
    }

    Ok(Json(vec![]))
}
