//! Global search endpoint — searches across all libraries for authors, series, and books.

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;
use ironshelf_core::model::{Author, Book, Series};

/// Query parameters for the global search endpoint.
#[derive(Debug, Deserialize)]
pub struct SearchParams {
    /// The search query string.
    pub q: String,
    /// Filter by content type: "all", "author", "series", "book". Defaults to "all".
    #[serde(rename = "type", default = "default_search_type")]
    pub search_type: String,
    /// Page number (1-indexed). Defaults to 1.
    pub page: Option<u32>,
    /// Items per page. Defaults to 20.
    pub per_page: Option<u32>,
}

fn default_search_type() -> String {
    "all".to_string()
}

/// A single author result in the search response.
#[derive(Debug, Serialize)]
pub struct AuthorResult {
    pub id: i64,
    pub name: String,
    pub sort_name: String,
    pub book_count: i64,
    pub series_count: i64,
    pub library_id: String,
}

/// A single series result in the search response.
#[derive(Debug, Serialize)]
pub struct SeriesResult {
    pub id: i64,
    pub name: String,
    pub sort_name: String,
    pub book_count: i64,
    pub library_id: String,
}

/// A single book result in the search response.
#[derive(Debug, Serialize)]
pub struct BookResult {
    pub id: i64,
    pub title: String,
    pub sort_title: String,
    pub has_cover: bool,
    pub tags: Vec<String>,
    pub library_id: String,
}

/// Grouped search results by content type.
#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub authors: Vec<AuthorResult>,
    pub series: Vec<SeriesResult>,
    pub books: Vec<BookResult>,
}

/// The full search response envelope.
#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub results: SearchResults,
    pub total: usize,
}

/// Relevance ranking for sorting results.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
enum RelevanceRank {
    /// Exact case-insensitive match.
    Exact,
    /// Name starts with the query.
    StartsWith,
    /// Name contains the query.
    Contains,
}

fn compute_relevance(value: &str, query: &str) -> RelevanceRank {
    let value_lower = value.to_lowercase();
    let query_lower = query.to_lowercase();

    if value_lower == query_lower {
        RelevanceRank::Exact
    } else if value_lower.starts_with(&query_lower) {
        RelevanceRank::StartsWith
    } else {
        RelevanceRank::Contains
    }
}

fn matches_query(value: &str, query: &str) -> bool {
    value.to_lowercase().contains(&query.to_lowercase())
}

/// GET /api/v1/search — unified search across all libraries.
pub async fn global_search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>, AppError> {
    let query = params.q.trim().to_string();
    if query.is_empty() {
        return Err(AppError::BadRequest(
            "query parameter 'q' must not be empty".to_string(),
        ));
    }

    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(20).min(100).max(1);
    let include_authors = params.search_type == "all" || params.search_type == "author";
    let include_series = params.search_type == "all" || params.search_type == "series";
    let include_books = params.search_type == "all" || params.search_type == "book";

    let libraries = state.libraries.read().await;

    let mut author_results: Vec<(RelevanceRank, AuthorResult)> = Vec::new();
    let mut series_results: Vec<(RelevanceRank, SeriesResult)> = Vec::new();
    let mut book_results: Vec<(RelevanceRank, BookResult)> = Vec::new();

    for library in libraries.iter() {
        // Search authors
        if include_authors {
            let authors: Vec<Author> = library.source.authors().await.unwrap_or_default();
            for author in authors {
                if matches_query(&author.name, &query) {
                    let relevance = compute_relevance(&author.name, &query);
                    author_results.push((
                        relevance,
                        AuthorResult {
                            id: author.id,
                            name: author.name,
                            sort_name: author.sort_name,
                            book_count: author.book_count,
                            series_count: author.series_count,
                            library_id: library.id.clone(),
                        },
                    ));
                }
            }
        }

        // Search series
        if include_series {
            // Get all authors to iterate their series
            let authors: Vec<Author> = library.source.authors().await.unwrap_or_default();
            let mut seen_series_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
            for author in &authors {
                let series_list: Vec<Series> = library
                    .source
                    .series_by_author(author.id)
                    .await
                    .unwrap_or_default();
                for series_item in series_list {
                    if seen_series_ids.contains(&series_item.id) {
                        continue;
                    }
                    if matches_query(&series_item.name, &query) {
                        seen_series_ids.insert(series_item.id);
                        let relevance = compute_relevance(&series_item.name, &query);
                        series_results.push((
                            relevance,
                            SeriesResult {
                                id: series_item.id,
                                name: series_item.name,
                                sort_name: series_item.sort_name,
                                book_count: series_item.book_count,
                                library_id: library.id.clone(),
                            },
                        ));
                    }
                }
            }
        }

        // Search books (match title OR tags)
        if include_books {
            let all_books: Vec<Book> = library.source.all_books().await.unwrap_or_default();
            for book in all_books {
                let title_matches = matches_query(&book.title, &query);
                let tag_matches = book.tags.iter().any(|tag| matches_query(tag, &query));

                if title_matches || tag_matches {
                    let relevance = if title_matches {
                        compute_relevance(&book.title, &query)
                    } else {
                        // Tag matches are always ranked as "contains"
                        RelevanceRank::Contains
                    };
                    book_results.push((
                        relevance,
                        BookResult {
                            id: book.id,
                            title: book.title,
                            sort_title: book.sort_title,
                            has_cover: book.has_cover,
                            tags: book.tags,
                            library_id: library.id.clone(),
                        },
                    ));
                }
            }
        }
    }

    // Sort each result set by relevance (exact first, then starts-with, then contains)
    author_results.sort_by(|a, b| a.0.cmp(&b.0));
    series_results.sort_by(|a, b| a.0.cmp(&b.0));
    book_results.sort_by(|a, b| a.0.cmp(&b.0));

    let total_count =
        author_results.len() + series_results.len() + book_results.len();

    // Paginate each result set independently
    let offset = ((page - 1) * per_page) as usize;

    let authors_page: Vec<AuthorResult> = author_results
        .into_iter()
        .map(|(_, result)| result)
        .skip(offset)
        .take(per_page as usize)
        .collect();

    let series_page: Vec<SeriesResult> = series_results
        .into_iter()
        .map(|(_, result)| result)
        .skip(offset)
        .take(per_page as usize)
        .collect();

    let books_page: Vec<BookResult> = book_results
        .into_iter()
        .map(|(_, result)| result)
        .skip(offset)
        .take(per_page as usize)
        .collect();

    Ok(Json(SearchResponse {
        query,
        results: SearchResults {
            authors: authors_page,
            series: series_page,
            books: books_page,
        },
        total: total_count,
    }))
}
