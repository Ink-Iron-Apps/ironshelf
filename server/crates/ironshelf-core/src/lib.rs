//! ironshelf-core — domain models + IO (Calibre reader, folder scanner, epub, own DB).
//!
//! M0 scaffold: module skeleton only. See docs/ROADMAP.md (M1) to implement.

/// Read-only access to a Calibre `metadata.db`. NEVER writes. See docs/CALIBRE-INTEGRATION.md.
pub mod calibre {
    // TODO(M1): CalibreSource — authors(), series_by_author(), books_by_series(),
    // standalone(), book(), formats(), custom_columns(). Open SQLite read-only.
}

/// Folder scanner + embedded EPUB OPF parser (non-Calibre libraries).
pub mod scan {
    // TODO(M3): walk dirs, parse OPF (dc:creator, calibre:series, series_index, title,
    // subjects). Port AO3 fandom/author heuristic from /home/riley/stump/organize.py.
}

/// Unified domain model (source-agnostic). See docs/DATA-MODEL.md.
pub mod model {
    // TODO(M1): Library, Author, Series, Book, Format, CustomColumn, CustomValue.
}

/// Ironshelf's own read/write DB (users, sessions, api_keys, progress, prefs).
pub mod db {
    // TODO(M1): sqlx pool + migrations.
}

/// EPUB open/read for the reader (cover, chapters, locator).
pub mod epub {
    // TODO(M2): evaluate rbook vs epub crate.
}
