//! Unified domain models (source-agnostic). See docs/DATA-MODEL.md.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Source kind for a library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Calibre,
    Folder,
}

/// Library content type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryType {
    Book,
    LightNovel,
    WebNovel,
    Fanfiction,
    Comic,
    Manga,
    Mixed,
}

/// A configured library.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub id: String,
    pub name: String,
    pub library_type: LibraryType,
    pub source_kind: SourceKind,
    pub path: String,
    pub custom_columns: Vec<CustomColumn>,
    pub created_at: DateTime<Utc>,
}

/// An author.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Author {
    pub id: i64,
    pub name: String,
    pub sort_name: String,
    pub book_count: i64,
    pub series_count: i64,
}

/// A series.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Series {
    pub id: i64,
    pub name: String,
    pub sort_name: String,
    pub book_count: i64,
}

/// A book format (EPUB, PDF, etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Format {
    pub kind: String,
    pub size: Option<u64>,
    pub file_name: String,
}

/// A book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: i64,
    pub title: String,
    pub sort_title: String,
    pub author_ids: Vec<i64>,
    /// Resolved author names corresponding to `author_ids`.
    pub author_names: Vec<String>,
    pub series_id: Option<i64>,
    pub series_index: Option<f64>,
    pub formats: Vec<Format>,
    pub has_cover: bool,
    pub path: String,
    pub pubdate: Option<NaiveDate>,
    pub added_at: Option<DateTime<Utc>>,
    pub rating: Option<i32>,
    pub tags: Vec<String>,
    pub languages: Vec<String>,
    pub identifiers: HashMap<String, String>,
    pub description: Option<String>,
    pub custom: HashMap<String, CustomValue>,
}

/// Metadata about a custom column.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomColumn {
    pub id: i64,
    pub label: String,
    pub name: String,
    pub datatype: String,
    pub is_multiple: bool,
}

/// A value from a custom column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CustomValue {
    Text(String),
    Int(i64),
    Float(f64),
    Bool(bool),
    DateTime(DateTime<Utc>),
    Rating(i32),
    List(Vec<String>),
    Null,
}

// Note: Pagination and sorting types live in ironshelf-server's pagination module.
// They are server-level concerns, not domain model types.
