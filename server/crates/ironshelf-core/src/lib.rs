//! ironshelf-core — domain models + IO (Calibre reader, own DB).

pub mod calibre;
pub mod db;
pub mod model;

/// Folder scanner + embedded EPUB OPF parser (non-Calibre libraries).
pub mod scan {
    // TODO(M3): walk dirs, parse OPF (dc:creator, calibre:series, series_index, title,
    // subjects). Port AO3 fandom/author heuristic from /home/riley/stump/organize.py.
}

/// EPUB open/read for the reader (cover, chapters, locator).
pub mod epub {
    // TODO(M2): evaluate rbook vs epub crate.
}
