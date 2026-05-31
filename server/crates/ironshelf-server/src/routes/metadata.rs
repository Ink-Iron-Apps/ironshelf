//! Metadata enrichment endpoints — search external providers, apply overrides.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

use ironshelf_core::metadata::{
    best_composite, rank_matches, BookMetadata, GoogleBooksProvider, MetadataMatch,
    MetadataProvider, OpenLibraryProvider,
};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct MetadataSearchResponse {
    pub book_id: i64,
    pub matches: Vec<MetadataMatch>,
    pub composite: Option<BookMetadata>,
}

/// Optional refine terms for metadata search. When absent, the book's own
/// title/author are used. An explicit empty `author` searches without an
/// author filter.
#[derive(Deserialize)]
pub struct MetadataSearchQuery {
    pub title: Option<String>,
    pub author: Option<String>,
}

/// Normalize an author name from Calibre's "Last, First" sort form to the
/// "First Last" form metadata providers expect.
fn normalize_author(name: &str) -> String {
    if let Some((last, first)) = name.split_once(',') {
        let first = first.trim();
        let last = last.trim();
        if !first.is_empty() && !last.is_empty() {
            return format!("{first} {last}");
        }
    }
    name.trim().to_string()
}

/// Query both providers concurrently and collect their matches (errors logged).
async fn run_provider_search(
    state: &AppState,
    title: &str,
    author: Option<&str>,
) -> Vec<MetadataMatch> {
    let google_provider = GoogleBooksProvider::with_client(&state.http_client);
    let open_library_provider = OpenLibraryProvider::with_client(&state.http_client);

    let (google_result, open_library_result) = tokio::join!(
        google_provider.search(title, author),
        open_library_provider.search(title, author),
    );

    let mut matches: Vec<MetadataMatch> = Vec::new();
    match google_result {
        Ok(found) => matches.extend(found),
        Err(error) => tracing::warn!("google books search failed: {error}"),
    }
    match open_library_result {
        Ok(found) => matches.extend(found),
        Err(error) => tracing::warn!("open library search failed: {error}"),
    }
    matches
}

#[derive(Deserialize)]
pub struct ApplyMetadataRequest {
    /// Index into the search results to apply, or null to apply the composite.
    pub match_index: Option<usize>,
    /// Direct override fields (takes precedence when provided).
    pub title: Option<String>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct ApplyMetadataResponse {
    pub book_id: i64,
    pub applied: bool,
    /// Whether the change was also written back to Calibre (when enabled).
    pub calibre_updated: bool,
}

#[derive(Serialize)]
pub struct BulkScanResponse {
    pub library_id: String,
    pub books_missing_metadata: i64,
    pub books_enriched: i64,
    pub errors: Vec<BulkScanBookError>,
}

#[derive(Serialize)]
pub struct BulkScanBookError {
    pub book_id: i64,
    pub title: String,
    pub error: String,
}

// ---------------------------------------------------------------------------
// GET /api/v1/books/{id}/metadata/search
// ---------------------------------------------------------------------------

/// Search Google Books and Open Library for metadata matching this book's
/// title and primary author. Returns ranked matches plus a merged composite.
pub async fn search_metadata(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
    Query(query): Query<MetadataSearchQuery>,
    _auth_user: axum::Extension<AuthUser>,
) -> Result<Json<MetadataSearchResponse>, AppError> {
    // Use the caller's refined terms when provided, else the book's own title
    // and primary author.
    let (book_title, book_author) = find_book_title_author(&state, book_id).await?;
    let title = query
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(book_title);
    let author = match query.author.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Some(value.to_string()),
        Some(_) => None, // explicit empty author = search without author filter
        None => book_author,
    };
    // Calibre often stores authors "Last, First"; providers expect "First Last".
    let normalized_author = author.as_deref().map(normalize_author);

    // Primary search (title + author). If that yields nothing and an author was
    // used, retry title-only — author-format mismatches are a common miss.
    let mut all_matches =
        run_provider_search(&state, &title, normalized_author.as_deref()).await;
    if all_matches.is_empty() && normalized_author.is_some() {
        all_matches = run_provider_search(&state, &title, None).await;
    }

    let ranked = rank_matches(all_matches);
    let composite = best_composite(&ranked);

