//! Metadata enrichment endpoints — search external providers, apply overrides.

use axum::extract::{Path, State};
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
    _auth_user: axum::Extension<AuthUser>,
) -> Result<Json<MetadataSearchResponse>, AppError> {
    // Find the book across all libraries.
    let (title, author) = find_book_title_author(&state, book_id).await?;

    let author_ref = author.as_deref();

    // Query both providers concurrently.
    let google_provider = GoogleBooksProvider::new();
    let open_library_provider = OpenLibraryProvider::new();

    let (google_result, open_library_result) = tokio::join!(
        google_provider.search(&title, author_ref),
        open_library_provider.search(&title, author_ref),
    );

    let mut all_matches: Vec<MetadataMatch> = Vec::new();

    match google_result {
        Ok(matches) => all_matches.extend(matches),
        Err(error) => tracing::warn!("google books search failed for book {}: {}", book_id, error),
    }

    match open_library_result {
        Ok(matches) => all_matches.extend(matches),
        Err(error) => {
            tracing::warn!("open library search failed for book {}: {}", book_id, error)
        }
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
                .map_err(|error| AppError::internal(error))?;

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

    Ok(Json(ApplyMetadataResponse {
        book_id,
        applied: true,
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
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|library| library.id == library_id)
        .ok_or(AppError::not_found("library"))?;

    let all_books = library.source.all_books().await?;

    // Find books that are missing description.
    let books_needing_enrichment: Vec<_> = all_books
        .iter()
        .filter(|book| book.description.is_none() || book.description.as_deref() == Some(""))
        .collect();

    let books_missing_metadata = books_needing_enrichment.len() as i64;
    let mut books_enriched: i64 = 0;
    let mut errors: Vec<BulkScanBookError> = Vec::new();

    let google_provider = GoogleBooksProvider::new();
    let open_library_provider = OpenLibraryProvider::new();

    for book in &books_needing_enrichment {
        let primary_author = if !book.author_ids.is_empty() {
            // Resolve the first author name from the library source.
            let authors = library.source.authors().await.unwrap_or_default();
            authors
                .iter()
                .find(|author| author.id == book.author_ids[0])
                .map(|author| author.name.clone())
        } else {
            None
        };

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
            let primary_author = if !book.author_ids.is_empty() {
                let authors = library.source.authors().await.unwrap_or_default();
                authors
                    .iter()
                    .find(|author| author.id == book.author_ids[0])
                    .map(|author| author.name.clone())
            } else {
                None
            };
            return Ok((book.title, primary_author));
        }
    }

    Err(AppError::not_found("book"))
}
