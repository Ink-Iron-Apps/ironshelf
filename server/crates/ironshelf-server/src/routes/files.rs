use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};

use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct FileQuery {
    pub format: Option<String>,
}

/// Parse an HTTP Range header value like "bytes=0-499" or "bytes=500-".
/// Returns (start, optional_end) on success.
fn parse_range_header(range_header: &str, file_size: u64) -> Option<(u64, u64)> {
    let range_str = range_header.strip_prefix("bytes=")?;

    // Only support single range (not multipart ranges)
    if range_str.contains(',') {
        return None;
    }

    let parts: Vec<&str> = range_str.splitn(2, '-').collect();
    if parts.len() != 2 {
        return None;
    }

    let start_str = parts[0].trim();
    let end_str = parts[1].trim();

    if start_str.is_empty() {
        // Suffix range: "-500" means last 500 bytes
        let suffix_length: u64 = end_str.parse().ok()?;
        if suffix_length == 0 || suffix_length > file_size {
            return None;
        }
        let start = file_size - suffix_length;
        Some((start, file_size - 1))
    } else {
        let start: u64 = start_str.parse().ok()?;
        if start >= file_size {
            return None;
        }
        let end = if end_str.is_empty() {
            file_size - 1
        } else {
            let parsed_end: u64 = end_str.parse().ok()?;
            parsed_end.min(file_size - 1)
        };
        if end < start {
            return None;
        }
        Some((start, end))
    }
}

/// GET /api/v1/books/:id/cover — serve cover image
pub async fn get_cover(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
) -> Result<Response, AppError> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            if !book.has_cover {
                return Err(AppError::not_found("cover"));
            }

            let cover_path = library
                .source
                .cover_path(&book.path)
                .ok_or(AppError::not_found("cover"))?;

            let bytes = tokio::fs::read(&cover_path)
                .await
                .map_err(|_| AppError::not_found("cover file"))?;

            return Ok((
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "image/jpeg".to_string()),
                    (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
                ],
                bytes,
            )
                .into_response());
        }
    }

    Err(AppError::not_found("book"))
}

/// GET /api/v1/books/:id/file?format=EPUB — serve book file with HTTP Range support.
///
/// Returns 206 Partial Content when a valid Range header is present,
/// 200 OK with the full file otherwise. Critical for epub readers and large PDFs
/// that need to seek within files without downloading entirely.
pub async fn get_file(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
    Query(query): Query<FileQuery>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            // Find requested format (default to first available)
            let format = if let Some(ref requested) = query.format {
                book.formats
                    .iter()
                    .find(|f| f.kind.eq_ignore_ascii_case(requested))
                    .ok_or(AppError::NotFound(format!(
                        "format '{}' not available for this book",
                        requested
                    )))?
            } else {
                book.formats
                    .first()
                    .ok_or(AppError::not_found("book format"))?
            };

            let file_path = library
                .source
                .format_path(&book.path, &format.file_name, &format.kind);

            let content_type = match format.kind.to_uppercase().as_str() {
                "EPUB" => "application/epub+zip",
                "PDF" => "application/pdf",
                "CBZ" => "application/x-cbz",
                "MOBI" => "application/x-mobipocket-ebook",
                _ => "application/octet-stream",
            };

            let filename = format!(
                "{}.{}",
                book.title.replace('/', "_"),
                format.kind.to_lowercase()
            );

            // Get file metadata for size
            let file_metadata = tokio::fs::metadata(&file_path)
                .await
                .map_err(|_| AppError::not_found("book file"))?;
            let file_size = file_metadata.len();

            // Check for Range header
            if let Some(range_value) = headers.get(header::RANGE) {
                let range_str = range_value
                    .to_str()
                    .map_err(|_| AppError::BadRequest("invalid Range header".to_string()))?;

                if let Some((range_start, range_end)) = parse_range_header(range_str, file_size) {
                    let content_length = range_end - range_start + 1;

                    // Read the requested byte range
                    let mut file = File::open(&file_path)
                        .await
                        .map_err(|_| AppError::not_found("book file"))?;
                    file.seek(SeekFrom::Start(range_start))
                        .await
                        .map_err(|error| AppError::internal(error))?;

                    let mut buffer = vec![0u8; content_length as usize];
                    file.read_exact(&mut buffer)
                        .await
                        .map_err(|error| AppError::internal(error))?;

                    let content_range = format!(
                        "bytes {}-{}/{}",
                        range_start, range_end, file_size
                    );

                    return Ok((
                        StatusCode::PARTIAL_CONTENT,
                        [
                            (header::CONTENT_TYPE, content_type.to_string()),
                            (header::CONTENT_LENGTH, content_length.to_string()),
                            (header::CONTENT_RANGE, content_range),
                            (header::ACCEPT_RANGES, "bytes".to_string()),
                            (
                                header::CONTENT_DISPOSITION,
                                format!("attachment; filename=\"{filename}\""),
                            ),
                        ],
                        buffer,
                    )
                        .into_response());
                } else {
                    // Invalid range — return 416 Range Not Satisfiable
                    return Ok((
                        StatusCode::RANGE_NOT_SATISFIABLE,
                        [(
                            header::CONTENT_RANGE,
                            format!("bytes */{}", file_size),
                        )],
                        Vec::<u8>::new(),
                    )
                        .into_response());
                }
            }

            // No Range header — serve full file
            let bytes = tokio::fs::read(&file_path)
                .await
                .map_err(|_| AppError::not_found("book file"))?;

            return Ok((
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type.to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{filename}\""),
                    ),
                    (header::CONTENT_LENGTH, file_size.to_string()),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                ],
                bytes,
            )
                .into_response());
        }
    }

    Err(AppError::not_found("book"))
}
