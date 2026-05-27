use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use ironshelf_core::calibre::CalibreSource;
use ironshelf_core::model::{LibraryType, SourceKind};
use ironshelf_core::scan::FolderSource;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::AppError;
use crate::state::{AppState, LibrarySource, LoadedLibrary};

#[derive(Serialize)]
pub struct LibrarySummary {
    pub id: String,
    pub name: String,
    pub library_type: String,
    pub source_kind: String,
}

#[derive(Serialize)]
pub struct LibraryDetail {
    #[serde(flatten)]
    pub summary: LibrarySummary,
    pub custom_columns: Vec<ironshelf_core::model::CustomColumn>,
}

/// Request body for creating a library. Type selection is required.
#[derive(Deserialize)]
pub struct CreateLibraryRequest {
    pub name: String,
    /// Required: what kind of content (book, fanfiction, comic, manga, etc.)
    pub library_type: LibraryType,
    /// Source kind (calibre or folder)
    pub source_kind: SourceKind,
    /// Path to library on disk (Calibre dir or folder root)
    pub path: String,
    /// Type-specific options (JSON object, varies by library_type)
    pub options: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct UpdateLibraryRequest {
    pub name: Option<String>,
    pub library_type: Option<String>,
    pub options: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct CreateLibraryResponse {
    pub id: String,
    pub name: String,
    pub library_type: String,
}

/// GET /api/v1/libraries
pub async fn list_libraries(State(state): State<AppState>) -> Json<Vec<LibrarySummary>> {
    let libraries = state.libraries.read().await;
    let summaries = libraries
        .iter()
        .map(|library| LibrarySummary {
            id: library.id.clone(),
            name: library.name.clone(),
            library_type: library.library_type.clone(),
            source_kind: library.source_kind.clone(),
        })
        .collect();
    Json(summaries)
}

/// GET /api/v1/libraries/:id
pub async fn get_library(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<Json<LibraryDetail>, AppError> {
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(AppError::not_found("library"))?;

    let custom_columns = library.source.custom_columns().await;

    Ok(Json(LibraryDetail {
        summary: LibrarySummary {
            id: library.id.clone(),
            name: library.name.clone(),
            library_type: library.library_type.clone(),
            source_kind: library.source_kind.clone(),
        },
        custom_columns,
    }))
}

/// POST /api/v1/libraries — create a new library (requires type selection)
pub async fn create_library(
    State(state): State<AppState>,
    Json(request): Json<CreateLibraryRequest>,
) -> Result<(StatusCode, Json<CreateLibraryResponse>), AppError> {
    let options_str = request.options.as_ref().map(|v| v.to_string());

    // Validate path exists on disk (use async fs to avoid blocking the runtime)
    let library_path = std::path::PathBuf::from(&request.path);
    let path_metadata = tokio::fs::metadata(&library_path)
        .await
        .map_err(|_| AppError::UnprocessableEntity(
            "specified path does not exist on disk".to_string(),
        ))?;

    if !path_metadata.is_dir() {
        return Err(AppError::UnprocessableEntity(
            "specified path is not a directory".to_string(),
        ));
    }

    // Validate metadata.db presence for Calibre sources
    if matches!(request.source_kind, SourceKind::Calibre) {
        let metadata_path = library_path.join("metadata.db");
        if tokio::fs::metadata(&metadata_path).await.is_err() {
            return Err(AppError::UnprocessableEntity(
                "no metadata.db found at the specified path".to_string(),
            ));
        }
    }

    // Store in DB
    let library_id = state
        .ironshelf_db
        .create_library(
            &request.name,
            request.library_type,
            request.source_kind,
            &request.path,
            options_str.as_deref(),
        )
        .await
        .map_err(|error| AppError::Internal(format!("failed to save library: {error}")))?;

    // Open the source and add to live state
    let library_type_str = serde_json::to_string(&request.library_type)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();
    let source_kind_str = serde_json::to_string(&request.source_kind)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();

    let source = match request.source_kind {
        SourceKind::Calibre => CalibreSource::open(&request.path)
            .await
            .map(LibrarySource::Calibre)
            .map_err(|e| e.to_string()),
        SourceKind::Folder => FolderSource::open(&request.path)
            .await
            .map(|s| LibrarySource::Folder(Arc::new(RwLock::new(s))))
            .map_err(|e| e.to_string()),
    };

    match source {
        Ok(source) => {
            let mut libraries = state.libraries.write().await;
            libraries.push(LoadedLibrary {
                id: library_id.clone(),
                name: request.name.clone(),
                library_type: library_type_str.clone(),
                source_kind: source_kind_str,
                source,
            });
        }
        Err(error) => {
            tracing::error!("library created in DB but failed to open source: {error}");
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(CreateLibraryResponse {
            id: library_id,
            name: request.name,
            library_type: library_type_str,
        }),
    ))
}

/// PATCH /api/v1/libraries/:id — update library settings
pub async fn update_library(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
    Json(request): Json<UpdateLibraryRequest>,
) -> Result<StatusCode, AppError> {
    let options_str = request.options.as_ref().map(|v| v.to_string());

    state
        .ironshelf_db
        .update_library(
            &library_id,
            request.name.as_deref(),
            request.library_type.as_deref(),
            options_str.as_deref(),
        )
        .await
        .map_err(|error| AppError::Internal(format!("failed to update library: {error}")))?;

    // Update live state
    if let Some(name) = &request.name {
        let mut libraries = state.libraries.write().await;
        if let Some(library) = libraries.iter_mut().find(|l| l.id == library_id) {
            library.name = name.clone();
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/libraries/:id — remove a library
pub async fn delete_library(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .delete_library(&library_id)
        .await
        .map_err(|error| AppError::Internal(format!("failed to delete library: {error}")))?;

    // Remove from live state
    let mut libraries = state.libraries.write().await;
    libraries.retain(|l| l.id != library_id);

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/libraries/:id/scan — rescan/reindex a library
pub async fn scan_library(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<StatusCode, AppError> {
    // Clone the folder source Arc so we can drop the libraries lock before scanning.
    let folder_source = {
        let libraries = state.libraries.read().await;
        let library = libraries
            .iter()
            .find(|l| l.id == library_id)
            .ok_or(AppError::not_found("library"))?;

        // Folder source: rescan directory tree. Calibre: no-op (metadata.db is truth).
        match library.source {
            LibrarySource::Folder(ref folder) => Some(Arc::clone(folder)),
            LibrarySource::Calibre(_) => None,
        }
    };

    if let Some(folder) = folder_source {
        let mut source = folder.write().await;
        source
            .scan()
            .await
            .map_err(|error| AppError::Internal(format!("scan failed: {error}")))?;
    }

    Ok(StatusCode::ACCEPTED)
}
