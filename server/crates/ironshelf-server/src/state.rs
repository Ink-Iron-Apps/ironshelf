//! Shared application state.

use ironshelf_core::calibre::CalibreSource;
use ironshelf_core::db::IronshelfDb;
use ironshelf_core::model::{Author, Book, CustomColumn, Series};
use ironshelf_core::scan::FolderSource;
use ironshelf_core::search_index::SearchIndex;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

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
            Self::Calibre(source) => source.series_by_author(author_id).map_err(|e| e.to_string()).await,
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

    pub async fn series(&self, series_id: i64) -> Result<Option<Series>, String> {
        match self {
            Self::Calibre(source) => source.series(series_id).await.map_err(|e| e.to_string()),
            Self::Folder(_) => Ok(None), // Folder uses name-based
        }
    }

    pub async fn custom_columns(&self) -> Vec<CustomColumn> {
        match self {
            Self::Calibre(source) => source.custom_columns().await.unwrap_or_default(),
            Self::Folder(_) => vec![], // No custom columns for folder source
        }
    }

    pub fn cover_path(&self, book_path: &str) -> Option<PathBuf> {
        match self {
            Self::Calibre(source) => Some(source.cover_path(book_path)),
            Self::Folder(_) => None,
        }
    }

    pub fn format_path(&self, book_path: &str, file_name: &str, format: &str) -> PathBuf {
        match self {
            Self::Calibre(source) => source.format_path(book_path, file_name, format),
            Self::Folder(source) => {
                // For folder source, rel_path IS the file path
                // We need to block to get the path, but format_path is sync
                // The FolderSource stores library_path, and file_name is rel_path
                // This is a bit awkward — file_name contains the full relative path for folder
                PathBuf::from(file_name)
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
    pub thumbnail_cache_path: PathBuf,
}
