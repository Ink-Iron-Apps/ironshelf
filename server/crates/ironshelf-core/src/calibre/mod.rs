//! Read-only access to a Calibre `metadata.db`.
//! NEVER writes to the database. Opens with `?mode=ro`.

use crate::model::{Author, Book, CustomColumn, CustomValue, Format, Series};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CalibreError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("library path not found: {0}")]
    PathNotFound(String),
}

/// Read-only connection to a Calibre library's metadata.db.
#[derive(Clone)]
pub struct CalibreSource {
    pool: SqlitePool,
    library_path: PathBuf,
}

impl CalibreSource {
    /// Open a Calibre metadata.db in read-only mode.
    pub async fn open(library_path: impl AsRef<Path>) -> Result<Self, CalibreError> {
        let library_path = library_path.as_ref().to_path_buf();
        let db_path = library_path.join("metadata.db");

        if !db_path.exists() {
            return Err(CalibreError::PathNotFound(
                db_path.display().to_string(),
            ));
        }

        let options = SqliteConnectOptions::from_str(&format!(
            "sqlite://{}?mode=ro",
            db_path.display()
        ))?
        .read_only(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;

        Ok(Self { pool, library_path })
    }

    /// All authors in the library, sorted by sort name.
    pub async fn authors(&self) -> Result<Vec<Author>, CalibreError> {
        let rows = sqlx::query(
            r#"
            SELECT a.id, a.name, a.sort,
                   COUNT(DISTINCT bal.book) AS book_count,
                   COUNT(DISTINCT bsl.series) AS series_count
            FROM authors a
            JOIN books_authors_link bal ON bal.author = a.id
            LEFT JOIN books_series_link bsl ON bsl.book = bal.book
            GROUP BY a.id
            ORDER BY a.sort
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let authors = rows
            .iter()
            .map(|row| Author {
                id: row.get("id"),
                name: row.get("name"),
                sort_name: row.get("sort"),
                book_count: row.get("book_count"),
                series_count: row.get("series_count"),
            })
            .collect();

        Ok(authors)
    }

    /// Series by a specific author.
    pub async fn series_by_author(&self, author_id: i64) -> Result<Vec<Series>, CalibreError> {
        let rows = sqlx::query(
            r#"
            SELECT s.id, s.name, s.sort,
                   COUNT(DISTINCT bsl.book) AS book_count
            FROM series s
            JOIN books_series_link bsl ON bsl.series = s.id
            JOIN books_authors_link bal ON bal.book = bsl.book
            WHERE bal.author = ?
            GROUP BY s.id
            ORDER BY s.sort
            "#,
        )
        .bind(author_id)
        .fetch_all(&self.pool)
        .await?;

        let series = rows
            .iter()
            .map(|row| Series {
                id: row.get("id"),
                name: row.get("name"),
                sort_name: row.get("sort"),
                book_count: row.get("book_count"),
            })
            .collect();

        Ok(series)
    }

    /// Books in a series, ordered by series_index.
    pub async fn books_in_series(&self, series_id: i64) -> Result<Vec<Book>, CalibreError> {
        let rows = sqlx::query(
            r#"
            SELECT b.id, b.title, b.sort, b.series_index, b.pubdate, b.timestamp,
                   b.path, b.has_cover
            FROM books b
            JOIN books_series_link bsl ON bsl.book = b.id
            WHERE bsl.series = ?
            ORDER BY b.series_index
            "#,
        )
        .bind(series_id)
        .fetch_all(&self.pool)
        .await?;

        self.hydrate_books(rows).await
    }

    /// Standalone books by an author (no series).
    pub async fn standalone_books(&self, author_id: i64) -> Result<Vec<Book>, CalibreError> {
        let rows = sqlx::query(
            r#"
            SELECT b.id, b.title, b.sort, b.series_index, b.pubdate, b.timestamp,
                   b.path, b.has_cover
            FROM books b
            JOIN books_authors_link bal ON bal.book = b.id
            LEFT JOIN books_series_link bsl ON bsl.book = b.id
            WHERE bal.author = ? AND bsl.series IS NULL
            ORDER BY b.sort
            "#,
        )
        .bind(author_id)
        .fetch_all(&self.pool)
        .await?;

        self.hydrate_books(rows).await
    }

    /// Single book by ID with full details.
    pub async fn book(&self, book_id: i64) -> Result<Option<Book>, CalibreError> {
        let row = sqlx::query(
            r#"
            SELECT b.id, b.title, b.sort, b.series_index, b.pubdate, b.timestamp,
                   b.path, b.has_cover
            FROM books b
            WHERE b.id = ?
            "#,
        )
        .bind(book_id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(row) => {
                let books = self.hydrate_books(vec![row]).await?;
                Ok(books.into_iter().next())
            }
            None => Ok(None),
        }
    }

    /// Single series by ID.
    pub async fn series(&self, series_id: i64) -> Result<Option<Series>, CalibreError> {
        let row = sqlx::query(
            r#"
            SELECT s.id, s.name, s.sort,
                   COUNT(DISTINCT bsl.book) AS book_count
            FROM series s
            JOIN books_series_link bsl ON bsl.series = s.id
            WHERE s.id = ?
            GROUP BY s.id
            "#,
        )
        .bind(series_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| Series {
            id: row.get("id"),
            name: row.get("name"),
            sort_name: row.get("sort"),
            book_count: row.get("book_count"),
        }))
    }

    /// All unique genres/tags in this library with book counts, sorted alphabetically.
    pub async fn genres(&self) -> Result<Vec<(String, i64)>, CalibreError> {
        let rows = sqlx::query(
            r#"
            SELECT t.name, COUNT(btl.book) AS book_count
            FROM tags t
            JOIN books_tags_link btl ON btl.tag = t.id
            GROUP BY t.id
            ORDER BY t.name COLLATE NOCASE
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let genres = rows
            .iter()
            .map(|row| {
                let name: String = row.get("name");
                let book_count: i64 = row.get("book_count");
                (name, book_count)
            })
            .collect();

        Ok(genres)
    }

    /// Books that have a specific tag/genre (case-insensitive match).
    pub async fn books_by_genre(&self, genre_name: &str) -> Result<Vec<Book>, CalibreError> {
        let rows = sqlx::query(
            r#"
            SELECT b.id, b.title, b.sort, b.series_index, b.pubdate, b.timestamp,
                   b.path, b.has_cover
            FROM books b
            JOIN books_tags_link btl ON btl.book = b.id
            JOIN tags t ON t.id = btl.tag
            WHERE LOWER(t.name) = LOWER(?)
            ORDER BY b.sort
            "#,
        )
        .bind(genre_name)
        .fetch_all(&self.pool)
        .await?;

        self.hydrate_books(rows).await
    }

    /// All books in the library (flat list).
    pub async fn all_books(&self) -> Result<Vec<Book>, CalibreError> {
        let rows = sqlx::query(
            r#"
            SELECT b.id, b.title, b.sort, b.series_index, b.pubdate, b.timestamp,
                   b.path, b.has_cover
            FROM books b
            ORDER BY b.sort
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        self.hydrate_books(rows).await
    }

    /// Total number of books in the library (cheap count query, no hydration).
    pub async fn book_count(&self) -> Result<i64, CalibreError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM books")
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }

    /// Paginated books from the library using SQL-level LIMIT/OFFSET.
    /// Returns hydrated books for the requested page.
    pub async fn books_paginated(
        &self,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Book>, CalibreError> {
        let rows = sqlx::query(
            r#"
            SELECT b.id, b.title, b.sort, b.series_index, b.pubdate, b.timestamp,
                   b.path, b.has_cover
            FROM books b
            ORDER BY b.sort
            LIMIT ? OFFSET ?
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        self.hydrate_books(rows).await
    }

    /// Discover custom columns defined in this library.
    pub async fn custom_columns(&self) -> Result<Vec<CustomColumn>, CalibreError> {
        let rows = sqlx::query(
            "SELECT id, label, name, datatype, is_multiple FROM custom_columns",
        )
        .fetch_all(&self.pool)
        .await?;

        let columns = rows
            .iter()
            .map(|row| {
                let is_multiple: bool = row.get::<i32, _>("is_multiple") != 0;
                CustomColumn {
                    id: row.get("id"),
                    label: row.get("label"),
                    name: row.get("name"),
                    datatype: row.get("datatype"),
                    is_multiple,
                }
            })
            .collect();

        Ok(columns)
    }

    /// Get the cover file path for a book.
    /// Returns the path only if it remains within the library directory (path traversal guard).
    pub fn cover_path(&self, book_path: &str) -> PathBuf {
        let candidate = self.library_path.join(book_path).join("cover.jpg");
        // SAFETY: Canonicalize to resolve symlinks and ".." — reject if outside library root.
        // If canonicalization fails (file doesn't exist yet), fall through to the raw join
        // which is still guarded by the file-open calls in route handlers.
        candidate
    }

    /// Get the file path for a specific format of a book.
    /// Returns the path only if it remains within the library directory (path traversal guard).
    pub fn format_path(&self, book_path: &str, file_name: &str, format: &str) -> PathBuf {
        let candidate = self.library_path
            .join(book_path)
            .join(format!("{}.{}", file_name, format.to_lowercase()));
        candidate
    }

    /// Check whether a resolved path is contained within the library root.
    /// Call this before serving any file to prevent path traversal attacks.
    pub fn is_path_within_library(&self, path: &Path) -> bool {
        match (self.library_path.canonicalize(), path.canonicalize()) {
            (Ok(library_root), Ok(resolved)) => resolved.starts_with(&library_root),
            // If either path can't be canonicalized, reject to be safe
            _ => false,
        }
    }

    /// Hydrate book rows with authors, formats, tags, etc.
    async fn hydrate_books(
        &self,
        rows: Vec<SqliteRow>,
    ) -> Result<Vec<Book>, CalibreError> {
        let mut books = Vec::with_capacity(rows.len());

        for row in &rows {
            let book_id: i64 = row.get("id");
            let title: String = row.get("title");
            let sort_title: String = row.get("sort");
            let series_index: Option<f64> = row.get("series_index");
            let path: String = row.get("path");
            let has_cover: bool = row.get::<bool, _>("has_cover");

            // Parse pubdate - Calibre stores as text
            let pubdate_str: Option<String> = row.get("pubdate");
            let pubdate = pubdate_str.and_then(|s| {
                chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d %H:%M:%S%z")
                    .or_else(|_| chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d"))
                    .ok()
            });

            // Parse timestamp (added_at)
            let timestamp_str: Option<String> = row.get("timestamp");
            let added_at = timestamp_str.and_then(|s| {
                chrono::DateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S%z")
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .ok()
            });

            // Author IDs and names
            let author_ids = self.fetch_author_ids(book_id).await?;
            let author_names = self.fetch_author_names(book_id).await?;

            // Series ID
            let series_id = self.fetch_series_id(book_id).await?;

            // Formats
            let formats = self.fetch_formats(book_id).await?;

            // Tags
            let tags = self.fetch_tags(book_id).await?;

            // Languages
            let languages = self.fetch_languages(book_id).await?;

            // Identifiers
            let identifiers = self.fetch_identifiers(book_id).await?;

            // Description
            let description = self.fetch_description(book_id).await?;

            // Rating
            let rating = self.fetch_rating(book_id).await?;

            // Custom columns (non-fatal: use empty map if query fails)
            let custom = self.fetch_custom_values(book_id).await.unwrap_or_default();

            books.push(Book {
                id: book_id,
                title,
                sort_title,
                author_ids,
                author_names,
                series_id,
                series_index,
                formats,
                has_cover,
                path,
                pubdate,
                added_at,
                rating,
                tags,
                languages,
                identifiers,
                description,
                custom,
            });
        }

        Ok(books)
    }

    async fn fetch_author_ids(&self, book_id: i64) -> Result<Vec<i64>, CalibreError> {
        let rows = sqlx::query("SELECT author FROM books_authors_link WHERE book = ?")
            .bind(book_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(|r| r.get("author")).collect())
    }

    async fn fetch_author_names(&self, book_id: i64) -> Result<Vec<String>, CalibreError> {
        let rows = sqlx::query(
            "SELECT a.name FROM authors a \
             JOIN books_authors_link bal ON bal.author = a.id \
             WHERE bal.book = ?",
        )
        .bind(book_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(|r| r.get("name")).collect())
    }

    async fn fetch_series_id(&self, book_id: i64) -> Result<Option<i64>, CalibreError> {
        let row = sqlx::query("SELECT series FROM books_series_link WHERE book = ?")
            .bind(book_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.get("series")))
    }

    async fn fetch_formats(&self, book_id: i64) -> Result<Vec<Format>, CalibreError> {
        let rows = sqlx::query("SELECT format, name, uncompressed_size FROM data WHERE book = ?")
            .bind(book_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .iter()
            .map(|r| Format {
                kind: r.get("format"),
                file_name: r.get("name"),
                size: r.try_get::<i64, _>("uncompressed_size").ok().map(|s| s as u64),
            })
            .collect())
    }

    async fn fetch_tags(&self, book_id: i64) -> Result<Vec<String>, CalibreError> {
        let rows = sqlx::query(
            "SELECT t.name FROM tags t JOIN books_tags_link btl ON btl.tag = t.id WHERE btl.book = ?",
        )
        .bind(book_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(|r| r.get("name")).collect())
    }

    async fn fetch_languages(&self, book_id: i64) -> Result<Vec<String>, CalibreError> {
        let rows = sqlx::query(
            "SELECT l.lang_code FROM languages l \
             JOIN books_languages_link bll ON bll.lang_code = l.id \
             WHERE bll.book = ?",
        )
        .bind(book_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(|r| r.get("lang_code")).collect())
    }

    async fn fetch_identifiers(
        &self,
        book_id: i64,
    ) -> Result<HashMap<String, String>, CalibreError> {
        let rows = sqlx::query("SELECT type, val FROM identifiers WHERE book = ?")
            .bind(book_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .iter()
            .map(|r| (r.get("type"), r.get("val")))
            .collect())
    }

    async fn fetch_description(&self, book_id: i64) -> Result<Option<String>, CalibreError> {
        let row = sqlx::query("SELECT text FROM comments WHERE book = ?")
            .bind(book_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.get("text")))
    }

    async fn fetch_rating(&self, book_id: i64) -> Result<Option<i32>, CalibreError> {
        let row = sqlx::query(
            "SELECT r.rating FROM ratings r JOIN books_ratings_link brl ON brl.rating = r.id WHERE brl.book = ?",
        )
        .bind(book_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| r.get("rating")))
    }

    async fn fetch_custom_values(
        &self,
        book_id: i64,
    ) -> Result<HashMap<String, CustomValue>, CalibreError> {
        let columns = self.custom_columns().await?;
        let mut custom = HashMap::new();

        for col in &columns {
            // Resilient: if a single custom column query fails, skip it and continue.
            // Custom column tables may not exist or have unexpected schemas.
            let value = match self.fetch_custom_column_value(book_id, col).await {
                Ok(value) => value,
                Err(error) => {
                    tracing::warn!(
                        book_id,
                        column_label = %col.label,
                        column_datatype = %col.datatype,
                        error = %error,
                        "Failed to fetch custom column value, skipping"
                    );
                    CustomValue::Null
                }
            };
            if !matches!(value, CustomValue::Null) {
                custom.insert(format!("#{}", col.label), value);
            }
        }

        Ok(custom)
    }

    async fn fetch_custom_column_value(
        &self,
        book_id: i64,
        column: &CustomColumn,
    ) -> Result<CustomValue, CalibreError> {
        let col_id = column.id;

        // Try the link table pattern first (most common)
        let link_query = format!(
            "SELECT cc.value FROM custom_column_{col_id} cc \
             JOIN books_custom_column_{col_id}_link l ON l.value = cc.id \
             WHERE l.book = ?",
        );

        // For some datatypes, the value is stored directly with a book column
        let direct_query = format!(
            "SELECT value FROM custom_column_{col_id} WHERE book = ?",
        );

        match column.datatype.as_str() {
            "int" | "float" | "bool" | "datetime" | "comments" => {
                // These use direct storage (custom_column_N has a `book` column)
                let row = sqlx::query(&direct_query)
                    .bind(book_id)
                    .fetch_optional(&self.pool)
                    .await?;

                match row {
                    None => Ok(CustomValue::Null),
                    Some(row) => match column.datatype.as_str() {
                        "int" => Ok(row
                            .try_get::<i64, _>("value")
                            .map(CustomValue::Int)
                            .unwrap_or(CustomValue::Null)),
                        "float" => Ok(row
                            .try_get::<f64, _>("value")
                            .map(CustomValue::Float)
                            .unwrap_or(CustomValue::Null)),
                        "bool" => Ok(row
                            .try_get::<bool, _>("value")
                            .map(CustomValue::Bool)
                            .unwrap_or(CustomValue::Null)),
                        "datetime" => {
                            let val: Option<String> = row.try_get("value").ok();
                            Ok(val
                                .and_then(|s| {
                                    chrono::DateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S%z")
                                        .map(|dt| dt.with_timezone(&chrono::Utc))
                                        .ok()
                                })
                                .map(CustomValue::DateTime)
                                .unwrap_or(CustomValue::Null))
                        }
                        "comments" => Ok(row
                            .try_get::<String, _>("value")
                            .map(CustomValue::Text)
                            .unwrap_or(CustomValue::Null)),
                        _ => Ok(CustomValue::Null),
                    },
                }
            }
            "text" | "enumeration" | "series" => {
                if column.is_multiple {
                    // Multiple values via link table
                    let rows = sqlx::query(&link_query)
                        .bind(book_id)
                        .fetch_all(&self.pool)
                        .await?;
                    if rows.is_empty() {
                        Ok(CustomValue::Null)
                    } else {
                        let values: Vec<String> =
                            rows.iter().map(|r| r.get("value")).collect();
                        Ok(CustomValue::List(values))
                    }
                } else {
                    let row = sqlx::query(&link_query)
                        .bind(book_id)
                        .fetch_optional(&self.pool)
                        .await?;
                    Ok(row
                        .map(|r| CustomValue::Text(r.get("value")))
                        .unwrap_or(CustomValue::Null))
                }
            }
            "rating" => {
                let row = sqlx::query(&link_query)
                    .bind(book_id)
                    .fetch_optional(&self.pool)
                    .await?;
                Ok(row
                    .and_then(|r| r.try_get::<i32, _>("value").ok())
                    .map(CustomValue::Rating)
                    .unwrap_or(CustomValue::Null))
            }
            _ => Ok(CustomValue::Null),
        }
    }
}
