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

/// A collection (reading list) as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredCollection {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// A book entry within a collection, with its position.
#[derive(Debug, Clone)]
pub struct StoredCollectionBook {
    pub collection_id: String,
    pub book_id: String,
    pub position: i64,
    pub added_at: String,
}

/// An activity log entry as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredActivityLog {
    pub id: i64,
    pub user_id: String,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub details_json: Option<String>,
    pub created_at: String,
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

/// A notification as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredNotification {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub message: String,
    pub notification_type: String,
    pub is_read: bool,
    pub link: Option<String>,
    pub created_at: String,
}

/// A WebDAV virtual file as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredWebdavFile {
    pub user_id: String,
    pub path: String,
    pub content: Option<Vec<u8>>,
    pub content_type: String,
    pub size: i64,
    pub modified_at: String,
}

/// A book override as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredBookOverride {
    pub book_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub tags_json: Option<String>,
    pub applied_at: String,
}

/// A highlight/annotation as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredHighlight {
    pub id: String,
    pub user_id: String,
    pub book_id: String,
    pub format: String,
    pub cfi_range: String,
    pub text_content: Option<String>,
    pub color: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A webhook as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredWebhook {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub url: String,
    pub secret: Option<String>,
    pub events: Vec<String>,
    pub is_active: bool,
    pub created_at: String,
}

/// A webhook delivery log entry.
#[derive(Debug, Clone)]
pub struct StoredWebhookDelivery {
    pub id: String,
    pub webhook_id: String,
    pub event: String,
    pub payload_json: String,
    pub response_status: Option<i32>,
    pub response_body: Option<String>,
    pub delivered_at: String,
    pub is_success: bool,
}

/// A reading goal as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredReadingGoal {
    pub user_id: String,
    pub year: i32,
    pub target_books: i32,
    pub created_at: String,
}

/// A completed book entry as stored in the database.
#[derive(Debug, Clone)]
pub struct StoredCompletedBook {
    pub user_id: String,
    pub book_id: String,
    pub completed_at: String,
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

        let migration_003 = include_str!("migrations/003_collections.sql");
        sqlx::raw_sql(migration_003).execute(&self.pool).await?;

        let migration_004 = include_str!("migrations/004_metadata_cache.sql");
        sqlx::raw_sql(migration_004).execute(&self.pool).await?;

        let migration_005 = include_str!("migrations/005_activity_log.sql");
        sqlx::raw_sql(migration_005).execute(&self.pool).await?;

        let migration_006 = include_str!("migrations/006_notifications.sql");
        sqlx::raw_sql(migration_006).execute(&self.pool).await?;

        let migration_008 = include_str!("migrations/008_webdav_files.sql");
        sqlx::raw_sql(migration_008).execute(&self.pool).await?;

        let migration_009 = include_str!("migrations/009_ratings_reviews.sql");
        sqlx::raw_sql(migration_009).execute(&self.pool).await?;

        let migration_010 = include_str!("migrations/010_reading_queue.sql");
        sqlx::raw_sql(migration_010).execute(&self.pool).await?;

        let migration_011 = include_str!("migrations/011_reading_goals.sql");
        sqlx::raw_sql(migration_011).execute(&self.pool).await?;

        let migration_012 = include_str!("migrations/012_highlights.sql");
        sqlx::raw_sql(migration_012).execute(&self.pool).await?;

        let migration_013 = include_str!("migrations/013_webhooks.sql");
        sqlx::raw_sql(migration_013).execute(&self.pool).await?;

        let migration_014 = include_str!("migrations/014_library_access.sql");
        sqlx::raw_sql(migration_014).execute(&self.pool).await?;

        let migration_015 = include_str!("migrations/015_oidc_and_conversions.sql");
        sqlx::raw_sql(migration_015).execute(&self.pool).await?;

        // OIDC columns on users table — ALTER TABLE ADD COLUMN is not idempotent
        // in SQLite (no IF NOT EXISTS support), so we attempt each and ignore
        // "duplicate column" errors to make migrate() safe to call on every startup.
        self.add_column_if_missing("users", "oidc_subject", "TEXT")
            .await?;
        self.add_column_if_missing("users", "oidc_issuer", "TEXT")
            .await?;

        // Unique index for OIDC lookups — safe to re-run due to IF NOT EXISTS.
        sqlx::raw_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc ON users(oidc_issuer, oidc_subject)",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Add a column to a table if it does not already exist.
    /// SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
    /// so we check `PRAGMA table_info` first.
    async fn add_column_if_missing(
        &self,
        table: &str,
        column: &str,
        column_type: &str,
    ) -> Result<(), DbError> {
        // PRAGMA table_info returns one row per column; check if ours is present.
        let pragma_query = format!("PRAGMA table_info({})", table);
        let rows = sqlx::query(&pragma_query)
            .fetch_all(&self.pool)
            .await?;

        let column_exists = rows.iter().any(|row| {
            let name: String = row.get("name");
            name == column
        });

        if !column_exists {
            let alter_query = format!(
                "ALTER TABLE {} ADD COLUMN {} {}",
                table, column, column_type
            );
            sqlx::raw_sql(&alter_query).execute(&self.pool).await?;
        }

        Ok(())
    }

