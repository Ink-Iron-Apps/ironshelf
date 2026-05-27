//! Post-download import — move completed downloads into library folders.
//!
//! When a download completes:
//! 1. Find downloaded file(s) in download directory
//! 2. Identify format (epub, pdf, cbz by extension)
//! 3. Copy/move to target library folder
//! 4. Trigger library rescan (caller responsibility)
//! 5. Mark wanted item as fulfilled (caller responsibility)

use super::AcquisitionError;
use std::path::{Path, PathBuf};

/// Supported ebook file extensions for import.
const EBOOK_EXTENSIONS: &[&str] = &["epub", "pdf", "cbz", "cbr", "mobi", "azw3", "fb2", "djvu"];

/// Result of an import operation.
#[derive(Debug)]
pub struct ImportResult {
    /// Path where the file was copied to in the library.
    pub destination_path: PathBuf,
    /// Detected format of the imported file.
    pub format: String,
    /// Size of the imported file in bytes.
    pub size_bytes: u64,
    /// File name as it appears in the library.
    pub file_name: String,
}

/// Scan a download path (file or directory) for ebook files and import them
/// into the target library directory.
///
/// If `source_path` is a single file, imports that file directly.
/// If `source_path` is a directory, recursively finds all ebook files inside.
///
/// Files are **copied** (not moved) to preserve the original until the caller
/// confirms import success. The caller can remove the original afterwards.
pub async fn import_download(
    source_path: &Path,
    target_library_directory: &Path,
) -> Result<Vec<ImportResult>, AcquisitionError> {
    if !source_path.exists() {
        return Err(AcquisitionError::ImportError(format!(
            "source path does not exist: {}",
            source_path.display()
        )));
    }

    if !target_library_directory.exists() {
        tokio::fs::create_dir_all(target_library_directory).await?;
    }

    let ebook_files = find_ebook_files(source_path).await?;

    if ebook_files.is_empty() {
        return Err(AcquisitionError::ImportError(format!(
            "no ebook files found at: {}",
            source_path.display()
        )));
    }

    let mut import_results: Vec<ImportResult> = Vec::new();

    for file_path in &ebook_files {
        let file_name = file_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let extension = file_path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();

        let destination_path = target_library_directory.join(&file_name);

        // If a file with the same name already exists, add a numeric suffix.
        let final_destination = if destination_path.exists() {
            find_unique_destination(&destination_path)
        } else {
            destination_path
        };

        tokio::fs::copy(file_path, &final_destination).await.map_err(|io_error| {
            AcquisitionError::ImportError(format!(
                "failed to copy {} to {}: {io_error}",
                file_path.display(),
                final_destination.display()
            ))
        })?;

        let metadata = tokio::fs::metadata(&final_destination).await?;

        tracing::info!(
            "imported {} to {} ({} bytes)",
            file_path.display(),
            final_destination.display(),
            metadata.len()
        );

        import_results.push(ImportResult {
            destination_path: final_destination,
            format: extension,
            size_bytes: metadata.len(),
            file_name,
        });
    }

    Ok(import_results)
}

/// Recursively find all ebook files under a path.
async fn find_ebook_files(path: &Path) -> Result<Vec<PathBuf>, AcquisitionError> {
    let mut ebook_files: Vec<PathBuf> = Vec::new();

    if path.is_file() {
        if is_ebook_file(path) {
            ebook_files.push(path.to_path_buf());
        }
        return Ok(ebook_files);
    }

    if path.is_dir() {
        let mut read_directory = tokio::fs::read_dir(path).await?;
        while let Some(directory_entry) = read_directory.next_entry().await? {
            let entry_path = directory_entry.path();
            if entry_path.is_file() && is_ebook_file(&entry_path) {
                ebook_files.push(entry_path);
            } else if entry_path.is_dir() {
                // Recurse one level into subdirectories.
                let mut subdirectory = tokio::fs::read_dir(&entry_path).await?;
                while let Some(sub_entry) = subdirectory.next_entry().await? {
                    let sub_path = sub_entry.path();
                    if sub_path.is_file() && is_ebook_file(&sub_path) {
                        ebook_files.push(sub_path);
                    }
                }
            }
        }
    }

    Ok(ebook_files)
}

/// Check if a file has a recognized ebook extension.
fn is_ebook_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| EBOOK_EXTENSIONS.contains(&extension.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Generate a unique file path by appending a numeric suffix if the target exists.
fn find_unique_destination(base_path: &Path) -> PathBuf {
    let stem = base_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let extension = base_path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let parent = base_path.parent().unwrap_or(Path::new("."));

    let mut counter: u32 = 1;
    loop {
        let candidate = if extension.is_empty() {
            parent.join(format!("{stem} ({counter})"))
        } else {
            parent.join(format!("{stem} ({counter}).{extension}"))
        };

        if !candidate.exists() {
            return candidate;
        }

        counter += 1;
        if counter > 999 {
            // Safety valve — should never happen in practice.
            return parent.join(format!(
                "{stem}_{}.{extension}",
                uuid::Uuid::new_v4()
            ));
        }
    }
}
