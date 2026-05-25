//! Shared application state.

use ironshelf_core::calibre::CalibreSource;
use ironshelf_core::db::IronshelfDb;
use std::sync::Arc;

/// A loaded library with its source connection.
#[derive(Clone)]
pub struct LoadedLibrary {
    pub id: String,
    pub name: String,
    pub library_type: String,
    pub source_kind: String,
    pub source: CalibreSource,
}

/// Application state shared across all handlers.
#[derive(Clone)]
pub struct AppState {
    pub libraries: Arc<Vec<LoadedLibrary>>,
    pub ironshelf_db: IronshelfDb,
}
