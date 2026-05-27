//! Acquisition engine API routes — indexers, download clients, wanted list, downloads, search.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

// =========================================================================
// Shared response types
// =========================================================================

#[derive(Serialize)]
pub struct IndexerResponse {
    pub id: String,
    pub name: String,
    pub indexer_type: String,
    pub url: String,
    pub categories: Option<String>,
    pub is_enabled: bool,
    pub priority: i32,
    pub search_interval_minutes: i32,
    pub last_searched_at: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct DownloadClientResponse {
    pub id: String,
    pub name: String,
    pub client_type: String,
    pub host: String,
    pub port: i32,
    pub use_ssl: bool,
    pub download_directory: Option<String>,
    pub category: Option<String>,
    pub is_enabled: bool,
    pub priority: i32,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct WantedItemResponse {
    pub id: String,
    pub user_id: String,
    pub item_type: String,
    pub title: String,
    pub author_name: Option<String>,
    pub isbn: Option<String>,
    pub year: Option<String>,
    pub preferred_format: Option<String>,
    pub quality_profile: Option<String>,
    pub is_active: bool,
    pub is_fulfilled: bool,
    pub fulfilled_at: Option<String>,
    pub last_searched_at: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct DownloadResponse {
    pub id: String,
    pub wanted_item_id: Option<String>,
    pub indexer_id: Option<String>,
    pub download_client_id: Option<String>,
    pub title: String,
    pub download_url: String,
    pub magnet_url: Option<String>,
    pub torrent_hash: Option<String>,
    pub size_bytes: Option<i64>,
    pub status: String,
    pub progress_percent: f64,
    pub error_message: Option<String>,
    pub file_path: Option<String>,
    pub target_library_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// =========================================================================
// Indexers CRUD
// =========================================================================

/// GET /api/v1/indexers — list all indexers.
pub async fn list_indexers(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<IndexerResponse>>, AppError> {
    let indexers = state
        .ironshelf_db
        .list_indexers()
        .await
        .map_err(AppError::internal)?;

    let response: Vec<IndexerResponse> = indexers
        .into_iter()
        .map(|indexer| IndexerResponse {
            id: indexer.id,
            name: indexer.name,
            indexer_type: indexer.indexer_type,
            url: indexer.url,
            categories: indexer.categories,
            is_enabled: indexer.is_enabled,
            priority: indexer.priority,
            search_interval_minutes: indexer.search_interval_minutes,
            last_searched_at: indexer.last_searched_at,
            created_at: indexer.created_at,
        })
        .collect();

    Ok(Json(response))
}

#[derive(Deserialize)]
pub struct CreateIndexerRequest {
    pub name: String,
    pub indexer_type: String,
    pub url: String,
    pub api_key: Option<String>,
    pub categories: Option<String>,
    pub priority: Option<i32>,
    pub search_interval_minutes: Option<i32>,
}

/// POST /api/v1/indexers — add a new indexer.
pub async fn create_indexer(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Json(body): Json<CreateIndexerRequest>,
) -> Result<(StatusCode, Json<IndexerResponse>), AppError> {
    validate_indexer_type(&body.indexer_type)?;

    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Name is required".to_string()));
    }
    if body.url.trim().is_empty() {
        return Err(AppError::BadRequest("URL is required".to_string()));
    }
    if !body.url.starts_with("http://") && !body.url.starts_with("https://") {
        return Err(AppError::BadRequest(
            "URL must start with http:// or https://".to_string(),
        ));
    }

    let indexer_id = state
        .ironshelf_db
        .create_indexer(&ironshelf_core::db::CreateIndexerParams {
            name: &body.name,
            indexer_type: &body.indexer_type,
            url: &body.url,
            api_key: body.api_key.as_deref(),
            categories: body.categories.as_deref(),
            priority: body.priority,
            search_interval_minutes: body.search_interval_minutes,
        })
        .await
        .map_err(AppError::internal)?;

    let response = IndexerResponse {
        id: indexer_id,
        name: body.name,
        indexer_type: body.indexer_type,
        url: body.url,
        categories: body.categories,
        is_enabled: true,
        priority: body.priority.unwrap_or(50),
        search_interval_minutes: body.search_interval_minutes.unwrap_or(60),
        last_searched_at: None,
        created_at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    };

    Ok((StatusCode::CREATED, Json(response)))
}

#[derive(Deserialize)]
pub struct UpdateIndexerRequest {
    pub name: Option<String>,
    pub url: Option<String>,
    pub api_key: Option<String>,
    pub categories: Option<String>,
    pub is_enabled: Option<bool>,
    pub priority: Option<i32>,
    pub search_interval_minutes: Option<i32>,
}

/// PATCH /api/v1/indexers/:id — update an indexer.
pub async fn update_indexer(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(indexer_id): Path<String>,
    Json(body): Json<UpdateIndexerRequest>,
) -> Result<StatusCode, AppError> {
    // Verify exists.
    state
        .ironshelf_db
        .get_indexer(&indexer_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("indexer"))?;

    if let Some(ref url) = body.url {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(AppError::BadRequest(
                "URL must start with http:// or https://".to_string(),
            ));
        }
    }

    state
        .ironshelf_db
        .update_indexer(&ironshelf_core::db::UpdateIndexerParams {
            indexer_id: &indexer_id,
            name: body.name.as_deref(),
            url: body.url.as_deref(),
            api_key: body.api_key.as_deref(),
            categories: body.categories.as_deref(),
            is_enabled: body.is_enabled,
            priority: body.priority,
            search_interval_minutes: body.search_interval_minutes,
        })
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/indexers/:id — delete an indexer.
pub async fn delete_indexer(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(indexer_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .delete_indexer(&indexer_id)
        .await
        .map_err(|error| match error {
            ironshelf_core::db::DbError::NotFound => AppError::not_found("indexer"),
            other => AppError::internal(other),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/indexers/:id/test — test indexer connectivity.
pub async fn test_indexer(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(indexer_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let indexer = state
        .ironshelf_db
        .get_indexer(&indexer_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("indexer"))?;

    match ironshelf_core::acquisition::indexers::test_indexer_connection(
        &state.http_client,
        &indexer,
    )
    .await
    {
        Ok(()) => Ok(Json(serde_json::json!({
            "success": true,
            "message": "Indexer connection successful"
        }))),
        Err(connection_error) => Ok(Json(serde_json::json!({
            "success": false,
            "message": format!("Connection failed: {connection_error}")
        }))),
    }
}

// =========================================================================
// Download Clients CRUD
// =========================================================================

/// GET /api/v1/download-clients — list all download clients.
pub async fn list_download_clients(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<DownloadClientResponse>>, AppError> {
    let clients = state
        .ironshelf_db
        .list_download_clients()
        .await
        .map_err(AppError::internal)?;

    let response: Vec<DownloadClientResponse> = clients
        .into_iter()
        .map(|client| DownloadClientResponse {
            id: client.id,
            name: client.name,
            client_type: client.client_type,
            host: client.host,
            port: client.port,
            use_ssl: client.use_ssl,
            download_directory: client.download_directory,
            category: client.category,
            is_enabled: client.is_enabled,
            priority: client.priority,
            created_at: client.created_at,
        })
        .collect();

    Ok(Json(response))
}

#[derive(Deserialize)]
pub struct CreateDownloadClientRequest {
    pub name: String,
    pub client_type: String,
    pub host: String,
    pub port: i32,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_ssl: Option<bool>,
    pub download_directory: Option<String>,
    pub category: Option<String>,
}

/// POST /api/v1/download-clients — add a new download client.
pub async fn create_download_client(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Json(body): Json<CreateDownloadClientRequest>,
) -> Result<(StatusCode, Json<DownloadClientResponse>), AppError> {
    validate_client_type(&body.client_type)?;

    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Name is required".to_string()));
    }
    if body.host.trim().is_empty() {
        return Err(AppError::BadRequest("Host is required".to_string()));
    }

    let use_ssl = body.use_ssl.unwrap_or(false);

    let client_id = state
        .ironshelf_db
        .create_download_client(&ironshelf_core::db::CreateDownloadClientParams {
            name: &body.name,
            client_type: &body.client_type,
            host: &body.host,
            port: body.port,
            username: body.username.as_deref(),
            password: body.password.as_deref(),
            use_ssl,
            download_directory: body.download_directory.as_deref(),
            category: body.category.as_deref(),
        })
        .await
        .map_err(AppError::internal)?;

    let response = DownloadClientResponse {
        id: client_id,
        name: body.name,
        client_type: body.client_type,
        host: body.host,
        port: body.port,
        use_ssl,
        download_directory: body.download_directory,
        category: body.category,
        is_enabled: true,
        priority: 50,
        created_at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    };

    Ok((StatusCode::CREATED, Json(response)))
}

#[derive(Deserialize)]
pub struct UpdateDownloadClientRequest {
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_ssl: Option<bool>,
    pub download_directory: Option<String>,
    pub category: Option<String>,
    pub is_enabled: Option<bool>,
    pub priority: Option<i32>,
}

/// PATCH /api/v1/download-clients/:id — update a download client.
pub async fn update_download_client(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(client_id): Path<String>,
    Json(body): Json<UpdateDownloadClientRequest>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .get_download_client(&client_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("download client"))?;

    state
        .ironshelf_db
        .update_download_client(&ironshelf_core::db::UpdateDownloadClientParams {
            client_id: &client_id,
            name: body.name.as_deref(),
            host: body.host.as_deref(),
            port: body.port,
            username: body.username.as_deref(),
            password: body.password.as_deref(),
            use_ssl: body.use_ssl,
            download_directory: body.download_directory.as_deref(),
            category: body.category.as_deref(),
            is_enabled: body.is_enabled,
            priority: body.priority,
        })
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/download-clients/:id — delete a download client.
pub async fn delete_download_client(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(client_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .delete_download_client(&client_id)
        .await
        .map_err(|error| match error {
            ironshelf_core::db::DbError::NotFound => AppError::not_found("download client"),
            other => AppError::internal(other),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/download-clients/:id/test — test download client connectivity.
pub async fn test_download_client(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(client_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let client = state
        .ironshelf_db
        .get_download_client(&client_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("download client"))?;

    match ironshelf_core::acquisition::download_clients::test_client_connection(
        &state.http_client,
        &client,
    )
    .await
    {
        Ok(()) => Ok(Json(serde_json::json!({
            "success": true,
            "message": "Download client connection successful"
        }))),
        Err(connection_error) => Ok(Json(serde_json::json!({
            "success": false,
            "message": format!("Connection failed: {connection_error}")
        }))),
    }
}

// =========================================================================
// Wanted List
// =========================================================================

#[derive(Deserialize)]
pub struct WantedListQuery {
    pub active_only: Option<bool>,
}

/// GET /api/v1/wanted — list wanted items for the current user.
pub async fn list_wanted(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<WantedListQuery>,
) -> Result<Json<Vec<WantedItemResponse>>, AppError> {
    let active_only = query.active_only.unwrap_or(false);

    let items = state
        .ironshelf_db
        .list_wanted_items(&auth_user.user_id, active_only)
        .await
        .map_err(AppError::internal)?;

    let response: Vec<WantedItemResponse> = items
        .into_iter()
        .map(map_wanted_item_response)
        .collect();

    Ok(Json(response))
}

#[derive(Deserialize)]
pub struct CreateWantedItemRequest {
    pub item_type: String,
    pub title: String,
    pub author_name: Option<String>,
    pub isbn: Option<String>,
    pub year: Option<String>,
    pub preferred_format: Option<String>,
    pub quality_profile: Option<String>,
}

/// POST /api/v1/wanted — add a wanted item.
pub async fn create_wanted(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<CreateWantedItemRequest>,
) -> Result<(StatusCode, Json<WantedItemResponse>), AppError> {
    validate_item_type(&body.item_type)?;

    if body.title.trim().is_empty() {
        return Err(AppError::BadRequest("Title is required".to_string()));
    }

    let wanted_item_id = state
        .ironshelf_db
        .create_wanted_item(&ironshelf_core::db::CreateWantedItemParams {
            user_id: &auth_user.user_id,
            item_type: &body.item_type,
            title: &body.title,
            author_name: body.author_name.as_deref(),
            isbn: body.isbn.as_deref(),
            year: body.year.as_deref(),
            preferred_format: body.preferred_format.as_deref(),
            quality_profile: body.quality_profile.as_deref(),
        })
        .await
        .map_err(AppError::internal)?;

    let response = WantedItemResponse {
        id: wanted_item_id,
        user_id: auth_user.user_id,
        item_type: body.item_type,
        title: body.title,
        author_name: body.author_name,
        isbn: body.isbn,
        year: body.year,
        preferred_format: body.preferred_format,
        quality_profile: body.quality_profile,
        is_active: true,
        is_fulfilled: false,
        fulfilled_at: None,
        last_searched_at: None,
        created_at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    };

    Ok((StatusCode::CREATED, Json(response)))
}

#[derive(Deserialize)]
pub struct UpdateWantedItemRequest {
    pub title: Option<String>,
    pub author_name: Option<String>,
    pub isbn: Option<String>,
    pub year: Option<String>,
    pub preferred_format: Option<String>,
    pub quality_profile: Option<String>,
    pub is_active: Option<bool>,
}

/// PATCH /api/v1/wanted/:id — update a wanted item.
pub async fn update_wanted(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(wanted_item_id): Path<String>,
    Json(body): Json<UpdateWantedItemRequest>,
) -> Result<StatusCode, AppError> {
    let item = state
        .ironshelf_db
        .get_wanted_item(&wanted_item_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("wanted item"))?;

    if item.user_id != auth_user.user_id && !auth_user.is_owner {
        return Err(AppError::Forbidden(
            "You do not own this wanted item".to_string(),
        ));
    }

    state
        .ironshelf_db
        .update_wanted_item(&ironshelf_core::db::UpdateWantedItemParams {
            wanted_item_id: &wanted_item_id,
            title: body.title.as_deref(),
            author_name: body.author_name.as_deref(),
            isbn: body.isbn.as_deref(),
            year: body.year.as_deref(),
            preferred_format: body.preferred_format.as_deref(),
            quality_profile: body.quality_profile.as_deref(),
            is_active: body.is_active,
        })
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/wanted/:id — delete a wanted item.
pub async fn delete_wanted(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(wanted_item_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let item = state
        .ironshelf_db
        .get_wanted_item(&wanted_item_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("wanted item"))?;

    if item.user_id != auth_user.user_id && !auth_user.is_owner {
        return Err(AppError::Forbidden(
            "You do not own this wanted item".to_string(),
        ));
    }

    state
        .ironshelf_db
        .delete_wanted_item(&wanted_item_id)
        .await
        .map_err(|error| match error {
            ironshelf_core::db::DbError::NotFound => AppError::not_found("wanted item"),
            other => AppError::internal(other),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/wanted/:id/search — manually trigger a search for a wanted item.
pub async fn search_wanted_item(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(wanted_item_id): Path<String>,
) -> Result<Json<Vec<ironshelf_core::acquisition::SearchResult>>, AppError> {
    let wanted_item = state
        .ironshelf_db
        .get_wanted_item(&wanted_item_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("wanted item"))?;

    let indexers = state
        .ironshelf_db
        .list_enabled_indexers()
        .await
        .map_err(AppError::internal)?;

    if indexers.is_empty() {
        return Err(AppError::BadRequest(
            "No enabled indexers configured".to_string(),
        ));
    }

    let results = ironshelf_core::acquisition::search::search_all_indexers(
        &state.http_client,
        &indexers,
        &wanted_item.title,
        wanted_item.author_name.as_deref(),
    )
    .await;

    // Update last_searched_at.
    let _ = state
        .ironshelf_db
        .touch_wanted_item_searched(&wanted_item_id)
        .await;

    Ok(Json(results))
}

#[derive(Deserialize)]
pub struct GrabRequest {
    pub download_url: String,
    pub magnet_url: Option<String>,
    pub indexer_id: Option<String>,
    pub download_client_id: Option<String>,
    pub target_library_id: Option<String>,
    pub title: Option<String>,
    pub size_bytes: Option<i64>,
}

/// POST /api/v1/wanted/:id/grab — grab a specific search result for a wanted item.
pub async fn grab_wanted_item(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(wanted_item_id): Path<String>,
    Json(body): Json<GrabRequest>,
) -> Result<(StatusCode, Json<DownloadResponse>), AppError> {
    let wanted_item = state
        .ironshelf_db
        .get_wanted_item(&wanted_item_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("wanted item"))?;

    let download_response = initiate_grab(
        &state,
        Some(&wanted_item_id),
        body,
        Some(&wanted_item.title),
    )
    .await?;

    Ok((StatusCode::CREATED, Json(download_response)))
}

// =========================================================================
// Downloads
// =========================================================================

#[derive(Deserialize)]
pub struct DownloadListQuery {
    pub status: Option<String>,
    pub limit: Option<i64>,
}

/// GET /api/v1/downloads — list downloads.
pub async fn list_downloads(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Query(query): Query<DownloadListQuery>,
) -> Result<Json<Vec<DownloadResponse>>, AppError> {
    let limit = query.limit.unwrap_or(50).max(1).min(200);

    let downloads = state
        .ironshelf_db
        .list_downloads(query.status.as_deref(), limit)
        .await
        .map_err(AppError::internal)?;

    let response: Vec<DownloadResponse> = downloads
        .into_iter()
        .map(map_download_response)
        .collect();

    Ok(Json(response))
}

/// GET /api/v1/downloads/:id — get a single download's details.
pub async fn get_download(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(download_id): Path<String>,
) -> Result<Json<DownloadResponse>, AppError> {
    let download = state
        .ironshelf_db
        .get_download(&download_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("download"))?;

    Ok(Json(map_download_response(download)))
}

/// DELETE /api/v1/downloads/:id — cancel/remove a download.
pub async fn delete_download(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(download_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .delete_download(&download_id)
        .await
        .map_err(|error| match error {
            ironshelf_core::db::DbError::NotFound => AppError::not_found("download"),
            other => AppError::internal(other),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/downloads/:id/retry — retry a failed download.
pub async fn retry_download(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Path(download_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let download = state
        .ironshelf_db
        .get_download(&download_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("download"))?;

    if download.status != "failed" {
        return Err(AppError::BadRequest(
            "Only failed downloads can be retried".to_string(),
        ));
    }

    // Reset status to pending so the download monitor picks it up.
    state
        .ironshelf_db
        .update_download_status(&download_id, "pending", 0.0, None)
        .await
        .map_err(AppError::internal)?;

    // Attempt to re-add to the download client.
    let download_client = if let Some(ref client_id) = download.download_client_id {
        state
            .ironshelf_db
            .get_download_client(client_id)
            .await
            .map_err(AppError::internal)?
    } else {
        state
            .ironshelf_db
            .get_default_download_client()
            .await
            .map_err(AppError::internal)?
    };

    if let Some(client_config) = download_client {
        match ironshelf_core::acquisition::download_clients::add_download(
            &state.http_client,
            &client_config,
            &download.download_url,
            download.magnet_url.as_deref(),
        )
        .await
        {
            Ok(_external_identifier) => {
                state
                    .ironshelf_db
                    .update_download_status(&download_id, "downloading", 0.0, None)
                    .await
                    .map_err(AppError::internal)?;
            }
            Err(client_error) => {
                state
                    .ironshelf_db
                    .update_download_status(
                        &download_id,
                        "failed",
                        0.0,
                        Some(&client_error.to_string()),
                    )
                    .await
                    .map_err(AppError::internal)?;

                return Err(AppError::Internal(format!(
                    "retry failed: {client_error}"
                )));
            }
        }
    }

    Ok(Json(serde_json::json!({
        "retried": true,
        "download_id": download_id,
    })))
}

// =========================================================================
// Global search + grab
// =========================================================================

#[derive(Deserialize)]
pub struct AcquisitionSearchQuery {
    pub q: String,
    pub author: Option<String>,
}

/// GET /api/v1/acquisition/search — search all indexers.
pub async fn acquisition_search(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Query(query): Query<AcquisitionSearchQuery>,
) -> Result<Json<Vec<ironshelf_core::acquisition::SearchResult>>, AppError> {
    if query.q.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Search query (q) is required".to_string(),
        ));
    }

    let indexers = state
        .ironshelf_db
        .list_enabled_indexers()
        .await
        .map_err(AppError::internal)?;

    if indexers.is_empty() {
        return Err(AppError::BadRequest(
            "No enabled indexers configured".to_string(),
        ));
    }

    let results = ironshelf_core::acquisition::search::search_all_indexers(
        &state.http_client,
        &indexers,
        &query.q,
        query.author.as_deref(),
    )
    .await;

    Ok(Json(results))
}

/// POST /api/v1/acquisition/grab — grab a search result for download.
pub async fn acquisition_grab(
    State(state): State<AppState>,
    Extension(_auth_user): Extension<AuthUser>,
    Json(body): Json<GrabRequest>,
) -> Result<(StatusCode, Json<DownloadResponse>), AppError> {
    let download_response = initiate_grab(&state, None, body, None).await?;
    Ok((StatusCode::CREATED, Json(download_response)))
}

// =========================================================================
// Internal helpers
// =========================================================================

/// Initiate a download grab — sends to download client and creates DB record.
async fn initiate_grab(
    state: &AppState,
    wanted_item_id: Option<&str>,
    body: GrabRequest,
    fallback_title: Option<&str>,
) -> Result<DownloadResponse, AppError> {
    if body.download_url.trim().is_empty() {
        return Err(AppError::BadRequest(
            "download_url is required".to_string(),
        ));
    }

    let title = body
        .title
        .as_deref()
        .or(fallback_title)
        .unwrap_or("Unknown");

    // Resolve download client.
    let download_client = if let Some(ref client_id) = body.download_client_id {
        state
            .ironshelf_db
            .get_download_client(client_id)
            .await
            .map_err(AppError::internal)?
            .ok_or(AppError::not_found("download client"))?
    } else {
        state
            .ironshelf_db
            .get_default_download_client()
            .await
            .map_err(AppError::internal)?
            .ok_or(AppError::BadRequest(
                "No download client specified and no default enabled client found".to_string(),
            ))?
    };

    // Create the download record.
    let download_id = state
        .ironshelf_db
        .create_download(&ironshelf_core::db::CreateDownloadParams {
            wanted_item_id,
            indexer_id: body.indexer_id.as_deref(),
            download_client_id: Some(&download_client.id),
            title,
            download_url: &body.download_url,
            magnet_url: body.magnet_url.as_deref(),
            torrent_hash: None,
            size_bytes: body.size_bytes,
            target_library_id: body.target_library_id.as_deref(),
        })
        .await
        .map_err(AppError::internal)?;

    // Send to download client.
    let torrent_hash = match ironshelf_core::acquisition::download_clients::add_download(
        &state.http_client,
        &download_client,
        &body.download_url,
        body.magnet_url.as_deref(),
    )
    .await
    {
        Ok(external_identifier) => {
            state
                .ironshelf_db
                .update_download_status(&download_id, "downloading", 0.0, None)
                .await
                .map_err(AppError::internal)?;
            Some(external_identifier)
        }
        Err(client_error) => {
            state
                .ironshelf_db
                .update_download_status(
                    &download_id,
                    "failed",
                    0.0,
                    Some(&client_error.to_string()),
                )
                .await
                .map_err(AppError::internal)?;

            tracing::error!("grab failed for '{}': {client_error}", title);
            None
        }
    };

    let now_string = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let initial_status = if torrent_hash.is_some() {
        "downloading".to_string()
    } else {
        "failed".to_string()
    };

    Ok(DownloadResponse {
        id: download_id,
        wanted_item_id: wanted_item_id.map(String::from),
        indexer_id: body.indexer_id,
        download_client_id: Some(download_client.id),
        title: title.to_string(),
        download_url: body.download_url,
        magnet_url: body.magnet_url,
        torrent_hash,
        size_bytes: body.size_bytes,
        status: initial_status,
        progress_percent: 0.0,
        error_message: None,
        file_path: None,
        target_library_id: body.target_library_id,
        created_at: now_string.clone(),
        updated_at: now_string,
    })
}

fn validate_indexer_type(indexer_type: &str) -> Result<(), AppError> {
    const VALID_INDEXER_TYPES: &[&str] = &["torznab", "newznab", "rss", "custom"];
    if !VALID_INDEXER_TYPES.contains(&indexer_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid indexer_type: {indexer_type}. Valid types: {}",
            VALID_INDEXER_TYPES.join(", ")
        )));
    }
    Ok(())
}

fn validate_client_type(client_type: &str) -> Result<(), AppError> {
    const VALID_CLIENT_TYPES: &[&str] =
        &["qbittorrent", "transmission", "deluge", "rtorrent", "direct"];
    if !VALID_CLIENT_TYPES.contains(&client_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid client_type: {client_type}. Valid types: {}",
            VALID_CLIENT_TYPES.join(", ")
        )));
    }
    Ok(())
}

fn validate_item_type(item_type: &str) -> Result<(), AppError> {
    const VALID_ITEM_TYPES: &[&str] = &["book", "author", "series"];
    if !VALID_ITEM_TYPES.contains(&item_type) {
        return Err(AppError::BadRequest(format!(
            "Invalid item_type: {item_type}. Valid types: {}",
            VALID_ITEM_TYPES.join(", ")
        )));
    }
    Ok(())
}

fn map_wanted_item_response(
    item: ironshelf_core::db::StoredWantedItem,
) -> WantedItemResponse {
    WantedItemResponse {
        id: item.id,
        user_id: item.user_id,
        item_type: item.item_type,
        title: item.title,
        author_name: item.author_name,
        isbn: item.isbn,
        year: item.year,
        preferred_format: item.preferred_format,
        quality_profile: item.quality_profile,
        is_active: item.is_active,
        is_fulfilled: item.is_fulfilled,
        fulfilled_at: item.fulfilled_at,
        last_searched_at: item.last_searched_at,
        created_at: item.created_at,
    }
}

fn map_download_response(
    download: ironshelf_core::db::StoredDownload,
) -> DownloadResponse {
    DownloadResponse {
        id: download.id,
        wanted_item_id: download.wanted_item_id,
        indexer_id: download.indexer_id,
        download_client_id: download.download_client_id,
        title: download.title,
        download_url: download.download_url,
        magnet_url: download.magnet_url,
        torrent_hash: download.torrent_hash,
        size_bytes: download.size_bytes,
        status: download.status,
        progress_percent: download.progress_percent,
        error_message: download.error_message,
        file_path: download.file_path,
        target_library_id: download.target_library_id,
        created_at: download.created_at,
        updated_at: download.updated_at,
    }
}
