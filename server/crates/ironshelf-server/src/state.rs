//! Shared application state.

use ironshelf_core::calibre::CalibreSource;
use ironshelf_core::db::IronshelfDb;
use ironshelf_core::model::{Author, Book, CustomColumn, Series};
use ironshelf_core::scan::FolderSource;
use ironshelf_core::search_index::SearchIndex;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::Config;
use crate::routes::login_state::{LoginAttemptStore, PendingTotpStore};
use crate::routes::sso::SsoStateStore;
use crate::routes::update::SharedUpdateStatus;

/// Polymorphic library source.
#[derive(Clone)]
pub enum LibrarySource {
    Calibre(CalibreSource),
    Folder(Arc<RwLock<FolderSource>>),
}

impl LibrarySource {
    pub async fn authors(&self) -> Result<Vec<Author>, String> {
        match self {
            Self::Calibre(source) => source.authors().await.map_err(|e| e.to_string()),
            Self::Folder(source) => Ok(source.read().await.authors()),
        }
    }

    pub async fn series_by_author(&self, author_id: i64) -> Result<Vec<Series>, String> {
        match self {
            Self::Calibre(source) => source.series_by_author(author_id).await.map_err(|e| e.to_string()),
            Self::Folder(source) => Ok(source.read().await.series_by_author(author_id)),
        }
    }

    pub async fn books_in_series(&self, series_id: i64) -> Result<Vec<Book>, String> {
        match self {
            Self::Calibre(source) => source.books_in_series(series_id).await.map_err(|e| e.to_string()),
            Self::Folder(_source) => {
                // FolderSource uses name-based series, not ID.
                // This path is for Calibre only; folder series resolved differently.
                Ok(vec![])
            }
        }
    }

    pub async fn standalone_books(&self, author_id: i64) -> Result<Vec<Book>, String> {
        match self {
            Self::Calibre(source) => source.standalone_books(author_id).await.map_err(|e| e.to_string()),
            Self::Folder(source) => {
                let s = source.read().await;
                let authors = s.authors();
                if let Some(author) = authors.iter().find(|a| a.id == author_id) {
                    Ok(s.standalone_books(&author.name))
                } else {
                    Ok(vec![])
                }
            }
        }
    }

    pub async fn book(&self, book_id: i64) -> Result<Option<Book>, String> {
        match self {
            Self::Calibre(source) => source.book(book_id).await.map_err(|e| e.to_string()),
            Self::Folder(source) => Ok(source.read().await.book(book_id)),
        }
    }

    pub async fn all_books(&self) -> Result<Vec<Book>, String> {
        match self {
            Self::Calibre(source) => source.all_books().await.map_err(|e| e.to_string()),
            Self::Folder(source) => Ok(source.read().await.all_books()),
        }
    }

    /// Total number of books without loading them into memory.
    pub async fn book_count(&self) -> Result<i64, String> {
        match self {
            Self::Calibre(source) => source.book_count().await.map_err(|e| e.to_string()),
            Self::Folder(source) => Ok(source.read().await.book_count()),
        }
    }

    /// Paginated books using SQL-level LIMIT/OFFSET (Calibre) or vec slicing (Folder).
    pub async fn books_paginated(&self, offset: i64, limit: i64) -> Result<Vec<Book>, String> {
        match self {
            Self::Calibre(source) => source
                .books_paginated(offset, limit)
                .await
                .map_err(|e| e.to_string()),
            Self::Folder(source) => Ok(source.read().await.books_paginated(offset, limit)),
        }
    }

    pub async fn series(&self, series_id: i64) -> Result<Option<Series>, String> {
        match self {
            Self::Calibre(source) => source.series(series_id).await.map_err(|e| e.to_string()),
            Self::Folder(_) => Ok(None), // Folder uses name-based
        }
    }

    pub async fn custom_columns(&self) -> Result<Vec<CustomColumn>, String> {
        match self {
            Self::Calibre(source) => source.custom_columns().await.map_err(|e| e.to_string()),
            Self::Folder(_) => Ok(vec![]), // No custom columns for folder source
        }
    }

    pub async fn genres(&self) -> Result<Vec<(String, i64)>, String> {
        match self {
            Self::Calibre(source) => source.genres().await.map_err(|e| e.to_string()),
            Self::Folder(source) => Ok(source.read().await.genres()),
        }
    }

    pub async fn books_by_genre(&self, genre_name: &str) -> Result<Vec<Book>, String> {
        match self {
            Self::Calibre(source) => source.books_by_genre(genre_name).await.map_err(|e| e.to_string()),
            Self::Folder(source) => Ok(source.read().await.books_by_genre(genre_name)),
        }
    }

    pub fn cover_path(&self, book_path: &str) -> Option<PathBuf> {
        match self {
            Self::Calibre(source) => {
                let path = source.cover_path(book_path);
                // SAFETY: Reject paths that escape the library root (path traversal defense).
                if source.is_path_within_library(&path) {
                    Some(path)
                } else {
                    tracing::warn!("path traversal blocked for cover: {}", path.display());
                    None
                }
            }
            Self::Folder(_) => None,
        }
    }

    pub async fn format_path(&self, book_path: &str, file_name: &str, format: &str) -> PathBuf {
        match self {
            Self::Calibre(source) => source.format_path(book_path, file_name, format),
            Self::Folder(source) => {
                // For folder source, file_name is the relative path from scan.
                // FolderSource::format_path joins it with the library root.
                source.read().await.format_path(file_name)
            }
        }
    }

    /// Check whether a file path is safely within the library root.
    /// Returns false if the path escapes via `..` or symlinks.
    pub async fn is_path_safe(&self, path: &std::path::Path) -> bool {
        match self {
            Self::Calibre(source) => source.is_path_within_library(path),
            Self::Folder(source) => {
                let folder = source.read().await;
                folder.is_path_within_library(path)
            }
        }
    }
}

/// A loaded library with its source connection.
#[derive(Clone)]
pub struct LoadedLibrary {
    pub id: String,
    pub name: String,
    pub library_type: String,
    pub source_kind: String,
    pub source: LibrarySource,
}

/// Application state shared across all handlers.
#[derive(Clone)]
pub struct AppState {
    pub libraries: Arc<RwLock<Vec<LoadedLibrary>>>,
    pub ironshelf_db: IronshelfDb,
    pub started_at: std::time::Instant,
    /// Full-text search index (tantivy). `None` if index failed to initialize.
    pub search_index: Option<Arc<RwLock<SearchIndex>>>,
    /// Path to the thumbnail cache directory for resized cover images.
    #[allow(dead_code)]
    pub thumbnail_cache_path: PathBuf,
    /// Server configuration (needed for OIDC config access in route handlers).
    pub config: Config,
    /// In-memory SSO state store for DB-driven multi-provider login (Google/GitHub/custom).
    pub sso_state_store: SsoStateStore,
    /// Per-username failed-login backoff (brute-force protection).
    pub login_attempt_store: LoginAttemptStore,
    /// Short-lived pending tokens bridging password-OK → TOTP code step.
    pub pending_totp_store: PendingTotpStore,
    /// Shared HTTP client for outbound requests (metadata providers, webhooks).
    /// Created once at startup to reuse connection pools and TLS sessions.
    pub http_client: reqwest::Client,
    /// Shared update status for the self-update feature (tracks download/restart progress).
    pub update_status: SharedUpdateStatus,
    /// In-memory registry of background tasks for UI progress monitoring.
    pub tasks: Arc<crate::tasks::TaskRegistry>,
}
