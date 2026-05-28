//! Embedded web UI serving via rust-embed.

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../web/"]
struct WebAssets;

/// Serve embedded web UI files. Falls back to index.html for SPA routing.
pub async fn serve_web(
    axum::extract::Path(path): axum::extract::Path<String>,
) -> Response {
    serve_file(&path)
}

/// Serve root (index.html).
pub async fn serve_index() -> Response {
    serve_file("index.html")
}

fn serve_file(path: &str) -> Response {
    match WebAssets::get(path) {
        Some(file) => {
            let mime = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();

            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, mime),
                    (header::CACHE_CONTROL, "public, max-age=3600".to_string()),
                ],
                file.data.to_vec(),
            )
                .into_response()
        }
        None => {
            // SPA fallback: serve index.html for unknown paths
            match WebAssets::get("index.html") {
                Some(file) => (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "text/html".to_string())],
                    file.data.to_vec(),
                )
                    .into_response(),
                None => StatusCode::NOT_FOUND.into_response(),
            }
        }
    }
}
