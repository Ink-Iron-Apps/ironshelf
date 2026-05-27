//! Server statistics and activity log endpoints.

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::{require_owner, AuthUser};
use crate::error::AppError;
use crate::state::AppState;

// --- Response types ---

#[derive(Debug, Serialize)]
pub struct PopularBookEntry {
    pub book_id: String,
    pub title: String,
    pub open_count: i64,
}

#[derive(Debug, Serialize)]
pub struct ActivityLogEntry {
    pub id: i64,
    pub user_id: String,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub details_json: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ServerStatsResponse {
    pub total_books: i64,
    pub total_authors: i64,
    pub total_series: i64,
    pub total_users: i64,
    pub total_libraries: i64,
    pub books_read: i64,
    pub active_readers: i64,
    pub storage_bytes: u64,
    pub popular_books: Vec<PopularBookEntry>,
    pub recent_activity: Vec<ActivityLogEntry>,
}

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    pub limit: Option<i64>,
}

// --- Handlers ---

/// GET /api/v1/stats — server-wide statistics (owner only).
pub async fn server_stats(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<Json<ServerStatsResponse>, AppError> {
    require_owner(&current_user)?;

    let pool = state.ironshelf_db.pool();

    // Aggregate book/author/series counts across all loaded libraries.
    // Collect data while holding the read lock, then drop it before doing
    // filesystem stat calls (which can be slow for large libraries or NFS).
    let mut total_books: i64 = 0;
    let mut total_authors: i64 = 0;
    let mut total_series: i64 = 0;
    let mut storage_bytes: u64 = 0;
    let mut file_paths_to_stat: Vec<std::path::PathBuf> = Vec::new();

    {
        let libraries = state.libraries.read().await;
        for library in libraries.iter() {
            if let Ok(books) = library.source.all_books().await {
                total_books += books.len() as i64;

                // Collect file paths for later stat calls outside the lock.
                for book in &books {
                    for format in &book.formats {
                        let file_path = library
                            .source
                            .format_path(&book.path, &format.file_name, &format.kind)
                            .await;
                        file_paths_to_stat.push(file_path);
                    }
                }
            }

            if let Ok(authors) = library.source.authors().await {
                total_authors += authors.len() as i64;

                // Count series across all authors.
                for author in &authors {
                    if let Ok(author_series) = library.source.series_by_author(author.id).await {
                        total_series += author_series.len() as i64;
                    }
                }
            }
        }
    }

    // Stat file sizes outside the libraries lock to avoid blocking mutations.
    for file_path in &file_paths_to_stat {
        if let Ok(metadata) = tokio::fs::metadata(file_path).await {
            storage_bytes += metadata.len();
        }
    }

    // User and library counts from Ironshelf DB.
    let total_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let total_libraries: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM library_config")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Books read: distinct books where a user reached >= 100% progress.
    let books_read: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT book_id) FROM reading_progress WHERE percent >= 1.0",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Active readers: distinct users with any reading progress updated in the last 30 days.
    let active_readers: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT user_id) FROM reading_progress \
         WHERE updated_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    // Popular books: top 10 by open count from activity log.
    let popular_rows = sqlx::query(
        "SELECT target_id AS book_id, \
                COALESCE(details_json, '{}') AS details, \
                COUNT(*) AS open_count \
         FROM activity_log \
         WHERE action = 'book_opened' AND target_id IS NOT NULL \
         GROUP BY target_id \
         ORDER BY open_count DESC \
         LIMIT 10",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut popular_books: Vec<PopularBookEntry> = Vec::new();
    for row in &popular_rows {
        let book_id: String = row.get("book_id");
        let open_count: i64 = row.get("open_count");
        let details_str: String = row.get("details");

        // Try to extract title from stored details_json, fall back to book_id.
        let title = serde_json::from_str::<serde_json::Value>(&details_str)
            .ok()
            .and_then(|value| value.get("title").and_then(|title| title.as_str().map(String::from)))
            .unwrap_or_else(|| book_id.clone());

        popular_books.push(PopularBookEntry {
            book_id,
            title,
            open_count,
        });
    }

    // Recent server-wide activity (last 20 entries).
    let activity_entries = state
        .ironshelf_db
        .get_server_activity(20)
        .await
        .unwrap_or_default();

    let recent_activity: Vec<ActivityLogEntry> = activity_entries
        .into_iter()
        .map(|entry| ActivityLogEntry {
            id: entry.id,
            user_id: entry.user_id,
            action: entry.action,
            target_type: entry.target_type,
            target_id: entry.target_id,
            details_json: entry
                .details_json
                .as_deref()
                .and_then(|json_string| serde_json::from_str(json_string).ok()),
            created_at: entry.created_at,
        })
        .collect();

    Ok(Json(ServerStatsResponse {
        total_books,
        total_authors,
        total_series,
        total_users,
        total_libraries,
        books_read,
        active_readers,
        storage_bytes,
        popular_books,
        recent_activity,
    }))
}

/// GET /api/v1/activity — current user's recent activity.
pub async fn user_activity(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Vec<ActivityLogEntry>>, AppError> {
    let limit = query.limit.unwrap_or(50).min(200);

    let activity_entries = state
        .ironshelf_db
        .get_recent_activity(&current_user.user_id, limit)
        .await
        .map_err(|database_error| AppError::internal(database_error))?;

    let entries: Vec<ActivityLogEntry> = activity_entries
        .into_iter()
        .map(|entry| ActivityLogEntry {
            id: entry.id,
            user_id: entry.user_id,
            action: entry.action,
            target_type: entry.target_type,
            target_id: entry.target_id,
            details_json: entry
                .details_json
                .as_deref()
                .and_then(|json_string| serde_json::from_str(json_string).ok()),
            created_at: entry.created_at,
        })
        .collect();

    Ok(Json(entries))
}

/// GET /api/v1/activity/all — server-wide activity (owner only).
pub async fn server_activity(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Vec<ActivityLogEntry>>, AppError> {
    require_owner(&current_user)?;

    let limit = query.limit.unwrap_or(50).min(200);

    let activity_entries = state
        .ironshelf_db
        .get_server_activity(limit)
        .await
        .map_err(|database_error| AppError::internal(database_error))?;

    let entries: Vec<ActivityLogEntry> = activity_entries
        .into_iter()
        .map(|entry| ActivityLogEntry {
            id: entry.id,
            user_id: entry.user_id,
            action: entry.action,
            target_type: entry.target_type,
            target_id: entry.target_id,
            details_json: entry
                .details_json
                .as_deref()
                .and_then(|json_string| serde_json::from_str(json_string).ok()),
            created_at: entry.created_at,
        })
        .collect();

    Ok(Json(entries))
}
