//! Genre/tag-based browsing endpoints.
//!
//! Provides a parallel browse path: Library -> Genres -> Books.
//! Tags in Calibre and dc:subject in epub serve as genres.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::AppError;
use crate::pagination::{Paginated, PaginationParams, SortDirection, SortParams};
use crate::state::AppState;

/// A genre with its aggregate book count.
#[derive(Debug, Serialize)]
pub struct GenreEntry {
    pub name: String,
    pub book_count: i64,
}

/// Query params for genre book listing (pagination + sorting).
#[derive(Deserialize)]
pub struct GenreBooksQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
    pub sort: Option<String>,
    pub dir: Option<String>,
}

/// GET /api/v1/libraries/:id/genres
///
/// List all unique genres/tags in this library with book counts, sorted alphabetically.
pub async fn list_library_genres(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<Json<Vec<GenreEntry>>, AppError> {
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|library| library.id == library_id)
        .ok_or(AppError::not_found("library"))?;

    let genre_counts = library.source.genres().await?;

    let entries: Vec<GenreEntry> = genre_counts
        .into_iter()
        .map(|(name, book_count)| GenreEntry { name, book_count })
        .collect();

    Ok(Json(entries))
}

/// GET /api/v1/libraries/:id/genres/:genre_name/books
///
/// Books in a specific genre within a library, paginated + sortable.
pub async fn list_library_genre_books(
    State(state): State<AppState>,
    Path((library_id, genre_name)): Path<(String, String)>,
    Query(query): Query<GenreBooksQuery>,
) -> Result<Json<Paginated<ironshelf_core::model::Book>>, AppError> {
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|library| library.id == library_id)
        .ok_or(AppError::not_found("library"))?;

    let decoded_genre_name = urlencoding::decode(&genre_name)
        .unwrap_or_else(|_| genre_name.clone().into())
        .into_owned();

    let mut books = library.source.books_by_genre(&decoded_genre_name).await?;

    sort_books(&mut books, &query.sort, &query.dir);

    let pagination = PaginationParams {
        page: query.page,
        per_page: query.per_page,
    };
    let paginated = Paginated::from_vec(books, &pagination);

    Ok(Json(paginated))
}

/// GET /api/v1/genres
///
/// All genres across ALL libraries, merged and deduped, with total book counts.
pub async fn list_all_genres(
    State(state): State<AppState>,
) -> Result<Json<Vec<GenreEntry>>, AppError> {
    let libraries = state.libraries.read().await;
    let mut merged_genres: HashMap<String, i64> = HashMap::new();

    for library in libraries.iter() {
        let genre_counts = library.source.genres().await.unwrap_or_default();
        for (name, count) in genre_counts {
            *merged_genres.entry(name).or_insert(0) += count;
        }
    }

    let mut entries: Vec<GenreEntry> = merged_genres
        .into_iter()
        .map(|(name, book_count)| GenreEntry { name, book_count })
        .collect();

    entries.sort_by_key(|a| a.name.to_lowercase());

    Ok(Json(entries))
}

/// GET /api/v1/genres/:genre_name
///
/// Genre detail: books across all libraries, with pagination + sorting.
pub async fn get_genre_books(
    State(state): State<AppState>,
    Path(genre_name): Path<String>,
    Query(query): Query<GenreBooksQuery>,
) -> Result<Json<Paginated<ironshelf_core::model::Book>>, AppError> {
    let decoded_genre_name = urlencoding::decode(&genre_name)
        .unwrap_or_else(|_| genre_name.clone().into())
        .into_owned();

    let libraries = state.libraries.read().await;
    let mut all_books = Vec::new();

    for library in libraries.iter() {
        let books = library.source.books_by_genre(&decoded_genre_name).await.unwrap_or_default();
        all_books.extend(books);
    }

    if all_books.is_empty() {
        return Err(AppError::not_found("genre"));
    }

    sort_books(&mut all_books, &query.sort, &query.dir);

    let pagination = PaginationParams {
        page: query.page,
        per_page: query.per_page,
    };
    let paginated = Paginated::from_vec(all_books, &pagination);

    Ok(Json(paginated))
}

