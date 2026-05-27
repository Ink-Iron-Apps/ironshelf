//! Global search endpoint — searches across all libraries for authors, series, and books.
//!
//! When the tantivy search index is available, book search uses full-text ranking
//! for much faster and more relevant results. Falls back to in-memory substring
//! matching if the index is not built or unavailable.

use axum::extract::{Query, State};
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;
use ironshelf_core::model::{Author, Book, Series};
use ironshelf_core::search_index::BookIndexEntry;

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
    /// Relevance score from the search index (if tantivy was used).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
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
    /// Whether the full-text index was used for book results.
    pub indexed: bool,
}

/// Relevance ranking for in-memory fallback sorting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
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

    // SAFETY: Cap query length to prevent excessive memory use in tantivy tokenizer
    // and in-memory substring matching.
    const MAX_QUERY_LENGTH: usize = 500;
    if query.len() > MAX_QUERY_LENGTH {
        return Err(AppError::BadRequest(format!(
            "query too long ({} chars). Maximum is {} characters.",
            query.len(),
            MAX_QUERY_LENGTH
        )));
    }

    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(20).clamp(1, 100);
    let include_authors = params.search_type == "all" || params.search_type == "author";
    let include_series = params.search_type == "all" || params.search_type == "series";
    let include_books = params.search_type == "all" || params.search_type == "book";

    let libraries = state.libraries.read().await;

    let mut author_results: Vec<(RelevanceRank, AuthorResult)> = Vec::new();
    let mut series_results: Vec<(RelevanceRank, SeriesResult)> = Vec::new();
    let mut book_results: Vec<BookResult> = Vec::new();
    let mut used_index = false;
    let mut total_books_count: usize = 0;

    // Authors and series always use in-memory search (small datasets, no index needed).
    for library in libraries.iter() {
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

        if include_series {
            let authors: Vec<Author> = library.source.authors().await.unwrap_or_default();
            let mut seen_series_ids: std::collections::HashSet<i64> =
                std::collections::HashSet::new();
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
    }

    // Book search: prefer tantivy index, fall back to in-memory.
    if include_books {
        if let Some(ref search_index) = state.search_index {
            let index_guard = search_index.read().await;
            let offset = ((page - 1) * per_page) as usize;
            let limit = per_page as usize;

            match index_guard.search(&query, limit, offset) {
                Ok(index_results) => {
                    used_index = true;
                    // Tantivy returns a page of results; we don't have the true total
                    // from the index, so we report the page size as a lower bound.
                    total_books_count = index_results.len();
                    for result in index_results {
                        book_results.push(BookResult {
                            id: result.book_id,
                            title: result.title,
                            sort_title: String::new(), // Not stored in index.
                            has_cover: false,          // Not stored in index.
                            tags: vec![],              // Not stored in index.
                            library_id: result.library_id,
                            score: Some(result.score),
                        });
                    }
                }
                Err(search_error) => {
                    tracing::warn!(
                        "tantivy search failed, falling back to in-memory: {search_error}"
                    );
                    // Fall through to in-memory search below.
                }
            }
        }

        // In-memory fallback if index not available or search failed.
        if !used_index {
            let mut ranked_books: Vec<(RelevanceRank, BookResult)> = Vec::new();
            for library in libraries.iter() {
                let all_books: Vec<Book> = library.source.all_books().await.unwrap_or_default();
                for book in all_books {
                    let title_matches = matches_query(&book.title, &query);
                    let tag_matches = book.tags.iter().any(|tag| matches_query(tag, &query));

                    if title_matches || tag_matches {
                        let relevance = if title_matches {
                            compute_relevance(&book.title, &query)
                        } else {
                            RelevanceRank::Contains
                        };
                        ranked_books.push((
                            relevance,
                            BookResult {
                                id: book.id,
                                title: book.title,
                                sort_title: book.sort_title,
                                has_cover: book.has_cover,
                                tags: book.tags,
                                library_id: library.id.clone(),
                                score: None,
                            },
                        ));
                    }
                }
            }

            ranked_books.sort_by_key(|a| a.0);
            total_books_count = ranked_books.len();
            let offset = ((page - 1) * per_page) as usize;
            book_results = ranked_books
                .into_iter()
                .map(|(_, result)| result)
                .skip(offset)
                .take(per_page as usize)
                .collect();
        }
    }

    // Sort author and series results by relevance and paginate.
    author_results.sort_by_key(|a| a.0);
    series_results.sort_by_key(|a| a.0);

    // Compute total from unpaginated counts for all types.
    let total_authors_count = author_results.len();
    let total_series_count = series_results.len();
    // For books: if tantivy was used, the results are already paginated so we
    // cannot know the true total here. For in-memory fallback, we paginated
    // from ranked_books above. In both cases book_results.len() is post-pagination,
    // so we track the pre-pagination count separately.
    let total_count = total_authors_count + total_series_count + total_books_count;

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

    Ok(Json(SearchResponse {
        query,
        results: SearchResults {
            authors: authors_page,
            series: series_page,
            books: book_results,
        },
        total: total_count,
        indexed: used_index,
    }))
}

/// Response from the rebuild endpoint.
#[derive(Debug, Serialize)]
pub struct RebuildResponse {
    pub message: String,
    pub books_indexed: usize,
}

/// POST /api/v1/search/rebuild — triggers full reindex of all books (owner only).
pub async fn rebuild_search_index(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<RebuildResponse>, AppError> {
    if !auth_user.is_owner {
        return Err(AppError::Forbidden(
            "only the server owner can rebuild the search index".to_string(),
        ));
    }

    let search_index = state.search_index.as_ref().ok_or_else(|| {
        AppError::Internal("search index is not initialized".to_string())
    })?;

    // Collect all books from all libraries.
    let libraries = state.libraries.read().await;
    let mut entries: Vec<BookIndexEntry> = Vec::new();

    for library in libraries.iter() {
        let all_books = library.source.all_books().await.unwrap_or_default();
        let authors = library.source.authors().await.unwrap_or_default();

        // Build a quick lookup of author ID -> name.
        let author_name_map: std::collections::HashMap<i64, String> = authors
            .into_iter()
            .map(|author| (author.id, author.name))
            .collect();

        for book in all_books {
            let author_names: Vec<String> = book
                .author_ids
                .iter()
                .filter_map(|author_id| author_name_map.get(author_id).cloned())
                .collect();

            entries.push(BookIndexEntry {
                book_id: book.id,
                title: book.title,
                author_names: author_names.join(", "),
                series_name: None, // Would need series lookup — omit for now.
                tags: book.tags.join(", "),
                description: book.description,
                library_id: library.id.clone(),
            });
        }
    }
    drop(libraries);

    let index_guard = search_index.write().await;
    let books_indexed = index_guard.rebuild(entries).map_err(|index_error| {
        AppError::Internal(format!("failed to rebuild search index: {index_error}"))
    })?;

    tracing::info!("search index rebuilt with {books_indexed} book(s)");

    Ok(Json(RebuildResponse {
        message: format!("search index rebuilt successfully with {books_indexed} book(s)"),
        books_indexed,
    }))
}
