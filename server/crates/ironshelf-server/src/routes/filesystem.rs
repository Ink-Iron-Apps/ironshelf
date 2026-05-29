//! Filesystem browsing endpoints for library path selection.
//!
//! Owner-only: exposes server directories so the admin can pick library paths
//! from the web UI without typing raw paths.

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::auth::{require_owner, AuthUser};
use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "is_dir")]
    pub is_directory: bool,
}

#[derive(Serialize)]
pub struct BrowseResponse {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub separator: String,
    pub entries: Vec<DirectoryEntry>,
    pub roots: Vec<String>,
}

#[derive(Serialize)]
pub struct ValidateResponse {
    pub valid: bool,
    pub path: String,
    pub is_directory: bool,
    pub has_metadata_db: bool,
}

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct BrowseQuery {
    pub path: Option<String>,
}

#[derive(Deserialize)]
pub struct ValidateQuery {
    pub path: String,
    pub source_kind: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Return the platform path separator as a string.
fn path_separator() -> String {
    std::path::MAIN_SEPARATOR.to_string()
}

/// Discover filesystem root paths.
///
/// On Windows this probes common drive letters (A-Z). On Unix it returns `/`.
fn discover_roots() -> Vec<String> {
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            let drive_path = Path::new(&drive);
            // Only include drives that actually exist and are accessible.
            if drive_path.exists() {
                roots.push(drive);
            }
        }
        if roots.is_empty() {
            roots.push("C:\\".to_string());
        }
        roots
    }

    #[cfg(not(windows))]
    {
        vec!["/".to_string()]
    }
}

/// Read directory entries, returning only directories (sorted alphabetically).
/// Silently skips entries that cannot be read (permission denied, broken symlinks).
async fn list_directories(directory_path: &Path) -> Vec<DirectoryEntry> {
    let mut entries: Vec<DirectoryEntry> = Vec::new();

    let mut read_directory = match tokio::fs::read_dir(directory_path).await {
        Ok(reader) => reader,
        Err(_) => return entries,
    };

    while let Ok(Some(entry)) = read_directory.next_entry().await {
        // Skip entries whose metadata we cannot read (permission denied, etc.)
        let metadata = match entry.metadata().await {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        if !metadata.is_dir() {
            continue;
        }

        let entry_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden directories on Unix (leading dot) — they are almost never
        // library paths and exposing them is a minor information-leak risk.
        #[cfg(not(windows))]
        if entry_name.starts_with('.') {
            continue;
        }

        let entry_path = entry.path();

        entries.push(DirectoryEntry {
            name: entry_name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory: true,
        });
    }

    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    entries
}

/// Validate that a path is safe to browse.
///
/// Returns `Ok(canonical)` if acceptable, `Err` with a user-facing message otherwise.
/// We canonicalize to prevent `..` traversal and verify the result is a directory
/// that the process can access.
fn validate_browse_path(raw_path: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(raw_path);

    // Canonicalize resolves symlinks and `..` components.
    let canonical = requested
        .canonicalize()
        .map_err(|_| "Path does not exist or is not accessible".to_string())?;

    if !canonical.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    Ok(canonical)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/v1/filesystem/browse?path=
///
/// Lists directories at the requested path (or filesystem roots when no path given).
/// Owner-only.
pub async fn browse_filesystem(
    State(_state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Query(query): Query<BrowseQuery>,
) -> Result<Json<BrowseResponse>, AppError> {
    require_owner(&current_user)?;

    let roots = discover_roots();
    let separator = path_separator();

    // No path provided → return roots as entries.
    let browse_path = match &query.path {
        Some(path_string) if !path_string.is_empty() => path_string.clone(),
        _ => {
            let root_entries: Vec<DirectoryEntry> = roots
                .iter()
                .map(|root| DirectoryEntry {
                    name: root.clone(),
                    path: root.clone(),
                    is_directory: true,
                })
                .collect();

            return Ok(Json(BrowseResponse {
                current_path: String::new(),
                parent_path: None,
                separator,
                entries: root_entries,
                roots,
            }));
        }
    };

    let canonical_path = validate_browse_path(&browse_path)
        .map_err(|message| AppError::BadRequest(message))?;

    let parent_path = canonical_path
        .parent()
        .map(|parent| parent.to_string_lossy().to_string());

    let entries = list_directories(&canonical_path).await;

    Ok(Json(BrowseResponse {
        current_path: canonical_path.to_string_lossy().to_string(),
        parent_path,
        separator,
        entries,
        roots,
    }))
}

/// GET /api/v1/filesystem/validate?path=&source_kind=calibre
///
/// Checks whether a path is a valid directory and, for Calibre sources, whether
/// it contains a `metadata.db` file.  Owner-only.
pub async fn validate_filesystem_path(
    State(_state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Query(query): Query<ValidateQuery>,
) -> Result<Json<ValidateResponse>, AppError> {
    require_owner(&current_user)?;

    let requested_path = PathBuf::from(&query.path);

    let metadata = match tokio::fs::metadata(&requested_path).await {
        Ok(metadata) => metadata,
        Err(_) => {
            return Ok(Json(ValidateResponse {
                valid: false,
                path: query.path,
                is_directory: false,
                has_metadata_db: false,
            }));
        }
    };

    let is_directory = metadata.is_dir();

    let has_metadata_db = if is_directory {
        let metadata_path = requested_path.join("metadata.db");
        tokio::fs::metadata(&metadata_path).await.is_ok()
    } else {
        false
    };

    let is_calibre = query
        .source_kind
        .as_deref()
        .map(|kind| kind == "calibre")
        .unwrap_or(false);

    let valid = is_directory && (!is_calibre || has_metadata_db);

    Ok(Json(ValidateResponse {
        valid,
        path: requested_path.to_string_lossy().to_string(),
        is_directory,
        has_metadata_db,
    }))
}
