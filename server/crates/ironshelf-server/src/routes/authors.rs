use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::pagination::{Paginated, PaginationParams, SortDirection, SortParams};
use crate::state::AppState;

/// cloud_config key for the "download author photos" toggle. Defaults to
/// enabled unless explicitly set to "false".
pub const AUTHOR_IMAGES_SETTING_KEY: &str = "author_images_enabled";

/// Whether author-photo fetching/serving is enabled (default: true).
pub async fn author_images_enabled(state: &AppState) -> bool {
    state
        .ironshelf_db
        .get_cloud_config(AUTHOR_IMAGES_SETTING_KEY)
        .await
        .ok()
        .flatten()
        .map(|value| value != "false")
        .unwrap_or(true)
}

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

/// Resolve an author's display name by id across all loaded libraries.
async fn author_name_by_id(state: &AppState, author_id: i64) -> Option<String> {
    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        if let Ok(authors) = library.source.authors().await {
            if let Some(author) = authors.into_iter().find(|a| a.id == author_id) {
                return Some(author.name);
            }
        }
    }
    None
}

fn author_image_response(bytes: Vec<u8>, content_type: &str) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CACHE_CONTROL, "public, max-age=604800".to_string()),
        ],
        bytes,
    )
        .into_response()
}

/// Fetch an author portrait from Open Library. Returns (bytes, content_type)
/// or None when no portrait is available. Never errors — failures map to None.
/// Normalize "Last, First" (Calibre sort form) to "First Last" for searching.
fn normalize_author_name(name: &str) -> String {
    if let Some((last, first)) = name.split_once(',') {
        let first = first.trim();
        let last = last.trim();
        if !first.is_empty() && !last.is_empty() {
            return format!("{first} {last}");
        }
    }
    name.trim().to_string()
}

async fn fetch_author_photo(
    client: &reqwest::Client,
    name: &str,
) -> Option<(Vec<u8>, String)> {
    let query_name = normalize_author_name(name);
    // 1. Resolve the author's Open Library ID (OLID) by name.
    let search = client
        .get("https://openlibrary.org/search/authors.json")
        .query(&[("q", query_name.as_str())])
        .send()
        .await
        .map_err(|error| tracing::debug!("author photo: OL search failed for {name}: {error}"))
        .ok()?;
    if !search.status().is_success() {
        tracing::debug!("author photo: OL search {} for {name}", search.status());
        return None;
    }
    let search_json: serde_json::Value = search.json().await.ok()?;
    let olid = match search_json
        .get("docs")
        .and_then(|docs| docs.as_array())
        .and_then(|docs| docs.iter().find_map(|doc| doc.get("key").and_then(|key| key.as_str())))
    {
        Some(key) => key.to_string(),
        None => {
            tracing::debug!("author photo: no Open Library match for '{name}'");
            return None;
        }
    };

    // 2. Fetch the large portrait. `default=false` makes the CDN 404 instead of
    //    returning a blank placeholder when no image exists.
    let photo_url = format!(
        "https://covers.openlibrary.org/a/olid/{}-L.jpg?default=false",
        olid
    );
    let photo = client.get(&photo_url).send().await.ok()?;
    if !photo.status().is_success() {
        return None;
    }
    let content_type = photo
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    if !content_type.starts_with("image/") {
        return None;
    }
    let bytes = photo.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some((bytes.to_vec(), content_type))
}

