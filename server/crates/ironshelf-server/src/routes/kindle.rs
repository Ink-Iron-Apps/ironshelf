//! Send-to-Kindle endpoints.
//!
//! Allows users to store their @kindle.com email address and send book files
//! to their Kindle via Amazon's Send-to-Kindle email service.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SetKindleEmailRequest {
    pub kindle_email: String,
}

#[derive(Serialize)]
pub struct KindleEmailResponse {
    pub kindle_email: Option<String>,
}

#[derive(Deserialize)]
pub struct SendToKindleRequest {
    /// Optional format override (e.g., "epub", "pdf", "mobi").
    /// If omitted, the server picks the first Kindle-compatible format available.
    pub format: Option<String>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `GET /api/v1/users/me/kindle-email` — get the current user's Kindle email.
pub async fn get_kindle_email(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<impl IntoResponse, AppError> {
    let kindle_email = state
        .ironshelf_db
        .get_kindle_email(&auth_user.user_id)
        .await
        .map_err(AppError::internal)?;

    Ok(Json(KindleEmailResponse { kindle_email }))
}

/// `PUT /api/v1/users/me/kindle-email` — save or update the Kindle email.
pub async fn set_kindle_email(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(payload): Json<SetKindleEmailRequest>,
) -> Result<impl IntoResponse, AppError> {
    let trimmed_email = payload.kindle_email.trim().to_string();

    // Basic validation: must end with @kindle.com or @free.kindle.com
    if !trimmed_email.ends_with("@kindle.com") && !trimmed_email.ends_with("@free.kindle.com") {
        return Err(AppError::BadRequest(
            "Kindle email must end with @kindle.com or @free.kindle.com".to_string(),
        ));
    }

    // Must have a local part before the @
    if trimmed_email.starts_with('@') {
        return Err(AppError::BadRequest(
            "Invalid Kindle email address".to_string(),
        ));
    }

    let kindle_email_value = if trimmed_email.is_empty() {
        None
    } else {
        Some(trimmed_email.as_str())
    };

    state
        .ironshelf_db
        .set_kindle_email(&auth_user.user_id, kindle_email_value)
        .await
        .map_err(AppError::internal)?;

    Ok((
        StatusCode::OK,
        Json(json!({ "kindle_email": kindle_email_value })),
    ))
}

/// `POST /api/v1/books/{id}/send-to-kindle` — send a book to the user's Kindle.
pub async fn send_to_kindle(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(book_id): Path<i64>,
    Json(payload): Json<SendToKindleRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Check SMTP is configured
    let smtp_config = state
        .smtp_config
        .as_ref()
        .ok_or_else(|| {
            AppError::UnprocessableEntity(
                "SMTP is not configured on this server. Send-to-Kindle requires SMTP settings."
                    .to_string(),
            )
        })?;

    // Check user has a Kindle email set
    let kindle_email = state
        .ironshelf_db
        .get_kindle_email(&auth_user.user_id)
        .await
        .map_err(AppError::internal)?
        .ok_or_else(|| {
            AppError::BadRequest(
                "No Kindle email configured. Set your Kindle email first via PUT /api/v1/users/me/kindle-email"
                    .to_string(),
            )
        })?;

    // Find the book across libraries
    let libraries = state.libraries.read().await;
    let mut found_book = None;
    let mut found_library = None;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            found_book = Some(book);
            found_library = Some(library);
            break;
        }
    }

    let book = found_book.ok_or_else(|| AppError::not_found("Book"))?;
    let library = found_library.unwrap();

    // Determine which format to send
    let requested_format = payload.format.as_deref();
    let chosen_format = pick_kindle_format(&book.formats, requested_format)?;

    // Resolve the file path
    let file_path = library.source.format_path(
        &book.path,
        &book.formats.iter().find(|format| format.kind == chosen_format).unwrap().file_name,
        &chosen_format,
    );

    if !file_path.exists() {
        return Err(AppError::NotFound(format!(
            "Book file not found on disk: {}",
            file_path.display()
        )));
    }

    // Convert SmtpConfig to EmailConfig
    let email_config = ironshelf_core::email::EmailConfig {
        smtp_host: smtp_config.host.clone(),
        smtp_port: smtp_config.port,
        smtp_user: smtp_config.user.clone(),
        smtp_password: smtp_config.password.clone(),
        from_address: smtp_config.from_address.clone(),
    };

    // Send the book
    ironshelf_core::email::send_book_to_kindle(
        &email_config,
        &kindle_email,
        &book.title,
        &file_path,
        &chosen_format,
    )
    .await
    .map_err(AppError::internal)?;

    tracing::info!(
        user_id = %auth_user.user_id,
        book_id = book_id,
        format = %chosen_format,
        kindle_email = %kindle_email,
        "book sent to kindle"
    );

    // Log activity
    let details = serde_json::to_string(&json!({
        "book_title": book.title,
        "format": chosen_format,
        "kindle_email": kindle_email,
    }))
    .ok();

    let _ = state
        .ironshelf_db
        .log_activity(
            &auth_user.user_id,
            "send_to_kindle",
            Some("book"),
            Some(&book_id.to_string()),
            details.as_deref(),
        )
        .await;

    Ok((
        StatusCode::OK,
        Json(json!({
            "message": "Book sent to Kindle",
            "book_title": book.title,
            "format": chosen_format,
            "kindle_email": kindle_email,
        })),
    ))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Pick the best Kindle-compatible format from available formats.
fn pick_kindle_format(
    available_formats: &[ironshelf_core::model::Format],
    requested: Option<&str>,
) -> Result<String, AppError> {
    // Kindle-compatible formats in preference order
    let kindle_formats = ["epub", "mobi", "pdf"];

    if let Some(requested_format) = requested {
        let lower = requested_format.to_lowercase();
        if !ironshelf_core::email::is_kindle_supported_format(&lower) {
            return Err(AppError::BadRequest(format!(
                "Format '{}' is not supported for Send-to-Kindle. Supported: epub, mobi, pdf",
                requested_format
            )));
        }
        // Check the book actually has this format
        if available_formats.iter().any(|format| format.kind.eq_ignore_ascii_case(&lower)) {
            return Ok(lower);
        }
        return Err(AppError::NotFound(format!(
            "Book does not have format '{}'",
            requested_format
        )));
    }

    // Auto-pick: prefer epub > mobi > pdf
    for preferred in &kindle_formats {
        if available_formats
            .iter()
            .any(|format| format.kind.eq_ignore_ascii_case(preferred))
        {
            return Ok(preferred.to_string());
        }
    }

    Err(AppError::UnprocessableEntity(
        "Book has no Kindle-compatible formats (epub, mobi, pdf)".to_string(),
    ))
}
