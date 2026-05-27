//! ironshelf-core — domain models + IO (Calibre reader, own DB).

pub mod acquisition;
pub mod calibre;
pub mod db;
pub mod model;

pub mod metadata;
pub mod scan;
pub mod search_index;

/// EPUB open/read for the reader (cover, chapters, locator).
/// Stub module — EPUB reading handled via web UI JavaScript readers
/// and file streaming endpoints. Server-side EPUB parsing for metadata
/// is done in the scan module via OPF extraction.
pub mod epub {}
