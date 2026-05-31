//! Optional write-back of applied metadata overrides to Calibre.
//!
//! Two mechanisms, selected by the `calibre_writeback_mode` setting:
//!   - "calibredb": shell out to Calibre's `calibredb set_metadata` CLI.
//!   - "content_server": call a running Calibre Content Server's set-fields API.
//!
//! Direct writes to metadata.db are never performed (corruption risk); both
//! paths go through Calibre's own tooling. Write-back is best-effort: failures
//! are reported but never block the Ironshelf override (which always succeeds).

use std::path::{Path, PathBuf};

use crate::state::{AppState, LibrarySource};

const KEY_MODE: &str = "calibre_writeback_mode";
const KEY_CALIBREDB_PATH: &str = "calibredb_path";
const KEY_CS_URL: &str = "calibre_cs_url";
const KEY_CS_USERNAME: &str = "calibre_cs_username";
const KEY_CS_PASSWORD: &str = "calibre_cs_password";
const KEY_CS_LIBRARY_ID: &str = "calibre_cs_library_id";

/// Fields pushed to Calibre — limited to what Ironshelf overrides store.
struct CalibreFields {
    title: Option<String>,
    comments: Option<String>,
    tags: Vec<String>,
}

impl CalibreFields {
    fn is_empty(&self) -> bool {
        self.title.is_none() && self.comments.is_none() && self.tags.is_empty()
    }
}

/// Push the book's current overrides to Calibre per the configured mode.
/// Returns Ok(true) when a write succeeded, Ok(false) when disabled / nothing
/// to write, and Err(msg) on failure. Never panics.
pub async fn push_overrides(state: &AppState, calibre_book_id: i64) -> Result<bool, String> {
    let db = &state.ironshelf_db;

    let mode = db
        .get_cloud_config(KEY_MODE)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "none".to_string());
    if mode.is_empty() || mode == "none" {
        return Ok(false);
    }

    let override_row = db
        .get_book_override(&calibre_book_id.to_string())
        .await
        .map_err(|error| error.to_string())?;
    let Some(book_override) = override_row else {
        return Ok(false);
    };

    let tags = book_override
        .tags_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<Vec<String>>(json).ok())
        .unwrap_or_default();
    let fields = CalibreFields {
        title: book_override.title,
        comments: book_override.description,
        tags,
    };
    if fields.is_empty() {
        return Ok(false);
    }

    match mode.as_str() {
        "calibredb" => {
            let library_path = find_calibre_library_path(state, calibre_book_id)
                .await
                .ok_or_else(|| "book is not in a Calibre library".to_string())?;
            let binary = db
                .get_cloud_config(KEY_CALIBREDB_PATH)
                .await
                .ok()
                .flatten()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "calibredb".to_string());
            run_calibredb(&binary, &library_path, calibre_book_id, &fields).await
        }
        "content_server" => {
            let base_url = db
                .get_cloud_config(KEY_CS_URL)
                .await
                .ok()
                .flatten()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Calibre Content Server URL is not configured".to_string())?;
            let username = db
                .get_cloud_config(KEY_CS_USERNAME)
                .await
                .ok()
                .flatten()
                .unwrap_or_default();
            let password = db
                .get_cloud_config(KEY_CS_PASSWORD)
                .await
                .ok()
                .flatten()
                .unwrap_or_default();
            let library_id = db
                .get_cloud_config(KEY_CS_LIBRARY_ID)
                .await
                .ok()
                .flatten()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "Calibre_Library".to_string());
            run_content_server(
                &state.http_client,
                &base_url,
                &username,
                &password,
                &library_id,
                calibre_book_id,
                &fields,
            )
            .await
        }
        other => Err(format!("unknown calibre_writeback_mode: {other}")),
    }
}

/// Locate the Calibre library directory that contains the given book id.
async fn find_calibre_library_path(state: &AppState, book_id: i64) -> Option<PathBuf> {
    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        if let LibrarySource::Calibre(calibre) = &library.source {
            if let Ok(Some(_)) = calibre.book(book_id).await {
                return Some(calibre.library_path().to_path_buf());
            }
        }
    }
    None
}

async fn run_calibredb(
    binary: &str,
    library_path: &Path,
    book_id: i64,
    fields: &CalibreFields,
) -> Result<bool, String> {
    use tokio::process::Command;

    let mut command = Command::new(binary);
    command
        .arg("set_metadata")
        .arg("--with-library")
        .arg(library_path)
        .arg(book_id.to_string());

    if let Some(title) = &fields.title {
        command.arg("--field").arg(format!("title:{title}"));
    }
    if let Some(comments) = &fields.comments {
        command.arg("--field").arg(format!("comments:{comments}"));
    }
    if !fields.tags.is_empty() {
        command
            .arg("--field")
            .arg(format!("tags:{}", fields.tags.join(",")));
    }

    let output = command
        .output()
        .await
        .map_err(|error| format!("failed to run '{binary}': {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "calibredb exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(true)
}

async fn run_content_server(
    client: &reqwest::Client,
    base_url: &str,
    username: &str,
    password: &str,
    library_id: &str,
    book_id: i64,
    fields: &CalibreFields,
) -> Result<bool, String> {
    // Calibre Content Server set-fields endpoint:
    //   POST /cdb/set-fields/{book_id}/{library_id}
    //   { "changes": { field: value, ... }, "loaded_book_ids": [book_id] }
    let mut changes = serde_json::Map::new();
    if let Some(title) = &fields.title {
        changes.insert("title".to_string(), serde_json::json!(title));
    }
    if let Some(comments) = &fields.comments {
        changes.insert("comments".to_string(), serde_json::json!(comments));
    }
    if !fields.tags.is_empty() {
        changes.insert("tags".to_string(), serde_json::json!(fields.tags));
    }
    let body = serde_json::json!({
        "changes": changes,
        "loaded_book_ids": [book_id],
    });

    let url = format!(
        "{}/cdb/set-fields/{}/{}",
        base_url.trim_end_matches('/'),
        book_id,
        library_id
    );

    let mut request = client.post(&url).json(&body);
    if !username.is_empty() {
        request = request.basic_auth(username, Some(password));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("content server request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "content server returned {}",
            response.status()
        ));
    }
    Ok(true)
}
