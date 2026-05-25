//! Kobo Sync API endpoints.
//!
//! Implements the subset of Kobo's cloud sync protocol needed for Kobo e-readers
//! to discover, download, and sync reading progress with Ironshelf.
//!
//! Authentication is via a path-embedded API key (`{auth_token}` = `irs_<prefix>.<secret>`),
//! validated on every request using the same logic as Bearer auth.

use axum::extract::{Host, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::auth::validate_api_key;
use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

/// Validate the path-embedded auth token and return the authenticated user.
/// Kobo devices send the API key in the URL path rather than an Authorization header.
async fn authenticate_kobo_token(
    state: &AppState,
    auth_token: &str,
) -> Result<crate::auth::AuthUser, AppError> {
    let pool = state.ironshelf_db.pool();
    validate_api_key(pool, auth_token)
        .await
        .map_err(|_| AppError::Unauthorized("Invalid Kobo auth token".to_string()))
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/// A contributor role entry in Kobo book metadata.
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct KoboContributorRole {
    name: String,
}

/// A download URL entry for a specific format.
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct KoboDownloadUrl {
    format: String,
    size: u64,
    url: String,
}

/// Publisher information.
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct KoboPublisher {
    name: String,
}

/// Book metadata as expected by the Kobo device.
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct KoboBookMetadata {
    contributor_roles: Vec<KoboContributorRole>,
    description: String,
    download_urls: Vec<KoboDownloadUrl>,
    entitlement_id: String,
    language: String,
    publication_date: String,
    publisher: KoboPublisher,
    revision_id: String,
    title: String,
    work_id: String,
    cover_image_id: String,
}

/// A single book entitlement wrapper.
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct KoboBookEntitlement {
    book_metadata: KoboBookMetadata,
    book_metadata_last_modified: String,
}

/// Status information for an entitlement.
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct KoboStatusInfo {
    last_modified: String,
    status: String,
}

/// A complete entitlement entry in the sync response.
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct KoboEntitlement {
    book_entitlement: KoboBookEntitlement,
    status_info: KoboStatusInfo,
}

/// Reading state update from the Kobo device.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct KoboReadingStateUpdate {
    reading_states: Vec<KoboReadingState>,
}

/// A single reading state entry.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct KoboReadingState {
    current_bookmark: Option<KoboCurrentBookmark>,
}

/// Current bookmark data from Kobo.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct KoboCurrentBookmark {
    location: Option<KoboBookmarkLocation>,
    progress_percent: Option<f64>,
}

/// Bookmark location data.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct KoboBookmarkLocation {
    value: Option<String>,
    #[serde(rename = "Type")]
    location_type: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build the base URL from the Host header, defaulting to http.
/// In production behind a reverse proxy, the proxy should set X-Forwarded-Proto.
fn build_base_url(host: &str) -> String {
    // Strip port if present for protocol detection; always use http for Kobo devices
    // since TLS is typically terminated at the reverse proxy.
    format!("http://{host}")
}

