//! On-demand cover thumbnail resizing and disk caching.
//!
//! Requested dimensions are clamped to a maximum of 1200px on either axis.
//! Cached thumbnails are stored as JPEG files at:
//!   `{cache_dir}/{book_id}_{width}x{height}_q{quality}.jpg`

use image::imageops::FilterType;
use image::ImageReader;
use std::path::Path;
use tokio::fs;

/// Maximum allowed dimension (width or height) for a thumbnail request.
const MAX_DIMENSION: u32 = 1200;

/// Default JPEG quality (1-100).
const DEFAULT_QUALITY: u8 = 80;

/// Thumbnail generation parameters.
#[derive(Debug, Clone)]
pub struct ThumbnailParams {
    pub width: u32,
    pub height: u32,
    pub quality: u8,
}

impl ThumbnailParams {
    /// Create params with clamped dimensions and quality.
    pub fn new(width: u32, height: u32, quality: Option<u8>) -> Self {
        Self {
            width: width.min(MAX_DIMENSION).max(1),
            height: height.min(MAX_DIMENSION).max(1),
            quality: quality.unwrap_or(DEFAULT_QUALITY).min(100).max(1),
        }
    }

    /// Build the cache file name for these params.
    /// Sanitizes book_id to prevent path traversal (strips path separators and dots).
    pub fn cache_filename(&self, book_id: &str) -> String {
        let sanitized_id: String = book_id
            .chars()
            .filter(|character| character.is_alphanumeric() || *character == '-' || *character == '_')
            .collect();
        format!(
            "{}_{}x{}_q{}.jpg",
            sanitized_id, self.width, self.height, self.quality
        )
    }
}

/// Attempt to serve a cached thumbnail. Returns `Some(bytes)` if cached file exists.
pub async fn get_cached_thumbnail(
    cache_directory: &Path,
    book_id: &str,
    params: &ThumbnailParams,
) -> Option<Vec<u8>> {
    let cache_path = cache_directory.join(params.cache_filename(book_id));
    fs::read(&cache_path).await.ok()
}

/// Generate a thumbnail from the original cover image, save it to cache, and return bytes.
///
/// This function performs blocking image operations via `spawn_blocking` to avoid
/// starving the async runtime.
pub async fn generate_thumbnail(
    original_path: &Path,
    cache_directory: &Path,
    book_id: &str,
    params: &ThumbnailParams,
) -> Result<Vec<u8>, ThumbnailError> {
    // Ensure cache directory exists
    fs::create_dir_all(cache_directory)
        .await
        .map_err(|error| ThumbnailError::Io(error.to_string()))?;

    let original_path_owned = original_path.to_path_buf();
    let cache_path = cache_directory.join(params.cache_filename(book_id));
    let width = params.width;
    let height = params.height;
    let quality = params.quality;
    let cache_path_clone = cache_path.clone();

    // Blocking image resize on a thread pool thread
    let jpeg_bytes = tokio::task::spawn_blocking(move || {
        let image = ImageReader::open(&original_path_owned)
            .map_err(|error| ThumbnailError::Io(error.to_string()))?
            .decode()
            .map_err(|error| ThumbnailError::Decode(error.to_string()))?;

        // Resize maintaining aspect ratio within the bounding box
        let resized = image.resize(width, height, FilterType::Lanczos3);

        // Encode as JPEG
        let mut buffer = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buffer);
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
        resized
            .write_with_encoder(encoder)
            .map_err(|error| ThumbnailError::Encode(error.to_string()))?;

        // Write to cache file (best-effort, failure here is not fatal)
        if let Err(write_error) = std::fs::write(&cache_path_clone, &buffer) {
            tracing::warn!(
                "failed to write thumbnail cache file {}: {write_error}",
                cache_path_clone.display()
            );
        }

        Ok::<Vec<u8>, ThumbnailError>(buffer)
    })
    .await
    .map_err(|error| ThumbnailError::Io(error.to_string()))??;

    Ok(jpeg_bytes)
}

/// Invalidate all cached thumbnails for a specific book.
pub async fn invalidate_book_thumbnails(cache_directory: &Path, book_id: &str) {
    let prefix = format!("{book_id}_");
    if let Ok(mut entries) = fs::read_dir(cache_directory).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.starts_with(&prefix) && file_name.ends_with(".jpg") {
                    let _ = fs::remove_file(entry.path()).await;
                }
            }
        }
    }
}

/// Invalidate the entire thumbnail cache (used during library rescans).
pub async fn invalidate_all_thumbnails(cache_directory: &Path) {
    if let Ok(mut entries) = fs::read_dir(cache_directory).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".jpg") {
                    let _ = fs::remove_file(entry.path()).await;
                }
            }
        }
    }
}

/// Errors that can occur during thumbnail generation.
#[derive(Debug, thiserror::Error)]
pub enum ThumbnailError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("image decode error: {0}")]
    Decode(String),
    #[error("image encode error: {0}")]
    Encode(String),
}
