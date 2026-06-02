//! Continue reading endpoint — returns user's in-progress books sorted by most recently updated.

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use sqlx::Row;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;
use ironshelf_core::model::Book;

/// Progress information attached to a continue-reading entry.
#[derive(Debug, Serialize)]
pub struct ProgressSummary {
    pub format: String,
    pub percent: f64,
    pub updated_at: String,
}

/// A single continue-reading entry: book data plus progress.
#[derive(Debug, Serialize)]
pub struct ContinueReadingEntry {
    pub book: Book,
    pub progress: ProgressSummary,
}

/// GET /api/v1/books/continue — returns the authenticated user's in-progress books.
///
/// Returns books where progress percent > 0 and < 1.0 (fraction), sorted by most recently updated.
/// Limited to 20 results.
pub async fn continue_reading(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<ContinueReadingEntry>>, AppError> {
    let pool = state.ironshelf_db.pool();

    // Fetch in-progress reading records for this user, ordered by most recently updated.
    let progress_rows = sqlx::query(
        "SELECT book_id, format, percent, updated_at \
         FROM reading_progress \
         WHERE user_id = ? AND percent > 0.0 AND percent < 1.0 \
         ORDER BY updated_at DESC \
         LIMIT 20",
    )
    .bind(&user.user_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::internal)?;

    let allowed = crate::access::accessible_library_ids(&state, &user).await;
    let libraries = state.libraries.read().await;
    let mut entries: Vec<ContinueReadingEntry> = Vec::new();

    for row in &progress_rows {
        let book_id: String = row.get("book_id");
        let format: String = row.get("format");
        let percent: f64 = row.get("percent");
        let updated_at: String = row.get("updated_at");

        // Parse book_id as i64 for library lookups.
        let book_id_numeric: i64 = match book_id.parse() {
            Ok(identifier) => identifier,
            Err(_) => continue, // Skip entries with non-numeric book IDs
        };

        // Search across all libraries for this book.
        let mut found_book: Option<Book> = None;
        for library in libraries.iter() {
            if !crate::access::library_allowed(&allowed, &library.id) {
                continue;
            }
            match library.source.book(book_id_numeric).await {
                Ok(Some(book)) => {
                    found_book = Some(book);
                    break;
                }
                _ => continue,
            }
        }

        if let Some(book) = found_book {
            entries.push(ContinueReadingEntry {
                book,
                progress: ProgressSummary {
                    format,
                    percent,
                    updated_at,
                },
            });
        }
    }

    Ok(Json(entries))
}