/// Format a book ID as a Kobo entitlement ID.
fn entitlement_id(book_id: i64) -> String {
    format!("ironshelf-{book_id}")
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/// GET /kobo/{auth_token}/v1/initialization
///
/// Returns device/store configuration. The Kobo device calls this first to
/// discover image URL templates and other service endpoints.
pub async fn initialization(
    State(state): State<AppState>,
    Host(host): Host,
    Path(auth_token): Path<String>,
) -> Result<Json<Value>, AppError> {
    authenticate_kobo_token(&state, &auth_token).await?;

    let base_url = build_base_url(&host);

    Ok(Json(json!({
        "Resources": {
            "image_host": base_url,
            "image_url_quality_template": format!(
                "{base_url}/kobo/{auth_token}/v1/books/{{ImageId}}/image/{{Width}}/{{Height}}/{{Quality}}/image.jpg"
            ),
            "image_url_template": format!(
                "{base_url}/kobo/{auth_token}/v1/books/{{ImageId}}/image/{{Width}}/{{Height}}/false/image.jpg"
            )
        }
    })))
}

/// GET /kobo/{auth_token}/v1/library/sync
///
/// Returns an array of book entitlements representing the user's library.
/// The Kobo device uses this to discover available books and their download URLs.
pub async fn library_sync(
    State(state): State<AppState>,
    Host(host): Host,
    Path(auth_token): Path<String>,
) -> Result<Json<Vec<KoboEntitlement>>, AppError> {
    authenticate_kobo_token(&state, &auth_token).await?;

    let base_url = build_base_url(&host);
    let libraries = state.libraries.read().await;

    // Collect all authors across libraries for name resolution.
    let mut all_authors = Vec::new();
    for library in libraries.iter() {
        if let Ok(authors) = library.source.authors().await {
            all_authors.extend(authors);
        }
    }

    let mut entitlements = Vec::new();

    for library in libraries.iter() {
        let books = library.source.all_books().await.unwrap_or_default();

        for book in &books {
            // Only include books that have an EPUB format (Kobo reads EPUB).
            let epub_format = book.formats.iter().find(|format| {
                format.kind.eq_ignore_ascii_case("EPUB")
            });

            let epub_format = match epub_format {
                Some(format) => format,
                None => continue,
            };

            // Resolve author names from IDs.
            let contributor_roles: Vec<KoboContributorRole> = book
                .author_ids
                .iter()
                .filter_map(|author_id| {
                    all_authors
                        .iter()
                        .find(|author| author.id == *author_id)
                        .map(|author| KoboContributorRole {
                            name: author.name.clone(),
                        })
                })
                .collect();

            let language = book
                .languages
                .first()
                .cloned()
                .unwrap_or_else(|| "en".to_string());

            let publication_date = book
                .pubdate
                .map(|date| format!("{date}T00:00:00Z"))
                .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

            let last_modified = book
                .added_at
                .map(|timestamp| timestamp.to_rfc3339())
                .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

            let book_id = book.id;
            let file_size = epub_format.size.unwrap_or(0);

            let download_url = format!(
                "{base_url}/kobo/{auth_token}/v1/books/{book_id}/file/epub"
            );

            let entitlement = KoboEntitlement {
                book_entitlement: KoboBookEntitlement {
                    book_metadata: KoboBookMetadata {
                        contributor_roles,
                        description: book.description.clone().unwrap_or_default(),
                        download_urls: vec![KoboDownloadUrl {
                            format: "EPUB".to_string(),
                            size: file_size,
                            url: download_url,
                        }],
                        entitlement_id: entitlement_id(book_id),
                        language,
                        publication_date: publication_date.clone(),
                        publisher: KoboPublisher {
                            name: String::new(),
                        },
                        revision_id: format!("ironshelf-{book_id}-1"),
                        title: book.title.clone(),
                        work_id: entitlement_id(book_id),
                        cover_image_id: entitlement_id(book_id),
                    },
                    book_metadata_last_modified: last_modified.clone(),
                },
                status_info: KoboStatusInfo {
                    last_modified,
                    status: "Active".to_string(),
                },
            };

            entitlements.push(entitlement);
        }
    }

    Ok(Json(entitlements))
}

/// GET /kobo/{auth_token}/v1/library/tags
///
/// Returns Kobo shelf/tag data. Not implemented — returns an empty array.
pub async fn library_tags(
    State(state): State<AppState>,
    Path(auth_token): Path<String>,
) -> Result<Json<Vec<Value>>, AppError> {
    authenticate_kobo_token(&state, &auth_token).await?;
    Ok(Json(vec![]))
}

/// GET /kobo/{auth_token}/v1/books/{book_id}/file/{format}
///
/// Serve the book file. Reuses the same file-lookup logic as the main API
/// but authenticates via the path token instead of session/Bearer middleware.
pub async fn download_book(
    State(state): State<AppState>,
    Path((auth_token, book_id, requested_format)): Path<(String, i64, String)>,
) -> Result<Response, AppError> {
    authenticate_kobo_token(&state, &auth_token).await?;

    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            let format = book
                .formats
                .iter()
                .find(|format| format.kind.eq_ignore_ascii_case(&requested_format))
                .ok_or_else(|| {
                    AppError::NotFound(format!(
                        "Format '{}' not available for this book",
                        requested_format
                    ))
                })?;

            let file_path = library
                .source
                .format_path(&book.path, &format.file_name, &format.kind);

            let content_type = match format.kind.to_uppercase().as_str() {
                "EPUB" => "application/epub+zip",
                "PDF" => "application/pdf",
                "CBZ" => "application/x-cbz",
                "MOBI" => "application/x-mobipocket-ebook",
                _ => "application/octet-stream",
            };

            let filename = format!(
                "{}.{}",
                book.title.replace('/', "_"),
                format.kind.to_lowercase()
            );

            let bytes = tokio::fs::read(&file_path)
                .await
                .map_err(|_| AppError::not_found("book file"))?;

            let file_size = bytes.len();

            return Ok((
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type.to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{filename}\""),
                    ),
                    (header::CONTENT_LENGTH, file_size.to_string()),
                ],
                bytes,
            )
                .into_response());
        }
    }

    Err(AppError::not_found("book"))
}