/// GET /api/v1/authors/:id/photo
///
/// Serves a cached author portrait, fetching from Open Library on first request.
/// Returns 404 when the feature is disabled or no portrait is available.
pub async fn get_author_photo(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Response, AppError> {
    if !author_images_enabled(&state).await {
        return Err(AppError::not_found("author photo"));
    }

    let name = author_name_by_id(&state, author_id)
        .await
        .ok_or(AppError::not_found("author"))?;
    let author_key = name.trim().to_lowercase();

    // Serve from cache when present.
    if let Some(cached) = state
        .ironshelf_db
        .get_author_image(&author_key)
        .await
        .map_err(AppError::internal)?
    {
        if cached.not_found {
            return Err(AppError::not_found("author photo"));
        }
        if let Some(bytes) = cached.image {
            return Ok(author_image_response(bytes, &cached.content_type));
        }
    }

    // Fetch from upstream and cache the result (including "not found").
    match fetch_author_photo(&state.http_client, &name).await {
        Some((bytes, content_type)) => {
            let _ = state
                .ironshelf_db
                .set_author_image(&author_key, Some(bytes.as_slice()), &content_type, false)
                .await;
            Ok(author_image_response(bytes, &content_type))
        }
        None => {
            let _ = state
                .ironshelf_db
                .set_author_image(&author_key, None, "image/jpeg", true)
                .await;
            Err(AppError::not_found("author photo"))
        }
    }
}

#[derive(Deserialize)]
pub struct PrefetchPhotosParams {
    /// When true, clear the cache first and re-fetch every author (recovers
    /// from "not found" entries cached while the network was unavailable).
    pub refresh: Option<bool>,
}

/// POST /api/v1/authors/photos/prefetch — fetch + cache portraits for every
/// author in the background. Owner only. Returns immediately with the count.
pub async fn prefetch_author_photos(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(params): Query<PrefetchPhotosParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !auth_user.is_owner {
        return Err(AppError::Forbidden(
            "Only the server owner can do this".to_string(),
        ));
    }
    if !author_images_enabled(&state).await {
        return Err(AppError::BadRequest(
            "Author photos are disabled — enable them first".to_string(),
        ));
    }

    // Collect unique author names across all libraries.
    let mut names: Vec<String> = Vec::new();
    {
        let libraries = state.libraries.read().await;
        let mut seen = std::collections::HashSet::new();
        for library in libraries.iter() {
            if let Ok(authors) = library.source.authors().await {
                for author in authors {
                    let key = author.name.trim().to_lowercase();
                    if !key.is_empty() && seen.insert(key) {
                        names.push(author.name);
                    }
                }
            }
        }
    }

    let total = names.len();
    let refresh = params.refresh.unwrap_or(false);
    let task_state = state.clone();
    let task_id = state
        .tasks
        .start("author_photos", "Downloading author photos", total as u64);

    // Run in the background — fetching hundreds of portraits would exceed
    // request/proxy timeouts. Photos appear as they're cached.
    tokio::spawn(async move {
        if refresh {
            let _ = task_state.ironshelf_db.clear_author_images().await;
        }
        let mut fetched = 0usize;
        let mut processed = 0u64;
        for name in names {
            let key = name.trim().to_lowercase();
            let already = !refresh
                && matches!(task_state.ironshelf_db.get_author_image(&key).await, Ok(Some(_)));
            if !already {
                match fetch_author_photo(&task_state.http_client, &name).await {
                    Some((bytes, content_type)) => {
                        let _ = task_state
                            .ironshelf_db
                            .set_author_image(&key, Some(bytes.as_slice()), &content_type, false)
                            .await;
                        fetched += 1;
                    }
                    None => {
                        let _ = task_state
                            .ironshelf_db
                            .set_author_image(&key, None, "image/jpeg", true)
                            .await;
                    }
                }
                // Be gentle with Open Library.
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            }
            processed += 1;
            task_state.tasks.set_progress(&task_id, processed);
        }
        task_state.tasks.finish(
            &task_id,
            "completed",
            Some(format!("{fetched} portraits fetched of {total} authors")),
        );
        tracing::info!("author photo prefetch complete: {fetched} fetched of {total}");
    });

    Ok(Json(serde_json::json!({ "started": true, "total": total })))
}

/// GET /api/v1/server/tasks — list running + recent background tasks.
pub async fn list_background_tasks(
    State(state): State<AppState>,
) -> Json<Vec<crate::tasks::TaskInfo>> {
    Json(state.tasks.list())
}

#[derive(Serialize)]
pub struct ServerSettings {
    pub author_images_enabled: bool,
    /// Calibre write-back mode: "none" | "calibredb" | "content_server".
    pub calibre_writeback_mode: String,
    pub calibredb_path: String,
    pub calibre_cs_url: String,
    pub calibre_cs_username: String,
    pub calibre_cs_library_id: String,
    /// True if a Content Server password is stored (the value is never returned).
    pub calibre_cs_password_set: bool,
}

#[derive(Deserialize)]
pub struct UpdateServerSettings {
    pub author_images_enabled: Option<bool>,
    pub calibre_writeback_mode: Option<String>,
    pub calibredb_path: Option<String>,
    pub calibre_cs_url: Option<String>,
    pub calibre_cs_username: Option<String>,
    pub calibre_cs_password: Option<String>,
    pub calibre_cs_library_id: Option<String>,
}

/// Read a cloud_config string value, defaulting to empty.
async fn read_config(state: &AppState, key: &str) -> String {
    state
        .ironshelf_db
        .get_cloud_config(key)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

async fn build_server_settings(state: &AppState) -> ServerSettings {
    let mode = read_config(state, "calibre_writeback_mode").await;
    ServerSettings {
        author_images_enabled: author_images_enabled(state).await,
        calibre_writeback_mode: if mode.is_empty() { "none".to_string() } else { mode },
        calibredb_path: read_config(state, "calibredb_path").await,
        calibre_cs_url: read_config(state, "calibre_cs_url").await,
        calibre_cs_username: read_config(state, "calibre_cs_username").await,
        calibre_cs_library_id: read_config(state, "calibre_cs_library_id").await,
        calibre_cs_password_set: !read_config(state, "calibre_cs_password").await.is_empty(),
    }
}

/// GET /api/v1/server/settings — read server-wide feature toggles.
pub async fn get_server_settings(
    State(state): State<AppState>,
) -> Result<Json<ServerSettings>, AppError> {
    Ok(Json(build_server_settings(&state).await))
}

/// PUT /api/v1/server/settings — update server-wide feature toggles (owner only).
pub async fn update_server_settings(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<UpdateServerSettings>,
) -> Result<Json<ServerSettings>, AppError> {
    if !auth_user.is_owner {
        return Err(AppError::Forbidden(
            "Only the server owner can change settings".to_string(),
        ));
    }

    let db = &state.ironshelf_db;

    if let Some(enabled) = body.author_images_enabled {
        db.set_cloud_config(AUTHOR_IMAGES_SETTING_KEY, if enabled { "true" } else { "false" })
            .await
            .map_err(AppError::internal)?;
        if !enabled {
            let _ = db.clear_author_images().await;
        }
    }

    if let Some(mode) = &body.calibre_writeback_mode {
        let mode = mode.trim();
        if !["none", "calibredb", "content_server"].contains(&mode) {
            return Err(AppError::BadRequest(format!(
                "invalid calibre_writeback_mode: {mode}"
            )));
        }
        db.set_cloud_config("calibre_writeback_mode", mode)
            .await
            .map_err(AppError::internal)?;
    }

    for (key, value) in [
        ("calibredb_path", &body.calibredb_path),
        ("calibre_cs_url", &body.calibre_cs_url),
        ("calibre_cs_username", &body.calibre_cs_username),
        ("calibre_cs_library_id", &body.calibre_cs_library_id),
    ] {
        if let Some(value) = value {
            db.set_cloud_config(key, value.trim())
                .await
                .map_err(AppError::internal)?;
        }
    }

    // Only overwrite the password when a non-empty value is supplied, so the
    // UI can leave it blank to keep the existing one.
    if let Some(password) = &body.calibre_cs_password {
        if !password.is_empty() {
            db.set_cloud_config("calibre_cs_password", password)
                .await
                .map_err(AppError::internal)?;
        }
    }

    Ok(Json(build_server_settings(&state).await))
}
