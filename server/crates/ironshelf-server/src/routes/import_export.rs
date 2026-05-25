//! Import/export endpoints for data portability.
//!
//! Export: reading progress, bookmarks, collections as JSON.
//! Import: merge exported data back in (upsert progress, dedup bookmarks, merge collections).
//! Library config backup: owner-only export/import of library configurations.

use axum::extract::State;
use axum::http::header;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::{require_owner, AuthUser};
use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Export envelope
// ---------------------------------------------------------------------------

/// Top-level export document wrapping all user data sections.
#[derive(Serialize, Deserialize)]
pub struct ExportDocument {
    pub version: u32,
    pub exported_at: String,
    pub user: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reading_progress: Vec<ExportedReadingProgress>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bookmarks: Vec<ExportedBookmark>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collections: Vec<ExportedCollection>,
}

/// Exported reading progress for one book+format pair.
#[derive(Serialize, Deserialize, Clone)]
pub struct ExportedReadingProgress {
    pub book_id: String,
    pub format: String,
    pub locator: Option<String>,
    pub percent: f64,
    pub updated_at: String,
}

/// Exported bookmark.
#[derive(Serialize, Deserialize, Clone)]
pub struct ExportedBookmark {
    pub book_id: String,
    pub locator: String,
    pub note: Option<String>,
    pub created_at: String,
}

/// Exported collection with its book references.
#[derive(Serialize, Deserialize, Clone)]
pub struct ExportedCollection {
    pub name: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub books: Vec<ExportedCollectionBook>,
}

/// A book entry within an exported collection.
#[derive(Serialize, Deserialize, Clone)]
pub struct ExportedCollectionBook {
    pub book_id: String,
    pub position: i64,
}

// ---------------------------------------------------------------------------
// Library config export/import types
// ---------------------------------------------------------------------------

/// Envelope for library configuration backup.
#[derive(Serialize, Deserialize)]
pub struct LibraryConfigExport {
    pub version: u32,
    pub exported_at: String,
    pub libraries: Vec<ExportedLibraryConfig>,
}