/// GET /kobo/{auth_token}/v1/books/{book_id}/image/{width}/{height}/{quality}/image.jpg
///
/// Serve the book cover image. For now, serves the original cover without resizing.
/// The width/height/quality parameters are accepted but ignored.
pub async fn cover_image(
    State(state): State<AppState>,
    Path((auth_token, book_id_raw, _width, _height, _quality)): Path<(
        String,
        String,
        String,
        String,
        String,
    )>,
) -> Result<Response, AppError> {
    authenticate_kobo_token(&state, &auth_token).await?;

    // The book_id comes in as "ironshelf-{id}" from the CoverImageId template,
    // or as a raw numeric ID. Handle both.
    let book_id: i64 = book_id_raw
        .strip_prefix("ironshelf-")
        .unwrap_or(&book_id_raw)
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid book ID in cover request".to_string()))?;

    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            if !book.has_cover {
                return Err(AppError::not_found("cover"));
            }

            let cover_path = library
                .source
                .cover_path(&book.path)
                .ok_or(AppError::not_found("cover"))?;

            let bytes = tokio::fs::read(&cover_path)
                .await
                .map_err(|_| AppError::not_found("cover file"))?;

            return Ok((
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "image/jpeg".to_string()),
                    (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
                ],
                bytes,
            )
                .into_response());
        }
    }

    Err(AppError::not_found("book"))
}

/// PUT /kobo/{auth_token}/v1/library/{book_id}/state
///
/// Receive reading state updates from the Kobo device.
/// Stores progress percentage as reading progress in the Ironshelf database.
pub async fn update_reading_state(
    State(state): State<AppState>,
    Path((auth_token, book_id_raw)): Path<(String, String)>,
    Json(payload): Json<KoboReadingStateUpdate>,
) -> Result<Json<Value>, AppError> {
    let authenticated_user = authenticate_kobo_token(&state, &auth_token).await?;

    // The book_id may arrive as "ironshelf-{id}" or raw numeric.
    let book_id_str = book_id_raw
        .strip_prefix("ironshelf-")
        .unwrap_or(&book_id_raw);

    let pool = state.ironshelf_db.pool();
    let now = chrono::Utc::now().to_rfc3339();

    for reading_state in &payload.reading_states {
        let progress_percent = reading_state
            .current_bookmark
            .as_ref()
            .and_then(|bookmark| bookmark.progress_percent)
            .unwrap_or(0.0);

        let locator_value = reading_state
            .current_bookmark
            .as_ref()
            .and_then(|bookmark| bookmark.location.as_ref())
            .and_then(|location| location.value.clone());

        sqlx::query(
            "INSERT INTO reading_progress (user_id, book_id, format, locator, percent, updated_at) \
             VALUES (?, ?, 'EPUB', ?, ?, ?) \
             ON CONFLICT(user_id, book_id, format) DO UPDATE SET \
             locator = excluded.locator, percent = excluded.percent, updated_at = excluded.updated_at",
        )
        .bind(&authenticated_user.user_id)
        .bind(book_id_str)
        .bind(&locator_value)
        .bind(progress_percent)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|error| AppError::internal(error))?;
    }

    // Kobo expects a 200 with a JSON response acknowledging the update.
    Ok(Json(json!({
        "RequestResult": "Success"
    })))
}
