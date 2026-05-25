//! Ironshelf's own read/write database (users, sessions, api_keys, progress, config).

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::Path;
use std::str::FromStr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
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
        sqlx::raw_sql(migration_sql)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Get a reference to the underlying pool.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}
