//! Format conversion endpoints — /api/v1/books/{id}/convert, /api/v1/conversions/{id}

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ConversionJobResponse {
    pub id: String,
    pub book_id: String,
    pub source_format: String,
    pub target_format: String,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConvertRequest {
    pub target_format: String,
}

/// POST /api/v1/books/{id}/convert — start a format conversion job.
pub async fn start_conversion(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(book_id): Path<String>,
    Json(request): Json<ConvertRequest>,
) -> Result<(StatusCode, Json<ConversionJobResponse>), AppError> {
    let target_format = request.target_format.to_uppercase();
    let valid_formats = ["EPUB", "PDF", "MOBI", "AZW3", "DOCX", "TXT", "RTF", "CBZ"];
    if !valid_formats.contains(&target_format.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Unsupported target format: {}. Valid formats: {}",
            target_format,
            valid_formats.join(", ")
        )));
    }

    // Check ebook-convert availability.
    let converter_available = check_ebook_convert_available().await;
    if !converter_available {
        return Err(AppError::BadRequest(
            "ebook-convert is not available on this server".to_string(),
        ));
    }

    // Detect source format from the book's file path in the library.
    let source_format = detect_book_format(&state, &book_id).await?;

    let pool = state.ironshelf_db.pool();
    let job_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO conversion_jobs (id, user_id, book_id, source_format, target_format, status, created_at) \
         VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    )
    .bind(&job_id)
    .bind(&current_user.user_id)
    .bind(&book_id)
    .bind(&source_format)
    .bind(&target_format)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(AppError::internal)?;

    // Spawn background conversion task.
    let conversion_state = state.clone();
    let conversion_job_id = job_id.clone();
    let conversion_book_id = book_id.clone();
    let conversion_source = source_format.clone();
    let conversion_target = target_format.clone();
    tokio::spawn(async move {
        run_conversion(
            &conversion_state,
            &conversion_job_id,
            &conversion_book_id,
            &conversion_source,
            &conversion_target,
        )
        .await;
    });

    Ok((
        StatusCode::ACCEPTED,
        Json(ConversionJobResponse {
            id: job_id,
            book_id,
            source_format,
            target_format,
            status: "pending".to_string(),
            error_message: None,
            created_at: now,
            completed_at: None,
        }),
    ))
}

/// GET /api/v1/conversions/{id} — get conversion job status.
pub async fn get_conversion_status(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
    Path(job_id): Path<String>,
) -> Result<Json<ConversionJobResponse>, AppError> {
    let pool = state.ironshelf_db.pool();

    let row = sqlx::query(
        "SELECT id, book_id, source_format, target_format, status, error_message, \
         created_at, completed_at FROM conversion_jobs WHERE id = ? AND user_id = ?",
    )
    .bind(&job_id)
    .bind(&current_user.user_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::internal)?;

    let row = row.ok_or_else(|| AppError::not_found("conversion job"))?;

    Ok(Json(ConversionJobResponse {
        id: row.get("id"),
        book_id: row.get("book_id"),
        source_format: row.get("source_format"),
        target_format: row.get("target_format"),
        status: row.get("status"),
        error_message: row.get("error_message"),
        created_at: row.get("created_at"),
        completed_at: row.get("completed_at"),
    }))
}

/// Check whether `ebook-convert` is accessible in the system PATH.
async fn check_ebook_convert_available() -> bool {
    let result = tokio::process::Command::new("ebook-convert")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;

    matches!(result, Ok(status) if status.success())
}

/// Detect the primary file format for a book by checking the libraries.
async fn detect_book_format(state: &AppState, book_id: &str) -> Result<String, AppError> {
    let numeric_id: i64 = book_id
        .parse()
        .map_err(|_| AppError::BadRequest("invalid book id".to_string()))?;

    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(numeric_id).await {
            if let Some(format) = book.formats.first() {
                return Ok(format.kind.to_uppercase());
            }
        }
    }
    Err(AppError::not_found("book or book has no file formats"))
}

/// Run the ebook-convert process in the background and update job status.
async fn run_conversion(
    state: &AppState,
    job_id: &str,
    book_id: &str,
    source_format: &str,
    target_format: &str,
) {
    let pool = state.ironshelf_db.pool();

    // Update status to processing.
    let _ = sqlx::query("UPDATE conversion_jobs SET status = 'processing' WHERE id = ?")
        .bind(job_id)
        .execute(pool)
        .await;

    // Find the source file.
    let source_path = match find_book_file(state, book_id, source_format).await {
        Some(path) => path,
        None => {
            let _ = sqlx::query(
                "UPDATE conversion_jobs SET status = 'failed', error_message = ?, \
                 completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            )
            .bind("Source file not found")
            .bind(job_id)
            .execute(pool)
            .await;
            return;
        }
    };

    // Build output path next to source.
    let source_stem = std::path::Path::new(&source_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let source_dir = std::path::Path::new(&source_path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    let output_path = source_dir
        .join(format!("{}.{}", source_stem, target_format.to_lowercase()))
        .to_string_lossy()
        .to_string();

    // Run ebook-convert.
    let result = tokio::process::Command::new("ebook-convert")
        .arg(&source_path)
        .arg(&output_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .status()
        .await;

    match result {
        Ok(status) if status.success() => {
            let _ = sqlx::query(
                "UPDATE conversion_jobs SET status = 'completed', output_path = ?, \
                 completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            )
            .bind(&output_path)
            .bind(job_id)
            .execute(pool)
            .await;
        }
        Ok(status) => {
            let error_message = format!("ebook-convert exited with code {}", status.code().unwrap_or(-1));
            let _ = sqlx::query(
                "UPDATE conversion_jobs SET status = 'failed', error_message = ?, \
                 completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            )
            .bind(&error_message)
            .bind(job_id)
            .execute(pool)
            .await;
        }
        Err(conversion_error) => {
            let _ = sqlx::query(
                "UPDATE conversion_jobs SET status = 'failed', error_message = ?, \
                 completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
            )
            .bind(conversion_error.to_string())
            .bind(job_id)
            .execute(pool)
            .await;
        }
    }
}

/// Find the actual file path for a book's format.
async fn find_book_file(state: &AppState, book_id: &str, format: &str) -> Option<String> {
    let numeric_id: i64 = book_id.parse().ok()?;
    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(numeric_id).await {
            for book_format in &book.formats {
                if book_format.kind.eq_ignore_ascii_case(format) {
                    // Build full path from book path + format file_name.
                    let full_path = std::path::Path::new(&book.path)
                        .join(&book_format.file_name)
                        .to_string_lossy()
                        .to_string();
                    return Some(full_path);
                }
            }
        }
    }
    None
}
