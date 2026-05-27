//! Notification endpoints — list, count, mark read, delete.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

// --- Request / response types ---

#[derive(Debug, Deserialize)]
pub struct NotificationQuery {
    pub unread: Option<bool>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct NotificationEntry {
    pub id: String,
    pub title: String,
    pub message: String,
    pub notification_type: String,
    pub is_read: bool,
    pub link: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct UnreadCountResponse {
    pub unread: i64,
}

// --- Handlers ---

/// GET /api/v1/notifications?unread=true&limit=50
pub async fn list_notifications(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Query(query): Query<NotificationQuery>,
) -> Result<Json<Vec<NotificationEntry>>, AppError> {
    let unread_only = query.unread.unwrap_or(false);
    let limit = query.limit.unwrap_or(50).min(200);

    let notifications = state
        .ironshelf_db
        .get_notifications(&current_user.user_id, unread_only, limit)
        .await
        .map_err(AppError::internal)?;

    let entries: Vec<NotificationEntry> = notifications
        .into_iter()
        .map(|notification| NotificationEntry {
            id: notification.id,
            title: notification.title,
            message: notification.message,
            notification_type: notification.notification_type,
            is_read: notification.is_read,
            link: notification.link,
            created_at: notification.created_at,
        })
        .collect();

    Ok(Json(entries))
}

/// GET /api/v1/notifications/count
pub async fn unread_count(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<Json<UnreadCountResponse>, AppError> {
    let unread = state
        .ironshelf_db
        .get_unread_count(&current_user.user_id)
        .await
        .map_err(AppError::internal)?;

    Ok(Json(UnreadCountResponse { unread }))
}

/// PATCH /api/v1/notifications/{id}/read
pub async fn mark_read(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(notification_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .mark_notification_read(&notification_id, &current_user.user_id)
        .await
        .map_err(|database_error| match database_error {
            ironshelf_core::db::DbError::NotFound => AppError::not_found("notification"),
            other => AppError::internal(other),
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/notifications/read-all
pub async fn mark_all_read(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .mark_all_notifications_read(&current_user.user_id)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/notifications/{id}
pub async fn delete_notification(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(notification_id): Path<String>,
) -> Result<StatusCode, AppError> {
    state
        .ironshelf_db
        .delete_notification(&notification_id, &current_user.user_id)
        .await
        .map_err(|database_error| match database_error {
            ironshelf_core::db::DbError::NotFound => AppError::not_found("notification"),
            other => AppError::internal(other),
        })?;

    Ok(StatusCode::NO_CONTENT)
}