    // Cache each provider's results.
    for metadata_match in &ranked {
        let metadata_json = serde_json::to_string(&metadata_match.metadata)
            .unwrap_or_default();
        let _ = state
            .ironshelf_db
            .upsert_metadata_cache(
                &book_id.to_string(),
                &metadata_match.provider_name,
                Some(&metadata_match.external_id),
                &metadata_json,
            )
            .await;
    }

    Ok(Json(MetadataSearchResponse {
        book_id,
        matches: ranked,
        composite,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/v1/books/{id}/metadata/apply
// ---------------------------------------------------------------------------

/// Apply a selected metadata match (or direct overrides) to a book.
/// Stores in `book_overrides` — never mutates Calibre data.
pub async fn apply_metadata(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
    _auth_user: axum::Extension<AuthUser>,
    Json(request): Json<ApplyMetadataRequest>,
) -> Result<Json<ApplyMetadataResponse>, AppError> {
    let book_id_string = book_id.to_string();

    // Determine the metadata to apply: direct fields take precedence,
    // then fall back to a specific match_index from the cached search results.
    let override_title = request.title.clone();
    let override_description = request.description.clone();
    let override_cover_url = request.cover_url.clone();
    let override_tags = request.tags.clone();

    // If a match_index is provided and no direct overrides, use that match.
    if override_title.is_none()
        && override_description.is_none()
        && override_cover_url.is_none()
        && override_tags.is_none()
    {
        // Retrieve from cache and apply the Nth match.
        let cached_entries = state
            .ironshelf_db
            .get_all_metadata_cache(&book_id_string)
            .await
            .map_err(AppError::internal)?;

        if let Some(match_index) = request.match_index {
            if match_index >= cached_entries.len() {
                return Err(AppError::BadRequest(format!(
                    "match_index {} is out of range (have {} cached entries)",
                    match_index,
                    cached_entries.len()
                )));
            }

            let (_provider, metadata_json, _fetched_at) = &cached_entries[match_index];
            let metadata: BookMetadata = serde_json::from_str(metadata_json)
                .map_err(AppError::internal)?;

            let tags_json = if metadata.categories.is_empty() {
                None
            } else {
                Some(serde_json::to_string(&metadata.categories).unwrap_or_default())
            };

            state
                .ironshelf_db
                .upsert_book_override(
                    &book_id_string,
                    metadata.title.as_deref(),
                    metadata.description.as_deref(),
                    metadata.cover_url.as_deref(),
                    tags_json.as_deref(),
                )
                .await
                .map_err(AppError::internal)?;
        } else {
            // No match_index and no direct fields — apply composite from all cache.
            let all_metadata: Vec<BookMetadata> = cached_entries
                .iter()
                .filter_map(|(_provider, json_string, _timestamp)| {
                    serde_json::from_str(json_string).ok()
                })
                .collect();

            let ranked_matches: Vec<MetadataMatch> = all_metadata
                .into_iter()
                .enumerate()
                .map(|(index, metadata)| MetadataMatch {
                    provider_name: cached_entries[index].0.clone(),
                    external_id: String::new(),
                    confidence: 1.0 - (index as f64 * 0.1),
                    metadata,
                })
                .collect();

            if let Some(composite) = best_composite(&ranked_matches) {
                let tags_json = if composite.categories.is_empty() {
                    None
                } else {
                    Some(serde_json::to_string(&composite.categories).unwrap_or_default())
                };

                state
                    .ironshelf_db
                    .upsert_book_override(
                        &book_id_string,
                        composite.title.as_deref(),
                        composite.description.as_deref(),
                        composite.cover_url.as_deref(),
                        tags_json.as_deref(),
                    )
                    .await
                    .map_err(AppError::internal)?;
            } else {
                return Err(AppError::BadRequest(
                    "no cached metadata to apply; run search first".to_string(),
                ));
            }
        }
    } else {
        // Direct override fields provided.
        let tags_json = override_tags
            .as_ref()
            .map(|tags| serde_json::to_string(tags).unwrap_or_default());

        state
            .ironshelf_db
            .upsert_book_override(
                &book_id_string,
                override_title.as_deref(),
                override_description.as_deref(),
                override_cover_url.as_deref(),
                tags_json.as_deref(),
            )
            .await
            .map_err(AppError::internal)?;
    }

    // Best-effort write-back to Calibre (no-op unless enabled in settings).
    let calibre_updated = match crate::routes::calibre_writeback::push_overrides(&state, book_id).await
    {
        Ok(updated) => updated,
        Err(error) => {
            tracing::warn!("calibre write-back failed for book {book_id}: {error}");
            false
        }
    };

    Ok(Json(ApplyMetadataResponse {
        book_id,
        applied: true,
        calibre_updated,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/v1/libraries/{id}/metadata/scan
// ---------------------------------------------------------------------------

/// Scan a library for books missing descriptions, then attempt enrichment
/// from external providers. Returns a summary of results.
pub async fn bulk_metadata_scan(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
    _auth_user: axum::Extension<AuthUser>,
) -> Result<Json<BulkScanResponse>, AppError> {
    // Collect book data and author mappings while holding the lock, then drop it
    // before making external HTTP requests to avoid blocking library mutations.
    let (all_books, author_name_map) = {
        let libraries = state.libraries.read().await;
        let library = libraries
            .iter()
            .find(|library| library.id == library_id)
            .ok_or(AppError::not_found("library"))?;

        let all_books = library.source.all_books().await?;
        let authors = library.source.authors().await.unwrap_or_default();
        let author_name_map: std::collections::HashMap<i64, String> = authors
            .into_iter()
            .map(|author| (author.id, author.name))
            .collect();

        (all_books, author_name_map)
    };

    // Find books that are missing description.
    let books_needing_enrichment: Vec<_> = all_books
        .iter()
        .filter(|book| book.description.is_none() || book.description.as_deref() == Some(""))
        .collect();

    let books_missing_metadata = books_needing_enrichment.len() as i64;
    let mut books_enriched: i64 = 0;
    let mut errors: Vec<BulkScanBookError> = Vec::new();

    let google_provider = GoogleBooksProvider::with_client(&state.http_client);
    let open_library_provider = OpenLibraryProvider::with_client(&state.http_client);

    for book in &books_needing_enrichment {
        let primary_author = book.author_ids.first()
            .and_then(|author_id| author_name_map.get(author_id).cloned());

        let author_ref = primary_author.as_deref();

        let (google_result, open_library_result) = tokio::join!(
            google_provider.search(&book.title, author_ref),
            open_library_provider.search(&book.title, author_ref),
        );

        let mut all_matches: Vec<MetadataMatch> = Vec::new();

        if let Ok(matches) = google_result {
            all_matches.extend(matches);
        }
        if let Ok(matches) = open_library_result {
            all_matches.extend(matches);
        }

        if all_matches.is_empty() {
            errors.push(BulkScanBookError {
                book_id: book.id,
                title: book.title.clone(),
                error: "no results from any provider".to_string(),
            });
            continue;
        }

        let ranked = rank_matches(all_matches);

        // Cache results.
        for metadata_match in &ranked {
            let metadata_json = serde_json::to_string(&metadata_match.metadata).unwrap_or_default();
            let _ = state
                .ironshelf_db
                .upsert_metadata_cache(
                    &book.id.to_string(),
                    &metadata_match.provider_name,
                    Some(&metadata_match.external_id),
                    &metadata_json,
                )
                .await;
        }

        // Auto-apply the best composite if it has a description.
        if let Some(composite) = best_composite(&ranked) {
            if composite.description.is_some() {
                let tags_json = if composite.categories.is_empty() {
                    None
                } else {
                    Some(serde_json::to_string(&composite.categories).unwrap_or_default())
                };

                match state
                    .ironshelf_db
                    .upsert_book_override(
                        &book.id.to_string(),
                        None, // Don't override title automatically.
                        composite.description.as_deref(),
                        composite.cover_url.as_deref(),
                        tags_json.as_deref(),
                    )
                    .await
                {
                    Ok(()) => books_enriched += 1,
                    Err(error) => {
                        errors.push(BulkScanBookError {
                            book_id: book.id,
                            title: book.title.clone(),
                            error: error.to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(Json(BulkScanResponse {
        library_id,
        books_missing_metadata,
        books_enriched,
        errors,
    }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Locate a book across all libraries and extract its title + primary author name.
async fn find_book_title_author(
    state: &AppState,
    book_id: i64,
) -> Result<(String, Option<String>), AppError> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            let primary_author = if let Some(first_id) = book.author_ids.first() {
                let authors = library.source.authors().await.unwrap_or_default();
                authors.iter().find(|author| author.id == *first_id).map(|author| author.name.clone())
            } else {
                None
            };
            return Ok((book.title, primary_author));
        }
    }

    Err(AppError::not_found("book"))
}
