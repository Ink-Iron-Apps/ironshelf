//! Personal reading statistics — /api/v1/me/stats

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct CompletedBookSummary {
    pub id: String,
    pub title: String,
    pub has_cover: bool,
    pub completed_at: String,
}

#[derive(Debug, Serialize)]
pub struct MonthlyCount {
    pub month: i32,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct FormatBreakdownEntry {
    pub format: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct PersonalStatsResponse {
    pub total_books_read: i64,
    pub books_completed_this_year: i64,
    pub current_streak: i64,
    pub longest_streak: i64,
    pub monthly_books: Vec<MonthlyCount>,
    pub top_author: Option<String>,
    pub top_genre: Option<String>,
    pub average_rating: Option<f64>,
    pub format_breakdown: Vec<FormatBreakdownEntry>,
    pub completed_books: Vec<CompletedBookSummary>,
}

/// GET /api/v1/me/stats — personal reading statistics.
pub async fn personal_stats(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<Json<PersonalStatsResponse>, AppError> {
    let user_id = &current_user.user_id;
    let current_year: i32 = chrono::Utc::now()
        .format("%Y")
        .to_string()
        .parse()
        .unwrap_or(2026);

    // Total completed books (all time)
    let total_books_read = state
        .ironshelf_db
        .get_total_completed_count(user_id)
        .await
        .map_err(AppError::internal)?;

    // Books completed this year
    let books_completed_this_year = state
        .ironshelf_db
        .get_completed_count(user_id, current_year)
        .await
        .map_err(AppError::internal)?;

    // Streaks — compute from activity dates
    let activity_dates = state
        .ironshelf_db
        .get_activity_dates(user_id)
        .await
        .map_err(AppError::internal)?;

    let (current_streak, longest_streak) = compute_streaks(&activity_dates);

    // Monthly breakdown for current year
    let monthly_raw = state
        .ironshelf_db
        .get_completed_by_month(user_id, current_year)
        .await
        .map_err(AppError::internal)?;

    let monthly_books: Vec<MonthlyCount> = monthly_raw
        .into_iter()
        .map(|(month, count)| MonthlyCount { month, count })
        .collect();

    // Top author
    let top_authors = state
        .ironshelf_db
        .get_user_top_authors(user_id, 1)
        .await
        .map_err(AppError::internal)?;
    let top_author = top_authors.first().map(|(name, _)| name.clone());

    // Top genre/tag
    let top_tags = state
        .ironshelf_db
        .get_user_top_tags(user_id, 1)
        .await
        .map_err(AppError::internal)?;
    let top_genre = top_tags.first().map(|(name, _)| name.clone());

    // Average rating
    let average_rating = state
        .ironshelf_db
        .get_user_average_rating(user_id)
        .await
        .map_err(AppError::internal)?;

    // Format breakdown
    let format_raw = state
        .ironshelf_db
        .get_user_format_breakdown(user_id)
        .await
        .map_err(AppError::internal)?;
    let format_breakdown: Vec<FormatBreakdownEntry> = format_raw
        .into_iter()
        .map(|(format, count)| FormatBreakdownEntry { format, count })
        .collect();

    // Completed books this year with metadata for cover grid
    let completed_stored = state
        .ironshelf_db
        .get_completed_books(user_id, current_year)
        .await
        .map_err(AppError::internal)?;

    let libraries = state.libraries.read().await;
    let mut completed_books = Vec::with_capacity(completed_stored.len());

    for completed_entry in &completed_stored {
        let mut title = String::from("Unknown");
        let mut has_cover = false;

        // Try to find book metadata across libraries.
        let book_id_parsed = completed_entry.book_id.parse::<i64>().unwrap_or(-1);
        for library in libraries.iter() {
            if let Ok(Some(book)) = library.source.book(book_id_parsed).await {
                title = book.title.clone();
                has_cover = book.has_cover;
                break;
            }
        }

        completed_books.push(CompletedBookSummary {
            id: completed_entry.book_id.clone(),
            title,
            has_cover,
            completed_at: completed_entry.completed_at.clone(),
        });
    }

    Ok(Json(PersonalStatsResponse {
        total_books_read,
        books_completed_this_year,
        current_streak,
        longest_streak,
        monthly_books,
        top_author,
        top_genre,
        average_rating,
        format_breakdown,
        completed_books,
    }))
}

/// Compute current streak and longest streak from a list of activity dates (YYYY-MM-DD, descending).
fn compute_streaks(dates: &[String]) -> (i64, i64) {
    if dates.is_empty() {
        return (0, 0);
    }

    let today = chrono::Utc::now().date_naive();
    let mut parsed_dates: Vec<chrono::NaiveDate> = dates
        .iter()
        .filter_map(|date_string| chrono::NaiveDate::parse_from_str(date_string, "%Y-%m-%d").ok())
        .collect();

    parsed_dates.sort_unstable();
    parsed_dates.dedup();

    if parsed_dates.is_empty() {
        return (0, 0);
    }

    let mut longest_streak: i64 = 1;
    let mut current_run: i64 = 1;
    let mut current_streak: i64 = 0;

    for window in parsed_dates.windows(2) {
        let difference = window[1].signed_duration_since(window[0]).num_days();
        if difference == 1 {
            current_run += 1;
        } else {
            if current_run > longest_streak {
                longest_streak = current_run;
            }
            current_run = 1;
        }
    }

    if current_run > longest_streak {
        longest_streak = current_run;
    }

    // Current streak: count consecutive days ending at today (or yesterday).
    if let Some(&last_date) = parsed_dates.last() {
        let days_since_last = today.signed_duration_since(last_date).num_days();
        if days_since_last <= 1 {
            // Walk backwards from the end of sorted dates to count current streak.
            current_streak = 1;
            for window in parsed_dates.windows(2).rev() {
                let difference = window[1].signed_duration_since(window[0]).num_days();
                if difference == 1 {
                    current_streak += 1;
                } else {
                    break;
                }
            }
        }
    }

    (current_streak, longest_streak)
}
