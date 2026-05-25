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

/// A user as stored in the database with their permissions.
#[derive(Debug, Clone)]
pub struct StoredUser {
    pub id: String,
    pub username: String,
    pub is_owner: bool,
    pub created_at: String,
    pub permissions: Vec<String>,
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
        let migration_001 = include_str!("migrations/001_initial.sql");
        sqlx::raw_sql(migration_001).execute(&self.pool).await?;

        let migration_002 = include_str!("migrations/002_invites.sql");
        sqlx::raw_sql(migration_002).execute(&self.pool).await?;

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

    // --- User management ---

    /// List all users with their permissions.
    pub async fn list_users(&self) -> Result<Vec<StoredUser>, DbError> {
        let rows = sqlx::query(
            "SELECT id, username, is_owner, created_at FROM users ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut users = Vec::new();
        for row in &rows {
            let user_id: String = row.get("id");
            let permission_rows = sqlx::query("SELECT permission FROM permissions WHERE user_id = ?")
                .bind(&user_id)
                .fetch_all(&self.pool)
                .await?;

            let permissions: Vec<String> = permission_rows
                .iter()
                .map(|permission_row| permission_row.get("permission"))
                .collect();

            users.push(StoredUser {
                id: user_id,
                username: row.get("username"),
                is_owner: row.get::<i32, _>("is_owner") != 0,
                created_at: row.get("created_at"),
                permissions,
            });
        }

        Ok(users)
    }

    /// Delete a user by ID. CASCADE handles related rows.
    pub async fn delete_user(&self, user_id: &str) -> Result<(), DbError> {
        let result = sqlx::query("DELETE FROM users WHERE id = ?")
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Replace all permissions for a user.
    pub async fn set_permissions(
        &self,
        user_id: &str,
        permissions: &[String],
    ) -> Result<(), DbError> {
        sqlx::query("DELETE FROM permissions WHERE user_id = ?")
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        for permission in permissions {
            sqlx::query("INSERT INTO permissions (user_id, permission) VALUES (?, ?)")
                .bind(user_id)
                .bind(permission)
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    /// Get permissions for a user.
    pub async fn get_permissions(&self, user_id: &str) -> Result<Vec<String>, DbError> {
        let rows = sqlx::query("SELECT permission FROM permissions WHERE user_id = ?")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows.iter().map(|row| row.get("permission")).collect())
    }

    /// Create an invite code. Returns the generated code.
    pub async fn create_invite(&self, created_by: &str) -> Result<String, DbError> {
        // Use two UUIDs concatenated and trimmed for a 32-char hex invite code
        let code = uuid::Uuid::new_v4().to_string().replace('-', "");

        sqlx::query("INSERT INTO invites (code, created_by) VALUES (?, ?)")
            .bind(&code)
            .bind(created_by)
            .execute(&self.pool)
            .await?;

        Ok(code)
    }

    /// Consume an invite code. Returns true if the code was valid and unused.
    pub async fn consume_invite(&self, code: &str, used_by: &str) -> Result<bool, DbError> {
        let result = sqlx::query(
            "UPDATE invites SET used_by = ?, used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
             WHERE code = ? AND used_by IS NULL",
        )
        .bind(used_by)
        .bind(code)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}