/// GET /api/v1/genres/:genre_name/authors
///
/// Authors who have books tagged with this genre, across all libraries.
pub async fn genre_authors(
    State(state): State<AppState>,
    Path(genre_name): Path<String>,
) -> Result<Json<Vec<ironshelf_core::model::Author>>, AppError> {
    let decoded_genre_name = urlencoding::decode(&genre_name)
        .unwrap_or_else(|_| genre_name.clone().into())
        .into_owned();

    let libraries = state.libraries.read().await;
    let mut author_ids_seen: std::collections::HashSet<i64> = std::collections::HashSet::new();
    let mut genre_authors_list: Vec<ironshelf_core::model::Author> = Vec::new();

    for library in libraries.iter() {
        let books = library.source.books_by_genre(&decoded_genre_name).await.unwrap_or_default();
        if books.is_empty() {
            continue;
        }

        // Collect author IDs from genre books
        let author_ids_in_genre: std::collections::HashSet<i64> = books
            .iter()
            .flat_map(|book| book.author_ids.iter().copied())
            .collect();

        // Fetch all authors and filter to those in genre
        let all_authors = library.source.authors().await.unwrap_or_default();
        for author in all_authors {
            if author_ids_in_genre.contains(&author.id) && !author_ids_seen.contains(&author.id) {
                author_ids_seen.insert(author.id);
                genre_authors_list.push(author);
            }
        }
    }

    genre_authors_list.sort_by_key(|a| a.sort_name.clone());

    Ok(Json(genre_authors_list))
}

/// GET /api/v1/genres/:genre_name/series
///
/// Series that have books tagged with this genre, across all libraries.
pub async fn genre_series(
    State(state): State<AppState>,
    Path(genre_name): Path<String>,
) -> Result<Json<Vec<ironshelf_core::model::Series>>, AppError> {
    let decoded_genre_name = urlencoding::decode(&genre_name)
        .unwrap_or_else(|_| genre_name.clone().into())
        .into_owned();

    let libraries = state.libraries.read().await;
    let mut series_ids_seen: std::collections::HashSet<i64> = std::collections::HashSet::new();
    let mut genre_series_list: Vec<ironshelf_core::model::Series> = Vec::new();

    for library in libraries.iter() {
        let books = library.source.books_by_genre(&decoded_genre_name).await.unwrap_or_default();
        if books.is_empty() {
            continue;
        }

        // Collect series IDs from genre books
        let series_ids_in_genre: std::collections::HashSet<i64> = books
            .iter()
            .filter_map(|book| book.series_id)
            .collect();

        // Fetch series details for each
        for series_id in &series_ids_in_genre {
            if series_ids_seen.contains(series_id) {
                continue;
            }
            if let Ok(Some(series)) = library.source.series(*series_id).await {
                series_ids_seen.insert(*series_id);
                genre_series_list.push(series);
            }
        }
    }

    genre_series_list.sort_by_key(|a| a.sort_name.clone());

    Ok(Json(genre_series_list))
}

/// Sort books by the given field and direction.
fn sort_books(books: &mut [ironshelf_core::model::Book], sort_field: &Option<String>, sort_direction: &Option<String>) {
    let sort_params = SortParams {
        sort: sort_field.clone(),
        dir: sort_direction.clone(),
    };
    let direction = sort_params.direction();
    let is_descending = direction == SortDirection::Descending;

    match sort_params.field() {
        Some("title") => {
            books.sort_by_key(|a| a.title.to_lowercase());
        }
        Some("author") => {
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
            // Default: sort by title ascending
            books.sort_by_key(|a| a.sort_title.to_lowercase());
        }
    }

    if is_descending {
        books.reverse();
    }
}