/// A single library configuration entry.
#[derive(Serialize, Deserialize, Clone)]
pub struct ExportedLibraryConfig {
    pub name: String,
    pub library_type: String,
    pub source_kind: String,
    pub path: String,
    pub options: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Import request / response
// ---------------------------------------------------------------------------

/// Response returned after an import operation completes.
#[derive(Serialize)]
pub struct ImportResult {
    pub reading_progress_upserted: u64,
    pub bookmarks_inserted: u64,
    pub bookmarks_skipped_duplicate: u64,
    pub collections_created: u64,
    pub collections_merged: u64,
    pub collection_books_added: u64,
}

/// Response returned after a library config import.
#[derive(Serialize)]
pub struct LibraryConfigImportResult {
    pub libraries_created: u64,
    pub libraries_skipped_duplicate: u64,
}

// ---------------------------------------------------------------------------
// Export handlers
// ---------------------------------------------------------------------------

/// GET /api/v1/export/reading-progress
pub async fn export_reading_progress(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<ExportedReadingProgress>>, AppError> {
    let pool = state.ironshelf_db.pool();

    let rows = sqlx::query(
        "SELECT book_id, format, locator, percent, updated_at \
         FROM reading_progress WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .bind(&user.user_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::internal)?;

    let progress_entries = rows
        .iter()
        .map(|row| ExportedReadingProgress {
            book_id: row.get("book_id"),
            format: row.get("format"),
            locator: row.get("locator"),
            percent: row.get("percent"),
            updated_at: row.get("updated_at"),
        })
        .collect();

    Ok(Json(progress_entries))
}

/// GET /api/v1/export/bookmarks
pub async fn export_bookmarks(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<ExportedBookmark>>, AppError> {
    let pool = state.ironshelf_db.pool();

    let rows = sqlx::query(
        "SELECT book_id, locator, note, created_at \
         FROM bookmarks WHERE user_id = ? ORDER BY created_at",
    )
    .bind(&user.user_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::internal)?;

    let bookmark_entries = rows
        .iter()
        .map(|row| ExportedBookmark {
            book_id: row.get("book_id"),
            locator: row.get("locator"),
            note: row.get("note"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(Json(bookmark_entries))
}

/// GET /api/v1/export/collections
pub async fn export_collections(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<ExportedCollection>>, AppError> {
    let pool = state.ironshelf_db.pool();

    // Fetch only the user's own collections (not others' public ones)
    let collection_rows = sqlx::query(
        "SELECT id, name, description, is_public \
         FROM collections WHERE user_id = ? ORDER BY name",
    )
    .bind(&user.user_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::internal)?;

    let mut exported_collections = Vec::with_capacity(collection_rows.len());

    for collection_row in &collection_rows {
        let collection_id: String = collection_row.get("id");

        let book_rows = sqlx::query(
            "SELECT book_id, position FROM collection_books \
             WHERE collection_id = ? ORDER BY position ASC",
        )
        .bind(&collection_id)
        .fetch_all(pool)
        .await
        .map_err(AppError::internal)?;

        let books = book_rows
            .iter()
            .map(|book_row| ExportedCollectionBook {
                book_id: book_row.get("book_id"),
                position: book_row.get("position"),
            })
            .collect();

        exported_collections.push(ExportedCollection {
            name: collection_row.get("name"),
            description: collection_row.get("description"),
            is_public: collection_row.get::<i32, _>("is_public") != 0,
            books,
        });
    }

    Ok(Json(exported_collections))
}

/// GET /api/v1/export/all — combined export with Content-Disposition attachment header.
pub async fn export_all(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<impl IntoResponse, AppError> {
    let now = chrono::Utc::now();

    // Gather all three sections
    let Json(reading_progress) = export_reading_progress(
        State(state.clone()),
        axum::Extension(user.clone()),
    )
    .await?;

    let Json(bookmarks) = export_bookmarks(
        State(state.clone()),
        axum::Extension(user.clone()),
    )
    .await?;

    let Json(collections) = export_collections(
        State(state.clone()),
        axum::Extension(user.clone()),
    )
    .await?;

    let document = ExportDocument {
        version: 1,
        exported_at: now.to_rfc3339(),
        user: user.username.clone(),
        reading_progress,
        bookmarks,
        collections,
    };

    let json_body =
        serde_json::to_string_pretty(&document).map_err(AppError::internal)?;

    let date_stamp = now.format("%Y-%m-%d");
    let filename = format!("ironshelf-export-{date_stamp}.json");

    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                "application/json".to_string(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        json_body,
    ))
}

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------

/// POST /api/v1/import — accept an export document and merge into user's data.
///
/// Merge rules:
/// - Reading progress: upsert — incoming row wins if its `updated_at` is newer.
/// - Bookmarks: insert only if no existing bookmark has the same (book_id, locator).
/// - Collections: create by name if it doesn't exist; merge books into existing.
pub async fn import_user_data(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Json(document): Json<ExportDocument>,
) -> Result<Json<ImportResult>, AppError> {
    if document.version != 1 {
        return Err(AppError::BadRequest(format!(
            "unsupported export version: {} (expected 1)",
            document.version
        )));
    }

    let pool = state.ironshelf_db.pool();
    let mut reading_progress_upserted: u64 = 0;
    let mut bookmarks_inserted: u64 = 0;
    let mut bookmarks_skipped_duplicate: u64 = 0;
    let mut collections_created: u64 = 0;
    let mut collections_merged: u64 = 0;
    let mut collection_books_added: u64 = 0;

    // --- Reading progress: upsert, newer wins ---
    for progress_entry in &document.reading_progress {
        // Check if an existing row has a newer timestamp
        let existing_row = sqlx::query(
            "SELECT updated_at FROM reading_progress \
             WHERE user_id = ? AND book_id = ? AND format = ?",
        )
        .bind(&user.user_id)
        .bind(&progress_entry.book_id)
        .bind(&progress_entry.format)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?;

        let should_upsert = match existing_row {
            Some(row) => {
                let existing_updated_at: String = row.get("updated_at");
                // Import wins if its timestamp is newer or equal
                progress_entry.updated_at >= existing_updated_at
            }
            None => true,
        };

        if should_upsert {
            sqlx::query(
                "INSERT INTO reading_progress (user_id, book_id, format, locator, percent, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?) \
                 ON CONFLICT(user_id, book_id, format) DO UPDATE SET \
                 locator = excluded.locator, percent = excluded.percent, updated_at = excluded.updated_at",
            )
            .bind(&user.user_id)
            .bind(&progress_entry.book_id)
            .bind(&progress_entry.format)
            .bind(&progress_entry.locator)
            .bind(progress_entry.percent)
            .bind(&progress_entry.updated_at)
            .execute(pool)
            .await
            .map_err(AppError::internal)?;

            reading_progress_upserted += 1;
        }
    }

    // --- Bookmarks: insert if not duplicate (same book_id + locator) ---
    for bookmark_entry in &document.bookmarks {
        let duplicate_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM bookmarks \
             WHERE user_id = ? AND book_id = ? AND locator = ?",
        )
        .bind(&user.user_id)
        .bind(&bookmark_entry.book_id)
        .bind(&bookmark_entry.locator)
        .fetch_one(pool)
        .await
        .map_err(AppError::internal)?;

        if duplicate_count > 0 {
            bookmarks_skipped_duplicate += 1;
            continue;
        }

        let bookmark_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO bookmarks (id, user_id, book_id, locator, note, created_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&bookmark_id)
        .bind(&user.user_id)
        .bind(&bookmark_entry.book_id)
        .bind(&bookmark_entry.locator)
        .bind(&bookmark_entry.note)
        .bind(&bookmark_entry.created_at)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

        bookmarks_inserted += 1;
    }

    // --- Collections: create if name doesn't exist, merge books ---
    for collection_entry in &document.collections {
        let trimmed_name = collection_entry.name.trim();
        if trimmed_name.is_empty() {
            continue;
        }

        // Look up existing collection by name for this user
        let existing_collection = sqlx::query(
            "SELECT id FROM collections WHERE user_id = ? AND name = ?",
        )
        .bind(&user.user_id)
        .bind(trimmed_name)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?;

        let collection_id = match existing_collection {
            Some(row) => {
                collections_merged += 1;
                row.get::<String, _>("id")
            }
            None => {
                let new_collection_id = uuid::Uuid::new_v4().to_string();
                sqlx::query(
                    "INSERT INTO collections (id, user_id, name, description, is_public) \
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(&new_collection_id)
                .bind(&user.user_id)
                .bind(trimmed_name)
                .bind(&collection_entry.description)
                .bind(collection_entry.is_public as i32)
                .execute(pool)
                .await
                .map_err(AppError::internal)?;

                collections_created += 1;
                new_collection_id
            }
        };

        // Merge books into the collection (skip existing book_id entries)
        for book_entry in &collection_entry.books {
            let already_exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM collection_books \
                 WHERE collection_id = ? AND book_id = ?",
            )
            .bind(&collection_id)
            .bind(&book_entry.book_id)
            .fetch_one(pool)
            .await
            .map_err(AppError::internal)?;

            if already_exists > 0 {
                continue;
            }

            sqlx::query(
                "INSERT INTO collection_books (collection_id, book_id, position) \
                 VALUES (?, ?, ?)",
            )
            .bind(&collection_id)
            .bind(&book_entry.book_id)
            .bind(book_entry.position)
            .execute(pool)
            .await
            .map_err(AppError::internal)?;

            collection_books_added += 1;
        }
    }

    Ok(Json(ImportResult {
        reading_progress_upserted,
        bookmarks_inserted,
        bookmarks_skipped_duplicate,
        collections_created,
        collections_merged,
        collection_books_added,
    }))
}

// ---------------------------------------------------------------------------
// Library config backup (owner only)
// ---------------------------------------------------------------------------

/// GET /api/v1/export/library-config — export all library configurations.
pub async fn export_library_config(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<impl IntoResponse, AppError> {
    require_owner(&user)?;

    let stored_libraries = state
        .ironshelf_db
        .list_libraries()
        .await
        .map_err(AppError::internal)?;

    let exported_libraries: Vec<ExportedLibraryConfig> = stored_libraries
        .into_iter()
        .map(|library| ExportedLibraryConfig {
            name: library.name,
            library_type: library.library_type,
            source_kind: library.source_kind,
            path: library.path,
            options: library
                .options_json
                .and_then(|json_string| serde_json::from_str(&json_string).ok()),
        })
        .collect();

    let document = LibraryConfigExport {
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        libraries: exported_libraries,
    };

    let json_body =
        serde_json::to_string_pretty(&document).map_err(AppError::internal)?;

    let date_stamp = chrono::Utc::now().format("%Y-%m-%d");
    let filename = format!("ironshelf-library-config-{date_stamp}.json");

    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                "application/json".to_string(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        json_body,
    ))
}

/// POST /api/v1/import/library-config — import library configurations (owner only).
///
/// Creates library config entries in the database. Does NOT copy files or open
/// sources — the libraries will be available after a server restart (or manual
/// scan trigger) once their paths exist on disk.
pub async fn import_library_config(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Json(document): Json<LibraryConfigExport>,
) -> Result<Json<LibraryConfigImportResult>, AppError> {
    require_owner(&user)?;

    if document.version != 1 {
        return Err(AppError::BadRequest(format!(
            "unsupported library config version: {} (expected 1)",
            document.version
        )));
    }

    let mut libraries_created: u64 = 0;
    let mut libraries_skipped_duplicate: u64 = 0;

    let existing_libraries = state
        .ironshelf_db
        .list_libraries()
        .await
        .map_err(AppError::internal)?;

    for library_entry in &document.libraries {
        // Skip if a library with the same name and path already exists
        let is_duplicate = existing_libraries.iter().any(|existing| {
            existing.name == library_entry.name && existing.path == library_entry.path
        });

        if is_duplicate {
            libraries_skipped_duplicate += 1;
            continue;
        }

        let options_string = library_entry
            .options
            .as_ref()
            .map(|value| value.to_string());

        let library_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO library_config (id, name, library_type, source_kind, path, options_json) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&library_id)
        .bind(&library_entry.name)
        .bind(&library_entry.library_type)
        .bind(&library_entry.source_kind)
        .bind(&library_entry.path)
        .bind(options_string.as_deref())
        .execute(state.ironshelf_db.pool())
        .await
        .map_err(AppError::internal)?;

        libraries_created += 1;
    }

    Ok(Json(LibraryConfigImportResult {
        libraries_created,
        libraries_skipped_duplicate,
    }))
}
