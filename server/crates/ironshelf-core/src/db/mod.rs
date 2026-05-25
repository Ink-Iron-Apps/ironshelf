//! Ironshelf's own read/write database (users, sessions, api_keys, progress, library config).
//! Libraries are stored here and managed via API — not in TOML config.

use crate::model::{LibraryType, SourceKind};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::str::FromStr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("not found")]
    NotFound,
}

/// A library as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredLibrary {
    pub id: String,
    pub name: String,
    pub library_type: String,
    pub source_kind: String,
    pub path: String,
    pub options_json: Option<String>,
}

/// Ironshelf's own database connection.
#[derive(Clone)]
pub struct IronshelfDb {
    pool: SqlitePool,
}

impl IronshelfDb {
    /// Open (or create) the Ironshelf database at the given path.
    pub async fn open(path: impl AsRef<Path>) -> Result<Self, DbError> {
        let options = SqliteConnectOptions::from_str(&format!(
            "sqlite://{}?mode=rwc",
            path.as_ref().display()
        ))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(options)
            .await?;

        Ok(Self { pool })
    }

    /// Run migrations to bring the schema up to date.
    pub async fn migrate(&self) -> Result<(), DbError> {
        let migration_sql = include_str!("migrations/001_initial.sql");
        sqlx::raw_sql(migration_sql).execute(&self.pool).await?;
        Ok(())
    }

    /// Get a reference to the underlying pool.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    // --- Library CRUD (managed via API/GUI, not config file) ---

    /// List all configured libraries.
    pub async fn list_libraries(&self) -> Result<Vec<StoredLibrary>, DbError> {
        let rows = sqlx::query(
            "SELECT id, name, library_type, source_kind, path, options_json FROM library_config ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredLibrary {
                id: row.get("id"),
                name: row.get("name"),
                library_type: row.get("library_type"),
                source_kind: row.get("source_kind"),
                path: row.get("path"),
                options_json: row.get("options_json"),
            })
            .collect())
    }

    /// Get a single library by ID.
    pub async fn get_library(&self, library_id: &str) -> Result<StoredLibrary, DbError> {
        let row = sqlx::query(
            "SELECT id, name, library_type, source_kind, path, options_json FROM library_config WHERE id = ?",
        )
        .bind(library_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| StoredLibrary {
            id: row.get("id"),
            name: row.get("name"),
            library_type: row.get("library_type"),
            source_kind: row.get("source_kind"),
            path: row.get("path"),
            options_json: row.get("options_json"),
        })
        .ok_or(DbError::NotFound)
    }

    /// Create a new library. Returns the generated ID.
    pub async fn create_library(
        &self,
        name: &str,
        library_type: LibraryType,
        source_kind: SourceKind,
        path: &str,
        options_json: Option<&str>,
    ) -> Result<String, DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        let library_type_str = serde_json::to_string(&library_type)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let source_kind_str = serde_json::to_string(&source_kind)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();

        sqlx::query(
            "INSERT INTO library_config (id, name, library_type, source_kind, path, options_json) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(&library_type_str)
        .bind(&source_kind_str)
        .bind(path)
        .bind(options_json)
        .execute(&self.pool)
        .await?;

        Ok(id)
    }

    /// Update a library's settings.
    pub async fn update_library(
        &self,
        library_id: &str,
        name: Option<&str>,
        library_type: Option<&str>,
        options_json: Option<&str>,
    ) -> Result<(), DbError> {
        // Build dynamic update
        if let Some(name) = name {
            sqlx::query("UPDATE library_config SET name = ? WHERE id = ?")
                .bind(name)
                .bind(library_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(library_type) = library_type {
            sqlx::query("UPDATE library_config SET library_type = ? WHERE id = ?")
                .bind(library_type)
                .bind(library_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(options_json) = options_json {
            sqlx::query("UPDATE library_config SET options_json = ? WHERE id = ?")
                .bind(options_json)
                .bind(library_id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    /// Delete a library.
    pub async fn delete_library(&self, library_id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM library_config WHERE id = ?")
            .bind(library_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
