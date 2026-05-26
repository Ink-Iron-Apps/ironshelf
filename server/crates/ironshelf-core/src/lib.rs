//! ironshelf-core — domain models + IO (Calibre reader, own DB).

pub mod calibre;
pub mod db;
pub mod model;

pub mod metadata;
pub mod scan;
pub mod search_index;

/// EPUB open/read for the reader (cover, chapters, locator).
pub mod epub {
    // TODO(M2): evaluate rbook vs epub crate.
}
