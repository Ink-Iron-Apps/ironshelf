//! Ratings and reviews endpoints — /api/v1/books/{id}/ratings, /api/v1/books/{id}/reviews

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

// --- Ratings ---

#[derive(Debug, Serialize)]
pub struct RatingsResponse {
    pub average: Option<f64>,
    pub count: i64,
    pub user_rating: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct SetRatingRequest {
    pub rating: i32,
}

/// GET /api/v1/books/{id}/ratings — get ratings summary for a book.
pub async fn get_book_ratings(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
) -> Result<Json<RatingsResponse>, AppError> {
    let pool = state.ironshelf_db.pool();

    let stats_row = sqlx::query(
        "SELECT COUNT(*) as count, AVG(CAST(rating AS REAL)) as average \
         FROM user_ratings WHERE book_id = ?",
    )
    .bind(&book_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::internal)?;

    let count: i64 = stats_row.get("count");
    let average: Option<f64> = if count > 0 {
        stats_row.get("average")
    } else {
        None
    };

    let user_rating_row = sqlx::query(
        "SELECT rating FROM user_ratings WHERE user_id = ? AND book_id = ?",
    )
    .bind(&current_user.user_id)
    .bind(&book_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    let user_rating = user_rating_row.map(|row| row.get::<i32, _>("rating"));

    Ok(Json(RatingsResponse {
        average,
        count,
        user_rating,
    }))
}

/// POST /api/v1/books/{id}/ratings — set or update the current user's rating.
pub async fn set_book_rating(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
    Json(request): Json<SetRatingRequest>,
) -> Result<StatusCode, AppError> {
    if request.rating < 1 || request.rating > 10 {
        return Err(AppError::BadRequest(
            "rating must be between 1 and 10".to_string(),
        ));
    }

    let pool = state.ironshelf_db.pool();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO user_ratings (user_id, book_id, rating, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(user_id, book_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at",
    )
    .bind(&current_user.user_id)
    .bind(&book_id)
    .bind(request.rating)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

// --- Reviews ---

#[derive(Debug, Serialize)]
pub struct ReviewResponse {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub book_id: String,
    pub title: Option<String>,
    pub body: String,
    pub contains_spoilers: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateReviewRequest {
    pub title: Option<String>,
    pub body: String,
    #[serde(default)]
    pub contains_spoilers: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateReviewRequest {
    pub title: Option<String>,
    pub body: Option<String>,
    pub contains_spoilers: Option<bool>,
}

/// GET /api/v1/books/{id}/reviews — list all reviews for a book.
pub async fn list_book_reviews(
    State(state): State<AppState>,
    Path(book_id): Path<String>,
) -> Result<Json<Vec<ReviewResponse>>, AppError> {
    let pool = state.ironshelf_db.pool();

    let rows = sqlx::query(
        "SELECT r.id, r.user_id, u.username, r.book_id, r.title, r.body, \
         r.contains_spoilers, r.created_at, r.updated_at \
         FROM user_reviews r JOIN users u ON u.id = r.user_id \
         WHERE r.book_id = ? ORDER BY r.created_at DESC",
    )
    .bind(&book_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::internal)?;

    let reviews = rows
        .iter()
        .map(|row| ReviewResponse {
            id: row.get("id"),
            user_id: row.get("user_id"),
            username: row.get("username"),
            book_id: row.get("book_id"),
            title: row.get("title"),
            body: row.get("body"),
            contains_spoilers: row.get::<i32, _>("contains_spoilers") != 0,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect();

    Ok(Json(reviews))
}

/// POST /api/v1/books/{id}/reviews — create a review for a book.
pub async fn create_review(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
    Json(request): Json<CreateReviewRequest>,
) -> Result<(StatusCode, Json<ReviewResponse>), AppError> {
    if request.body.trim().is_empty() {
        return Err(AppError::BadRequest(
            "review body must not be empty".to_string(),
        ));
    }

    let pool = state.ironshelf_db.pool();
    let review_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let spoilers_flag: i32 = if request.contains_spoilers { 1 } else { 0 };

    sqlx::query(
        "INSERT INTO user_reviews (id, user_id, book_id, title, body, contains_spoilers, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&review_id)
    .bind(&current_user.user_id)
    .bind(&book_id)
    .bind(&request.title)
    .bind(&request.body)
    .bind(spoilers_flag)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    Ok((
        StatusCode::CREATED,
        Json(ReviewResponse {
            id: review_id,
            user_id: current_user.user_id.clone(),
            username: current_user.username.clone(),
            book_id,
            title: request.title,
            body: request.body,
            contains_spoilers: request.contains_spoilers,
            created_at: now.clone(),
            updated_at: now,
        }),
    ))
}

/// GET /api/v1/reviews/{id} — get a single review by ID.
pub async fn get_review(
    State(state): State<AppState>,
    Path(review_id): Path<String>,
) -> Result<Json<ReviewResponse>, AppError> {
    let pool = state.ironshelf_db.pool();

    let row = sqlx::query(
        "SELECT r.id, r.user_id, u.username, r.book_id, r.title, r.body, \
         r.contains_spoilers, r.created_at, r.updated_at \
         FROM user_reviews r JOIN users u ON u.id = r.user_id \
         WHERE r.id = ?",
    )
    .bind(&review_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    let row = row.ok_or_else(|| AppError::not_found("review"))?;

    Ok(Json(ReviewResponse {
        id: row.get("id"),
        user_id: row.get("user_id"),
        username: row.get("username"),
        book_id: row.get("book_id"),
        title: row.get("title"),
        body: row.get("body"),
        contains_spoilers: row.get::<i32, _>("contains_spoilers") != 0,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }))
}

/// PATCH /api/v1/reviews/{id} — update a review (owner only).
pub async fn update_review(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(review_id): Path<String>,
    Json(request): Json<UpdateReviewRequest>,
) -> Result<StatusCode, AppError> {
    let pool = state.ironshelf_db.pool();

    // Verify ownership.
    let existing = sqlx::query("SELECT user_id FROM user_reviews WHERE id = ?")
        .bind(&review_id)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?;

    let existing = existing.ok_or_else(|| AppError::not_found("review"))?;
    let owner_id: String = existing.get("user_id");

    if owner_id != current_user.user_id && !current_user.is_owner {
        return Err(AppError::Forbidden(
            "You can only edit your own reviews".to_string(),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Build dynamic update — only set provided fields.
    let mut set_clauses = vec!["updated_at = ?".to_string()];
    let mut bind_values: Vec<String> = vec![now];

    if let Some(ref title) = request.title {
        set_clauses.push("title = ?".to_string());
        bind_values.push(title.clone());
    }
    if let Some(ref body) = request.body {
        if body.trim().is_empty() {
            return Err(AppError::BadRequest(
                "review body must not be empty".to_string(),
            ));
        }
        set_clauses.push("body = ?".to_string());
        bind_values.push(body.clone());
    }
    if let Some(contains_spoilers) = request.contains_spoilers {
        set_clauses.push("contains_spoilers = ?".to_string());
        bind_values.push(if contains_spoilers {
            "1".to_string()
        } else {
            "0".to_string()
        });
    }

    let sql = format!(
        "UPDATE user_reviews SET {} WHERE id = ?",
        set_clauses.join(", ")
    );

    let mut query = sqlx::query(&sql);
    for value in &bind_values {
        query = query.bind(value);
    }
    query = query.bind(&review_id);

    query.execute(pool).await.map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/reviews/{id} — delete a review (owner or admin).
pub async fn delete_review(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(review_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let pool = state.ironshelf_db.pool();

    // Verify ownership.
    let existing = sqlx::query("SELECT user_id FROM user_reviews WHERE id = ?")
        .bind(&review_id)
        .fetch_optional(pool)
        .await
        .map_err(AppError::internal)?;

    let existing = existing.ok_or_else(|| AppError::not_found("review"))?;
    let owner_id: String = existing.get("user_id");

    if owner_id != current_user.user_id && !current_user.is_owner {
        return Err(AppError::Forbidden(
            "You can only delete your own reviews".to_string(),
        ));
    }

    sqlx::query("DELETE FROM user_reviews WHERE id = ?")
        .bind(&review_id)
        .execute(pool)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}
