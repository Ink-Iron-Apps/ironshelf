//! Server converter availability — /api/v1/server/converters

use axum::Json;
use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct ConvertersResponse {
    pub available: bool,
    pub formats: Vec<String>,
}

/// GET /api/v1/server/converters — check if ebook-convert (Calibre CLI) is available.
pub async fn server_converters() -> Result<Json<ConvertersResponse>, AppError> {
    // Check if ebook-convert is in PATH.
    let is_available = check_ebook_convert_available().await;

    let formats = if is_available {
        vec![
            "EPUB".to_string(),
            "PDF".to_string(),
            "MOBI".to_string(),
            "AZW3".to_string(),
            "DOCX".to_string(),
            "TXT".to_string(),
            "RTF".to_string(),
            "CBZ".to_string(),
        ]
    } else {
        Vec::new()
    };

    Ok(Json(ConvertersResponse {
        available: is_available,
        formats,
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
