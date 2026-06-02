use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::pagination::{Paginated, PaginationParams, SortDirection, SortParams};
use crate::state::AppState;

/// Combined query params for list_books: pagination + sorting + search + filters.
#[derive(Deserialize)]
pub struct ListBooksQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
    pub sort: Option<String>,
    pub dir: Option<String>,
    /// Full-text search by title (case-insensitive contains).
    pub q: Option<String>,
    /// Filter by tag name (exact, case-insensitive).
    pub tag: Option<String>,
    /// Filter by language code (exact, case-insensitive).
    pub language: Option<String>,
    /// Filter by the user's reading status: reading | finished | unread | all.
    pub status: Option<String>,
}

/// GET /api/v1/books/:id
pub async fn get_book(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
) -> Result<Json<ironshelf_core::model::Book>, AppError> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            return Ok(Json(book));
        }
    }

    Err(AppError::not_found("book"))
}

/// GET /api/v1/libraries/:id/books
///
/// Supports:
/// - Pagination: ?page=&per_page=
/// - Sorting: ?sort=title|sort_title|pubdate|added_at|rating|series_index&dir=asc|desc
/// - Search: ?q= (case-insensitive title contains)
/// - Filters: ?tag= (exact tag match), ?language= (exact language match)
pub async fn list_books(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(library_id): Path<String>,
    Query(query): Query<ListBooksQuery>,
) -> Result<Json<Paginated<ironshelf_core::model::Book>>, AppError> {
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(AppError::not_found("library"))?;

    let mut books = library.source.all_books().await?;

    // Filter: search by title (case-insensitive contains)
    if let Some(ref search_query) = query.q {
        let search_lower = search_query.to_lowercase();
        books.retain(|book| book.title.to_lowercase().contains(&search_lower));
    }

    // Filter: by tag (case-insensitive exact match)
    if let Some(ref tag_filter) = query.tag {
        let tag_lower = tag_filter.to_lowercase();
        books.retain(|book| {
            book.tags
                .iter()
                .any(|tag| tag.to_lowercase() == tag_lower)
        });
    }

    // Filter: by language (case-insensitive exact match)
    if let Some(ref language_filter) = query.language {
        let language_lower = language_filter.to_lowercase();
        books.retain(|book| {
            book.languages
                .iter()
                .any(|language| language.to_lowercase() == language_lower)
        });
    }

    // Filter: by the user's reading status (reading | finished | unread).
    if let Some(ref status_filter) = query.status {
        let status = status_filter.to_lowercase();
        if status != "all" && !status.is_empty() {
            let completed: std::collections::HashSet<String> = state
                .ironshelf_db
                .get_completed_book_ids(&user.user_id)
                .await
                .map_err(AppError::internal)?
                .into_iter()
                .collect();
            let in_progress: std::collections::HashSet<String> = state
                .ironshelf_db
                .get_in_progress_states(&user.user_id)
                .await
                .map_err(AppError::internal)?
                .into_iter()
                .map(|(book_id, _percent)| book_id)
                .collect();

            books.retain(|book| {
                let book_id = book.id.to_string();
                match status.as_str() {
                    "finished" => completed.contains(&book_id),
                    "reading" => in_progress.contains(&book_id) && !completed.contains(&book_id),
                    "unread" => {
                        !completed.contains(&book_id) && !in_progress.contains(&book_id)
                    }
                    _ => true,
                }
            });
        }
    }

    // Sort
    let sort_params = SortParams {
        sort: query.sort,
        dir: query.dir,
    };
    let direction = sort_params.direction();
    let is_descending = direction == SortDirection::Descending;

    match sort_params.field() {
        Some("title") => {
            books.sort_by_key(|a| a.title.to_lowercase());
        }
        Some("sort_title") => {
            books.sort_by_key(|a| a.sort_title.to_lowercase());
        }
        Some("pubdate") => {
            books.sort_by_key(|book| book.pubdate);
        }
        Some("added_at") => {
            books.sort_by_key(|book| book.added_at);
        }
        Some("rating") => {
            books.sort_by_key(|book| book.rating.unwrap_or(0));
        }
        Some("series_index") => {
            books.sort_by(|a, b| {
                let index_a = a.series_index.unwrap_or(f64::MAX);
                let index_b = b.series_index.unwrap_or(f64::MAX);
                index_a.partial_cmp(&index_b).unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        _ => {
            // Default: sort by sort_title ascending
            books.sort_by_key(|a| a.sort_title.to_lowercase());
        }
    }

    if is_descending {
        books.reverse();
    }

    // Paginate
    let pagination = PaginationParams {
        page: query.page,
        per_page: query.per_page,
    };
    let paginated = Paginated::from_vec(books, &pagination);

    Ok(Json(paginated))
}