    /// Quick connectivity check — runs `SELECT 1` against the pool.
    pub async fn health_check(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
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

    // --- Collections (reading lists) ---

    /// List collections visible to a user: their own collections + all public collections.
    pub async fn list_collections(&self, user_id: &str) -> Result<Vec<StoredCollection>, DbError> {
        let rows = sqlx::query(
            "SELECT id, user_id, name, description, is_public, created_at, updated_at \
             FROM collections \
             WHERE user_id = ? OR is_public = 1 \
             ORDER BY updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredCollection {
                id: row.get("id"),
                user_id: row.get("user_id"),
                name: row.get("name"),
                description: row.get("description"),
                is_public: row.get::<i32, _>("is_public") != 0,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    /// Get a single collection by ID.
    pub async fn get_collection(&self, collection_id: &str) -> Result<StoredCollection, DbError> {
        let row = sqlx::query(
            "SELECT id, user_id, name, description, is_public, created_at, updated_at \
             FROM collections WHERE id = ?",
        )
        .bind(collection_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| StoredCollection {
            id: row.get("id"),
            user_id: row.get("user_id"),
            name: row.get("name"),
            description: row.get("description"),
            is_public: row.get::<i32, _>("is_public") != 0,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .ok_or(DbError::NotFound)
    }

    /// Create a new collection. Returns the generated ID.
    pub async fn create_collection(
        &self,
        user_id: &str,
        name: &str,
        description: Option<&str>,
        is_public: bool,
    ) -> Result<String, DbError> {
        let collection_id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO collections (id, user_id, name, description, is_public) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&collection_id)
        .bind(user_id)
        .bind(name)
        .bind(description)
        .bind(is_public as i32)
        .execute(&self.pool)
        .await?;

        Ok(collection_id)
    }

    /// Update a collection's mutable fields.
    pub async fn update_collection(
        &self,
        collection_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        is_public: Option<bool>,
    ) -> Result<(), DbError> {
        if let Some(name) = name {
            sqlx::query("UPDATE collections SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
                .bind(name)
                .bind(collection_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(description) = description {
            sqlx::query("UPDATE collections SET description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
                .bind(description)
                .bind(collection_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(is_public) = is_public {
            sqlx::query("UPDATE collections SET is_public = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
                .bind(is_public as i32)
                .bind(collection_id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    /// Delete a collection. CASCADE removes associated book entries.
    pub async fn delete_collection(&self, collection_id: &str) -> Result<(), DbError> {
        let result = sqlx::query("DELETE FROM collections WHERE id = ?")
            .bind(collection_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Add a book to a collection at a given position.
    pub async fn add_book_to_collection(
        &self,
        collection_id: &str,
        book_id: &str,
        position: i64,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO collection_books (collection_id, book_id, position) \
             VALUES (?, ?, ?) \
             ON CONFLICT(collection_id, book_id) DO UPDATE SET position = excluded.position",
        )
        .bind(collection_id)
        .bind(book_id)
        .bind(position)
        .execute(&self.pool)
        .await?;

        // Touch the parent collection's updated_at
        sqlx::query("UPDATE collections SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
            .bind(collection_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Remove a book from a collection.
    pub async fn remove_book_from_collection(
        &self,
        collection_id: &str,
        book_id: &str,
    ) -> Result<(), DbError> {
        let result = sqlx::query(
            "DELETE FROM collection_books WHERE collection_id = ? AND book_id = ?",
        )
        .bind(collection_id)
        .bind(book_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }

        // Touch the parent collection's updated_at
        sqlx::query("UPDATE collections SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
            .bind(collection_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Get all books in a collection, ordered by position.
    pub async fn get_collection_books(
        &self,
        collection_id: &str,
    ) -> Result<Vec<StoredCollectionBook>, DbError> {
        let rows = sqlx::query(
            "SELECT collection_id, book_id, position, added_at \
             FROM collection_books \
             WHERE collection_id = ? \
             ORDER BY position ASC, added_at ASC",
        )
        .bind(collection_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredCollectionBook {
                collection_id: row.get("collection_id"),
                book_id: row.get("book_id"),
                position: row.get("position"),
                added_at: row.get("added_at"),
            })
            .collect())
    }

    // --- Activity logging ---

    /// Record a user action in the activity log.
    pub async fn log_activity(
        &self,
        user_id: &str,
        action: &str,
        target_type: Option<&str>,
        target_id: Option<&str>,
        details_json: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO activity_log (user_id, action, target_type, target_id, details_json) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(action)
        .bind(target_type)
        .bind(target_id)
        .bind(details_json)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Fetch recent activity for a specific user, ordered newest first.
    pub async fn get_recent_activity(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<StoredActivityLog>, DbError> {
        let rows = sqlx::query(
            "SELECT id, user_id, action, target_type, target_id, details_json, created_at \
             FROM activity_log \
             WHERE user_id = ? \
             ORDER BY created_at DESC \
             LIMIT ?",
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredActivityLog {
                id: row.get("id"),
                user_id: row.get("user_id"),
                action: row.get("action"),
                target_type: row.get("target_type"),
                target_id: row.get("target_id"),
                details_json: row.get("details_json"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    /// Fetch server-wide recent activity (all users), ordered newest first.
    pub async fn get_server_activity(
        &self,
        limit: i64,
    ) -> Result<Vec<StoredActivityLog>, DbError> {
        let rows = sqlx::query(
            "SELECT id, user_id, action, target_type, target_id, details_json, created_at \
             FROM activity_log \
             ORDER BY created_at DESC \
             LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredActivityLog {
                id: row.get("id"),
                user_id: row.get("user_id"),
                action: row.get("action"),
                target_type: row.get("target_type"),
                target_id: row.get("target_id"),
                details_json: row.get("details_json"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    // --- Metadata cache ---

    /// Upsert a cached metadata result from an external provider.
    pub async fn upsert_metadata_cache(
        &self,
        book_id: &str,
        provider: &str,
        external_id: Option<&str>,
        metadata_json: &str,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO metadata_cache (book_id, provider, external_id, metadata_json) \
             VALUES (?, ?, ?, ?) \
             ON CONFLICT(book_id, provider) DO UPDATE SET \
               external_id = excluded.external_id, \
               metadata_json = excluded.metadata_json, \
               fetched_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        )
        .bind(book_id)
        .bind(provider)
        .bind(external_id)
        .bind(metadata_json)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get cached metadata for a book from a specific provider.
    pub async fn get_metadata_cache(
        &self,
        book_id: &str,
        provider: &str,
    ) -> Result<Option<String>, DbError> {
        let row = sqlx::query(
            "SELECT metadata_json FROM metadata_cache WHERE book_id = ? AND provider = ?",
        )
        .bind(book_id)
        .bind(provider)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| row.get("metadata_json")))
    }

    /// Get all cached metadata entries for a book (all providers).
    pub async fn get_all_metadata_cache(
        &self,
        book_id: &str,
    ) -> Result<Vec<(String, String, String)>, DbError> {
        let rows = sqlx::query(
            "SELECT provider, metadata_json, fetched_at \
             FROM metadata_cache WHERE book_id = ? ORDER BY fetched_at DESC",
        )
        .bind(book_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                (
                    row.get::<String, _>("provider"),
                    row.get::<String, _>("metadata_json"),
                    row.get::<String, _>("fetched_at"),
                )
            })
            .collect())
    }

    /// Delete cached metadata for a book (all providers).
    pub async fn delete_metadata_cache(&self, book_id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM metadata_cache WHERE book_id = ?")
            .bind(book_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // --- Book overrides (enriched metadata applied by user) ---

    /// Apply (upsert) a metadata override for a book.
    pub async fn upsert_book_override(
        &self,
        book_id: &str,
        title: Option<&str>,
        description: Option<&str>,
        cover_url: Option<&str>,
        tags_json: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO book_overrides (book_id, title, description, cover_url, tags_json) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(book_id) DO UPDATE SET \
               title = COALESCE(excluded.title, book_overrides.title), \
               description = COALESCE(excluded.description, book_overrides.description), \
               cover_url = COALESCE(excluded.cover_url, book_overrides.cover_url), \
               tags_json = COALESCE(excluded.tags_json, book_overrides.tags_json), \
               applied_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        )
        .bind(book_id)
        .bind(title)
        .bind(description)
        .bind(cover_url)
        .bind(tags_json)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get the override for a book, if any.
    pub async fn get_book_override(
        &self,
        book_id: &str,
    ) -> Result<Option<StoredBookOverride>, DbError> {
        let row = sqlx::query(
            "SELECT book_id, title, description, cover_url, tags_json, applied_at \
             FROM book_overrides WHERE book_id = ?",
        )
        .bind(book_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| StoredBookOverride {
            book_id: row.get("book_id"),
            title: row.get("title"),
            description: row.get("description"),
            cover_url: row.get("cover_url"),
            tags_json: row.get("tags_json"),
            applied_at: row.get("applied_at"),
        }))
    }

    /// Delete the override for a book.
    pub async fn delete_book_override(&self, book_id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM book_overrides WHERE book_id = ?")
            .bind(book_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // --- Notifications ---

    /// Create a notification for a user. Returns the generated ID.
    pub async fn create_notification(
        &self,
        user_id: &str,
        title: &str,
        message: &str,
        notification_type: &str,
        link: Option<&str>,
    ) -> Result<String, DbError> {
        let notification_id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO notifications (id, user_id, title, message, notification_type, link) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&notification_id)
        .bind(user_id)
        .bind(title)
        .bind(message)
        .bind(notification_type)
        .bind(link)
        .execute(&self.pool)
        .await?;

        Ok(notification_id)
    }

    /// Get notifications for a user, optionally filtered to unread only.
    pub async fn get_notifications(
        &self,
        user_id: &str,
        unread_only: bool,
        limit: i64,
    ) -> Result<Vec<StoredNotification>, DbError> {
        let query_string = if unread_only {
            "SELECT id, user_id, title, message, notification_type, is_read, link, created_at \
             FROM notifications \
             WHERE user_id = ? AND is_read = 0 \
             ORDER BY created_at DESC \
             LIMIT ?"
        } else {
            "SELECT id, user_id, title, message, notification_type, is_read, link, created_at \
             FROM notifications \
             WHERE user_id = ? \
             ORDER BY created_at DESC \
             LIMIT ?"
        };

        let rows = sqlx::query(query_string)
            .bind(user_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows
            .iter()
            .map(|row| StoredNotification {
                id: row.get("id"),
                user_id: row.get("user_id"),
                title: row.get("title"),
                message: row.get("message"),
                notification_type: row.get("notification_type"),
                is_read: row.get::<i32, _>("is_read") != 0,
                link: row.get("link"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    /// Mark a single notification as read. Returns error if not found or not owned by user.
    pub async fn mark_notification_read(
        &self,
        notification_id: &str,
        user_id: &str,
    ) -> Result<(), DbError> {
        let result = sqlx::query(
            "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
        )
        .bind(notification_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Mark all notifications as read for a user.
    pub async fn mark_all_notifications_read(&self, user_id: &str) -> Result<(), DbError> {
        sqlx::query("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Delete a notification. Returns error if not found or not owned by user.
    pub async fn delete_notification(
        &self,
        notification_id: &str,
        user_id: &str,
    ) -> Result<(), DbError> {
        let result = sqlx::query(
            "DELETE FROM notifications WHERE id = ? AND user_id = ?",
        )
        .bind(notification_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Get the count of unread notifications for a user.
    pub async fn get_unread_count(&self, user_id: &str) -> Result<i64, DbError> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }

    /// Get all user IDs (for broadcasting notifications to all users).
    pub async fn get_all_user_ids(&self) -> Result<Vec<String>, DbError> {
        let rows = sqlx::query("SELECT id FROM users")
            .fetch_all(&self.pool)
            .await?;

        Ok(rows.iter().map(|row| row.get("id")).collect())
    }

    /// Delete expired sessions (where expires_at < now).
    pub async fn delete_expired_sessions(&self) -> Result<u64, DbError> {
        let result = sqlx::query(
            "DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    // --- WebDAV virtual file storage ---

    /// Get a WebDAV file by user and path.
    pub async fn get_webdav_file(
        &self,
        user_id: &str,
        path: &str,
    ) -> Result<Option<StoredWebdavFile>, DbError> {
        let row = sqlx::query(
            "SELECT user_id, path, content, content_type, size, modified_at \
             FROM webdav_files WHERE user_id = ? AND path = ?",
        )
        .bind(user_id)
        .bind(path)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| StoredWebdavFile {
            user_id: row.get("user_id"),
            path: row.get("path"),
            content: row.get("content"),
            content_type: row.get("content_type"),
            size: row.get("size"),
            modified_at: row.get("modified_at"),
        }))
    }

    /// Upsert a WebDAV file (create or replace).
    pub async fn upsert_webdav_file(
        &self,
        user_id: &str,
        path: &str,
        content: &[u8],
        content_type: &str,
    ) -> Result<(), DbError> {
        let size = content.len() as i64;
        sqlx::query(
            "INSERT INTO webdav_files (user_id, path, content, content_type, size, modified_at) \
             VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) \
             ON CONFLICT(user_id, path) DO UPDATE SET \
               content = excluded.content, \
               content_type = excluded.content_type, \
               size = excluded.size, \
               modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        )
        .bind(user_id)
        .bind(path)
        .bind(content)
        .bind(content_type)
        .bind(size)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// List WebDAV files under a given directory prefix for a user.
    /// Returns files whose path starts with the prefix (non-recursive: direct children only).
    pub async fn list_webdav_files(
        &self,
        user_id: &str,
        directory_prefix: &str,
    ) -> Result<Vec<StoredWebdavFile>, DbError> {
        let prefix_pattern = if directory_prefix.is_empty() || directory_prefix == "/" {
            "%".to_string()
        } else {
            let normalized = directory_prefix.trim_end_matches('/');
            format!("{normalized}/%")
        };

        let rows = sqlx::query(
            "SELECT user_id, path, NULL as content, content_type, size, modified_at \
             FROM webdav_files WHERE user_id = ? AND path LIKE ? \
             ORDER BY path",
        )
        .bind(user_id)
        .bind(&prefix_pattern)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredWebdavFile {
                user_id: row.get("user_id"),
                path: row.get("path"),
                content: None, // Don't load content for listings
                content_type: row.get("content_type"),
                size: row.get("size"),
                modified_at: row.get("modified_at"),
            })
            .collect())
    }

    /// Delete a WebDAV file.
    pub async fn delete_webdav_file(
        &self,
        user_id: &str,
        path: &str,
    ) -> Result<(), DbError> {
        sqlx::query("DELETE FROM webdav_files WHERE user_id = ? AND path = ?")
            .bind(user_id)
            .bind(path)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Delete all WebDAV files whose path starts with the given prefix.
    /// Used when deleting a directory to cascade to all children.
    pub async fn delete_webdav_files_by_prefix(
        &self,
        user_id: &str,
        prefix: &str,
    ) -> Result<u64, DbError> {
        let pattern = format!("{prefix}%");
        let result = sqlx::query("DELETE FROM webdav_files WHERE user_id = ? AND path LIKE ?")
            .bind(user_id)
            .bind(&pattern)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Create a WebDAV directory marker (zero-byte entry with directory content type).
    pub async fn create_webdav_directory(
        &self,
        user_id: &str,
        path: &str,
    ) -> Result<(), DbError> {
        let normalized = path.trim_end_matches('/');
        let directory_path = format!("{normalized}/");
        sqlx::query(
            "INSERT INTO webdav_files (user_id, path, content, content_type, size, modified_at) \
             VALUES (?, ?, NULL, 'httpd/unix-directory', 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) \
             ON CONFLICT(user_id, path) DO NOTHING",
        )
        .bind(user_id)
        .bind(&directory_path)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // --- Highlights / Annotations ---

    /// Create a new highlight for a user on a book. Returns the generated ID.
    pub async fn create_highlight(
        &self,
        user_id: &str,
        book_id: &str,
        format: &str,
        cfi_range: &str,
        text_content: Option<&str>,
        color: &str,
        note: Option<&str>,
    ) -> Result<String, DbError> {
        let highlight_id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO highlights (id, user_id, book_id, format, cfi_range, text_content, color, note) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&highlight_id)
        .bind(user_id)
        .bind(book_id)
        .bind(format)
        .bind(cfi_range)
        .bind(text_content)
        .bind(color)
        .bind(note)
        .execute(&self.pool)
        .await?;

        Ok(highlight_id)
    }

    /// Update a highlight's note or color. Returns error if not found or not owned by user.
    pub async fn update_highlight(
        &self,
        highlight_id: &str,
        user_id: &str,
        color: Option<&str>,
        note: Option<&str>,
    ) -> Result<(), DbError> {
        // Verify ownership
        let existing = sqlx::query("SELECT id FROM highlights WHERE id = ? AND user_id = ?")
            .bind(highlight_id)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;

        if existing.is_none() {
            return Err(DbError::NotFound);
        }

        if let Some(color) = color {
            sqlx::query(
                "UPDATE highlights SET color = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            )
            .bind(color)
            .bind(highlight_id)
            .execute(&self.pool)
            .await?;
        }

        if let Some(note) = note {
            sqlx::query(
                "UPDATE highlights SET note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            )
            .bind(note)
            .bind(highlight_id)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    /// Delete a highlight. Returns error if not found or not owned by user.
    pub async fn delete_highlight(
        &self,
        highlight_id: &str,
        user_id: &str,
    ) -> Result<(), DbError> {
        let result = sqlx::query("DELETE FROM highlights WHERE id = ? AND user_id = ?")
            .bind(highlight_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Get all highlights for a specific book by a user.
    pub async fn get_book_highlights(
        &self,
        user_id: &str,
        book_id: &str,
    ) -> Result<Vec<StoredHighlight>, DbError> {
        let rows = sqlx::query(
            "SELECT id, user_id, book_id, format, cfi_range, text_content, color, note, created_at, updated_at \
             FROM highlights \
             WHERE user_id = ? AND book_id = ? \
             ORDER BY created_at ASC",
        )
        .bind(user_id)
        .bind(book_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredHighlight {
                id: row.get("id"),
                user_id: row.get("user_id"),
                book_id: row.get("book_id"),
                format: row.get("format"),
                cfi_range: row.get("cfi_range"),
                text_content: row.get("text_content"),
                color: row.get("color"),
                note: row.get("note"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    /// Get all highlights for a user, with optional filters by book_id and color.
    pub async fn get_all_highlights(
        &self,
        user_id: &str,
        book_id_filter: Option<&str>,
        color_filter: Option<&str>,
    ) -> Result<Vec<StoredHighlight>, DbError> {
        let mut query_string =
            "SELECT id, user_id, book_id, format, cfi_range, text_content, color, note, created_at, updated_at \
             FROM highlights WHERE user_id = ?".to_string();

        let mut bindings: Vec<String> = vec![user_id.to_string()];

        if let Some(book_id) = book_id_filter {
            query_string.push_str(" AND book_id = ?");
            bindings.push(book_id.to_string());
        }
        if let Some(color) = color_filter {
            query_string.push_str(" AND color = ?");
            bindings.push(color.to_string());
        }

        query_string.push_str(" ORDER BY created_at DESC");

        let mut sql_query = sqlx::query(&query_string);
        for binding in &bindings {
            sql_query = sql_query.bind(binding);
        }

        let rows = sql_query.fetch_all(&self.pool).await?;

        Ok(rows
            .iter()
            .map(|row| StoredHighlight {
                id: row.get("id"),
                user_id: row.get("user_id"),
                book_id: row.get("book_id"),
                format: row.get("format"),
                cfi_range: row.get("cfi_range"),
                text_content: row.get("text_content"),
                color: row.get("color"),
                note: row.get("note"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    // --- Webhooks ---

    /// Create a new webhook. Returns the generated ID.
    pub async fn create_webhook(
        &self,
        user_id: &str,
        name: &str,
        url: &str,
        secret: Option<&str>,
        events: &[String],
    ) -> Result<String, DbError> {
        let webhook_id = uuid::Uuid::new_v4().to_string();
        let events_joined = events.join(",");

        sqlx::query(
            "INSERT INTO webhooks (id, user_id, name, url, secret, events) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&webhook_id)
        .bind(user_id)
        .bind(name)
        .bind(url)
        .bind(secret)
        .bind(&events_joined)
        .execute(&self.pool)
        .await?;

        Ok(webhook_id)
    }

    /// List all webhooks for a user.
    pub async fn list_webhooks(&self, user_id: &str) -> Result<Vec<StoredWebhook>, DbError> {
        let rows = sqlx::query(
            "SELECT id, user_id, name, url, secret, events, is_active, created_at \
             FROM webhooks WHERE user_id = ? ORDER BY created_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let events_str: String = row.get("events");
                StoredWebhook {
                    id: row.get("id"),
                    user_id: row.get("user_id"),
                    name: row.get("name"),
                    url: row.get("url"),
                    secret: row.get("secret"),
                    events: events_str.split(',').map(|s| s.to_string()).collect(),
                    is_active: row.get::<i32, _>("is_active") != 0,
                    created_at: row.get("created_at"),
                }
            })
            .collect())
    }

    /// Update a webhook's mutable fields.
    pub async fn update_webhook(
        &self,
        webhook_id: &str,
        user_id: &str,
        name: Option<&str>,
        url: Option<&str>,
        secret: Option<&str>,
        events: Option<&[String]>,
        is_active: Option<bool>,
    ) -> Result<(), DbError> {
        if let Some(name) = name {
            sqlx::query("UPDATE webhooks SET name = ? WHERE id = ? AND user_id = ?")
                .bind(name)
                .bind(webhook_id)
                .bind(user_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(url) = url {
            sqlx::query("UPDATE webhooks SET url = ? WHERE id = ? AND user_id = ?")
                .bind(url)
                .bind(webhook_id)
                .bind(user_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(secret) = secret {
            sqlx::query("UPDATE webhooks SET secret = ? WHERE id = ? AND user_id = ?")
                .bind(secret)
                .bind(webhook_id)
                .bind(user_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(events) = events {
            let events_joined = events.join(",");
            sqlx::query("UPDATE webhooks SET events = ? WHERE id = ? AND user_id = ?")
                .bind(&events_joined)
                .bind(webhook_id)
                .bind(user_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(is_active) = is_active {
            sqlx::query("UPDATE webhooks SET is_active = ? WHERE id = ? AND user_id = ?")
                .bind(is_active as i32)
                .bind(webhook_id)
                .bind(user_id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    /// Delete a webhook owned by the given user.
    pub async fn delete_webhook(&self, webhook_id: &str, user_id: &str) -> Result<(), DbError> {
        let result = sqlx::query("DELETE FROM webhooks WHERE id = ? AND user_id = ?")
            .bind(webhook_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Get all active webhooks subscribed to a given event.
    pub async fn get_webhooks_for_event(
        &self,
        event: &str,
    ) -> Result<Vec<StoredWebhook>, DbError> {
        // SQLite LIKE to match comma-separated events containing the target event.
        let rows = sqlx::query(
            "SELECT id, user_id, name, url, secret, events, is_active, created_at \
             FROM webhooks WHERE is_active = 1 AND (',' || events || ',') LIKE '%,' || ? || ',%'",
        )
        .bind(event)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let events_str: String = row.get("events");
                StoredWebhook {
                    id: row.get("id"),
                    user_id: row.get("user_id"),
                    name: row.get("name"),
                    url: row.get("url"),
                    secret: row.get("secret"),
                    events: events_str.split(',').map(|s| s.to_string()).collect(),
                    is_active: true,
                    created_at: row.get("created_at"),
                }
            })
            .collect())
    }

    /// Log a webhook delivery attempt.
    pub async fn log_webhook_delivery(
        &self,
        webhook_id: &str,
        event: &str,
        payload_json: &str,
        response_status: Option<i32>,
        response_body: Option<&str>,
        is_success: bool,
    ) -> Result<String, DbError> {
        let delivery_id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO webhook_deliveries (id, webhook_id, event, payload_json, response_status, response_body, is_success) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&delivery_id)
        .bind(webhook_id)
        .bind(event)
        .bind(payload_json)
        .bind(response_status)
        .bind(response_body)
        .bind(is_success as i32)
        .execute(&self.pool)
        .await?;

        Ok(delivery_id)
    }

    /// Get delivery history for a webhook.
    pub async fn get_webhook_deliveries(
        &self,
        webhook_id: &str,
        limit: i64,
    ) -> Result<Vec<StoredWebhookDelivery>, DbError> {
        let rows = sqlx::query(
            "SELECT id, webhook_id, event, payload_json, response_status, response_body, delivered_at, is_success \
             FROM webhook_deliveries WHERE webhook_id = ? ORDER BY delivered_at DESC LIMIT ?",
        )
        .bind(webhook_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredWebhookDelivery {
                id: row.get("id"),
                webhook_id: row.get("webhook_id"),
                event: row.get("event"),
                payload_json: row.get("payload_json"),
                response_status: row.get("response_status"),
                response_body: row.get("response_body"),
                delivered_at: row.get("delivered_at"),
                is_success: row.get::<i32, _>("is_success") != 0,
            })
            .collect())
    }

    /// Get a single webhook by ID (for ownership check).
    pub async fn get_webhook(&self, webhook_id: &str) -> Result<Option<StoredWebhook>, DbError> {
        let row = sqlx::query(
            "SELECT id, user_id, name, url, secret, events, is_active, created_at \
             FROM webhooks WHERE id = ?",
        )
        .bind(webhook_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| {
            let events_str: String = row.get("events");
            StoredWebhook {
                id: row.get("id"),
                user_id: row.get("user_id"),
                name: row.get("name"),
                url: row.get("url"),
                secret: row.get("secret"),
                events: events_str.split(',').map(|s| s.to_string()).collect(),
                is_active: row.get::<i32, _>("is_active") != 0,
                created_at: row.get("created_at"),
            }
        }))
    }

    // --- Library access control ---

    /// Set the library access list for a user. Pass empty vec to clear (grant access to all).
    pub async fn set_library_access(
        &self,
        user_id: &str,
        library_ids: &[String],
    ) -> Result<(), DbError> {
        sqlx::query("DELETE FROM library_access WHERE user_id = ?")
            .bind(user_id)
            .execute(&self.pool)
            .await?;

        for library_id in library_ids {
            sqlx::query("INSERT INTO library_access (user_id, library_id) VALUES (?, ?)")
                .bind(user_id)
                .bind(library_id)
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    /// Get the list of accessible library IDs for a user.
    /// Returns None if no restrictions (user sees all libraries).
    /// Returns Some(vec) if the user is restricted to specific libraries.
    pub async fn get_accessible_libraries(
        &self,
        user_id: &str,
    ) -> Result<Option<Vec<String>>, DbError> {
        let rows = sqlx::query("SELECT library_id FROM library_access WHERE user_id = ?")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;

        if rows.is_empty() {
            Ok(None) // No restrictions — user sees all
        } else {
            Ok(Some(rows.iter().map(|row| row.get("library_id")).collect()))
        }
    }

    /// Clear all library access restrictions for a user (grant access to all).
    pub async fn clear_library_access(&self, user_id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM library_access WHERE user_id = ?")
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // --- Reading goals ---

    /// Set (upsert) a reading goal for a user in a given year.
    pub async fn set_reading_goal(
        &self,
        user_id: &str,
        year: i32,
        target_books: i32,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO reading_goals (user_id, year, target_books) \
             VALUES (?, ?, ?) \
             ON CONFLICT(user_id, year) DO UPDATE SET target_books = excluded.target_books",
        )
        .bind(user_id)
        .bind(year)
        .bind(target_books)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get the reading goal for a user in a given year.
    pub async fn get_reading_goal(
        &self,
        user_id: &str,
        year: i32,
    ) -> Result<Option<StoredReadingGoal>, DbError> {
        let row = sqlx::query(
            "SELECT user_id, year, target_books, created_at \
             FROM reading_goals WHERE user_id = ? AND year = ?",
        )
        .bind(user_id)
        .bind(year)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| StoredReadingGoal {
            user_id: row.get("user_id"),
            year: row.get("year"),
            target_books: row.get("target_books"),
            created_at: row.get("created_at"),
        }))
    }

    /// Mark a book as completed for a user. Idempotent (ignores if already exists).
    pub async fn mark_book_completed(
        &self,
        user_id: &str,
        book_id: &str,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO completed_books (user_id, book_id) \
             VALUES (?, ?) \
             ON CONFLICT(user_id, book_id) DO NOTHING",
        )
        .bind(user_id)
        .bind(book_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Unmark a book as completed for a user.
    pub async fn unmark_book_completed(
        &self,
        user_id: &str,
        book_id: &str,
    ) -> Result<(), DbError> {
        sqlx::query("DELETE FROM completed_books WHERE user_id = ? AND book_id = ?")
            .bind(user_id)
            .bind(book_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Get completed books for a user in a given year (by completed_at timestamp).
    pub async fn get_completed_books(
        &self,
        user_id: &str,
        year: i32,
    ) -> Result<Vec<StoredCompletedBook>, DbError> {
        let year_start = format!("{year}-01-01T00:00:00Z");
        let year_end = format!("{}-01-01T00:00:00Z", year + 1);

        let rows = sqlx::query(
            "SELECT user_id, book_id, completed_at \
             FROM completed_books \
             WHERE user_id = ? AND completed_at >= ? AND completed_at < ? \
             ORDER BY completed_at ASC",
        )
        .bind(user_id)
        .bind(&year_start)
        .bind(&year_end)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| StoredCompletedBook {
                user_id: row.get("user_id"),
                book_id: row.get("book_id"),
                completed_at: row.get("completed_at"),
            })
            .collect())
    }

    /// Get total count of completed books for a user in a given year.
    pub async fn get_completed_count(
        &self,
        user_id: &str,
        year: i32,
    ) -> Result<i64, DbError> {
        let year_start = format!("{year}-01-01T00:00:00Z");
        let year_end = format!("{}-01-01T00:00:00Z", year + 1);

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM completed_books \
             WHERE user_id = ? AND completed_at >= ? AND completed_at < ?",
        )
        .bind(user_id)
        .bind(&year_start)
        .bind(&year_end)
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }

    /// Get total count of all completed books for a user (all time).
    pub async fn get_total_completed_count(&self, user_id: &str) -> Result<i64, DbError> {
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM completed_books WHERE user_id = ?")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await?;

        Ok(count)
    }

    /// Get distinct dates (YYYY-MM-DD) on which a user had activity (book_opened or progress_updated).
    /// Used for streak calculation.
    pub async fn get_activity_dates(
        &self,
        user_id: &str,
    ) -> Result<Vec<String>, DbError> {
        let rows = sqlx::query(
            "SELECT DISTINCT date(created_at) AS activity_date \
             FROM activity_log \
             WHERE user_id = ? AND action IN ('book_opened', 'progress_updated') \
             ORDER BY activity_date DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.iter().map(|row| row.get("activity_date")).collect())
    }

    /// Get completed books by month for a user in a given year.
    /// Returns Vec of (month_number, count) tuples.
    pub async fn get_completed_by_month(
        &self,
        user_id: &str,
        year: i32,
    ) -> Result<Vec<(i32, i64)>, DbError> {
        let year_start = format!("{year}-01-01T00:00:00Z");
        let year_end = format!("{}-01-01T00:00:00Z", year + 1);

        let rows = sqlx::query(
            "SELECT CAST(strftime('%m', completed_at) AS INTEGER) AS month_number, \
                    COUNT(*) AS book_count \
             FROM completed_books \
             WHERE user_id = ? AND completed_at >= ? AND completed_at < ? \
             GROUP BY month_number \
             ORDER BY month_number",
        )
        .bind(user_id)
        .bind(&year_start)
        .bind(&year_end)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| (row.get::<i32, _>("month_number"), row.get::<i64, _>("book_count")))
            .collect())
    }
}
