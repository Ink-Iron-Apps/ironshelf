//! Unified error type for all API routes.
//!
//! Returns JSON bodies with `error` (human message) and `code` (machine-readable tag).

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Application-level error that converts to a proper JSON HTTP response.
#[derive(Debug)]
pub enum AppError {
    /// 404 — resource not found.
    NotFound(String),
    /// 401 — authentication required or invalid credentials.
    Unauthorized(String),
    /// 403 — authenticated but insufficient permissions.
    Forbidden(String),
    /// 400 — malformed request, validation failure.
    BadRequest(String),
    /// 409 — resource already exists or conflicting state.
    Conflict(String),
    /// 422 — semantically invalid (path doesn't exist, etc).
    UnprocessableEntity(String),
    /// 429 — rate limit or account lockout; inner value = Retry-After seconds.
    TooManyRequests(u64),
    /// 500 — unexpected internal failure.
    Internal(String),
}

impl AppError {
    /// Shortcut for not-found with a generic message.
    pub fn not_found(resource: &str) -> Self {
        Self::NotFound(format!("{resource} not found"))
    }

    /// Shortcut for internal error from any Display-able source.
    pub fn internal(source: impl std::fmt::Display) -> Self {
        Self::Internal(source.to_string())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // TooManyRequests gets a Retry-After header — handle separately.
        if let Self::TooManyRequests(retry_after_secs) = self {
            let body = json!({
                "error": "Too many requests. Please try again later.",
                "code": "too_many_requests",
                "retry_after": retry_after_secs,
            });
            return (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, retry_after_secs.to_string())],
                Json(body),
            )
                .into_response();
        }

        let (status, code, message) = match self {
            Self::NotFound(message) => (StatusCode::NOT_FOUND, "not_found", message),
            Self::Unauthorized(message) => (StatusCode::UNAUTHORIZED, "unauthorized", message),
            Self::Forbidden(message) => (StatusCode::FORBIDDEN, "forbidden", message),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, "bad_request", message),
            Self::Conflict(message) => (StatusCode::CONFLICT, "conflict", message),
            Self::UnprocessableEntity(message) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "unprocessable_entity", message)
            }
            Self::TooManyRequests(_) => unreachable!("handled above"),
            Self::Internal(message) => {
                tracing::error!("internal error: {message}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An internal error occurred".to_string(),
                )
            }
        };

        let body = json!({
            "error": message,
            "code": code,
        });

        (status, Json(body)).into_response()
    }
}

/// Allow converting a raw String error (from LibrarySource methods) into AppError.
impl From<String> for AppError {
    fn from(source: String) -> Self {
        Self::Internal(source)
    }
}
