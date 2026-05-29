//! Reading goal endpoints — /api/v1/me/reading-goal

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ReadingGoalQuery {
    pub year: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct SetReadingGoalRequest {
    pub year: i32,
    pub target: i32,
}

/// GET /api/v1/me/reading-goal — get reading goal + progress for a year.
/// Defaults to current year if no year query param is provided.
pub async fn get_reading_goal(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Query(query): Query<ReadingGoalQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let year = query
        .year
        .unwrap_or_else(|| chrono::Utc::now().format("%Y").to_string().parse().unwrap_or(2026));

    let goal = state
        .ironshelf_db
        .get_reading_goal(&current_user.user_id, year)
        .await
        .map_err(AppError::internal)?;

    let completed = state
        .ironshelf_db
        .get_completed_count(&current_user.user_id, year)
        .await
        .map_err(AppError::internal)?;

    match goal {
        Some(stored_goal) => {
            let percent = if stored_goal.target_books > 0 {
                ((completed as f64 / stored_goal.target_books as f64) * 100.0).min(100.0)
            } else {
                0.0
            };

            Ok(Json(serde_json::json!({
                "year": stored_goal.year,
                "target": stored_goal.target_books,
                "completed": completed,
                "percent": (percent * 10.0).round() / 10.0,
            })))
        }
        None => {
            // No goal set — return null-like response with just completed count.
            Ok(Json(serde_json::json!({
                "year": year,
                "target": 0,
                "completed": completed,
                "percent": 0.0,
            })))
        }
    }
}

/// POST /api/v1/me/reading-goal — set or update a reading goal.
pub async fn set_reading_goal(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Json(request): Json<SetReadingGoalRequest>,
) -> Result<StatusCode, AppError> {
    if request.target < 1 {
        return Err(AppError::BadRequest(
            "target must be at least 1".to_string(),
        ));
    }

    if request.year < 2000 || request.year > 2100 {
        return Err(AppError::BadRequest(
            "year must be between 2000 and 2100".to_string(),
        ));
    }

    state
        .ironshelf_db
        .set_reading_goal(&current_user.user_id, request.year, request.target)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}
