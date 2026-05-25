use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use tokio::fs;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct FileQuery {
    pub format: Option<String>,
}

/// GET /api/v1/books/:id/cover — serve cover image
pub async fn get_cover(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
) -> Result<Response, StatusCode> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            if !book.has_cover {
                return Err(StatusCode::NOT_FOUND);
            }

            let cover_path = library.source.cover_path(&book.path);
            let bytes = fs::read(&cover_path)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;

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

    Err(StatusCode::NOT_FOUND)
}

/// GET /api/v1/books/:id/file?format=EPUB — serve book file (supports Range)
pub async fn get_file(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
    Query(query): Query<FileQuery>,
) -> Result<Response, StatusCode> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(book)) = library.source.book(book_id).await {
            // Find requested format (default to first available)
            let format = if let Some(ref requested) = query.format {
                book.formats
                    .iter()
                    .find(|f| f.kind.eq_ignore_ascii_case(requested))
                    .ok_or(StatusCode::NOT_FOUND)?
            } else {
                book.formats.first().ok_or(StatusCode::NOT_FOUND)?
            };

            let file_path = library
                .source
                .format_path(&book.path, &format.file_name, &format.kind);

            let bytes = fs::read(&file_path)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;

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

            return Ok((
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type.to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{filename}\""),
                    ),
                    (header::CONTENT_LENGTH, bytes.len().to_string()),
                ],
                bytes,
            )
                .into_response());
        }
    }

    Err(StatusCode::NOT_FOUND)
}
