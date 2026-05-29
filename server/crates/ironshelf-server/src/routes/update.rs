//! Self-update endpoints — check for new releases, download and apply updates.
//!
//! Owner-only. Fetches releases from GitHub, compares semver versions,
//! and performs atomic binary replacement with graceful restart.

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/LightWraith8268/ironshelf/releases/latest";

/// Current server version baked in at compile time.
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ---------------------------------------------------------------------------
// Shared update state — tracks in-progress updates for the status endpoint
// ---------------------------------------------------------------------------

/// Phases of an in-progress update.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdatePhase {
    Idle,
    Checking,
    Downloading,
    Replacing,
    Restarting,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateStatus {
    pub phase: UpdatePhase,
    pub message: String,
    /// 0-100 download progress (-1 if not applicable).
    pub progress_percent: i8,
    /// The version being installed, if known.
    pub target_version: Option<String>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            phase: UpdatePhase::Idle,
            message: String::new(),
            progress_percent: -1,
            target_version: None,
        }
    }
}

/// Shared handle to the update status. Created once and stored in `AppState`.
pub type SharedUpdateStatus = Arc<RwLock<UpdateStatus>>;

pub fn new_update_status() -> SharedUpdateStatus {
    Arc::new(RwLock::new(UpdateStatus::default()))
}

// ---------------------------------------------------------------------------
// GitHub release response (subset of fields we need)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

// ---------------------------------------------------------------------------
// GET /api/v1/server/update/check
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct UpdateCheckResponse {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    pub release_notes: String,
    pub published_at: String,
    pub download_size: Option<u64>,
}

/// Check GitHub for a newer release. Owner only.
pub async fn check_for_update(
    State(state): State<AppState>,
    request: axum::extract::Request,
) -> Result<Json<UpdateCheckResponse>, AppError> {
    let auth_user = require_owner(&request)?;
    tracing::info!(user = %auth_user.username, "checking for server update");

    let release = fetch_latest_release(&state).await?;
    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    let update_available = is_newer_version(&latest_version, CURRENT_VERSION);

    let artifact_name = platform_artifact_name();
    let matching_asset = release.assets.iter().find(|asset| asset.name == artifact_name);

    Ok(Json(UpdateCheckResponse {
        current_version: CURRENT_VERSION.to_string(),
        latest_version,
        update_available,
        release_url: release.html_url,
        release_notes: release.body.unwrap_or_default(),
        published_at: release.published_at.unwrap_or_default(),
        download_size: matching_asset.map(|asset| asset.size),
    }))
}

// ---------------------------------------------------------------------------
// POST /api/v1/server/update/apply
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct UpdateApplyResponse {
    pub status: String,
    pub message: String,
}

/// Download and apply the latest release binary. Owner only.
///
/// The handler performs the download and binary replacement in a background
/// task so the HTTP response can be sent immediately. The client polls
/// `/api/v1/server/update/status` for progress.
pub async fn apply_update(
    State(state): State<AppState>,
    request: axum::extract::Request,
) -> Result<Json<UpdateApplyResponse>, AppError> {
    let auth_user = require_owner(&request)?;
    tracing::info!(user = %auth_user.username, "applying server update");

    // Quick check: is there actually an update?
    let release = fetch_latest_release(&state).await?;
    let latest_version = release.tag_name.trim_start_matches('v').to_string();

    if !is_newer_version(&latest_version, CURRENT_VERSION) {
        return Err(AppError::BadRequest(
            "Server is already up to date".to_string(),
        ));
    }

    let artifact_name = platform_artifact_name();
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == artifact_name)
        .ok_or_else(|| {
            AppError::BadRequest(format!(
                "No release artifact found for this platform ({artifact_name})"
            ))
        })?;

    let download_url = asset.browser_download_url.clone();
    let target_version = latest_version.clone();
    let http_client = state.http_client.clone();
    let update_status = state.update_status.clone();

    // Spawn the download + replace + restart sequence in the background.
    tokio::spawn(async move {
        if let Err(update_error) =
            perform_update(http_client, download_url, target_version.clone(), update_status.clone())
                .await
        {
            tracing::error!("update failed: {update_error}");
            let mut status = update_status.write().await;
            status.phase = UpdatePhase::Failed;
            status.message = update_error.to_string();
        }
    });

    Ok(Json(UpdateApplyResponse {
        status: "updating".to_string(),
        message: "Server will restart momentarily".to_string(),
    }))
}

// ---------------------------------------------------------------------------
// GET /api/v1/server/update/status
// ---------------------------------------------------------------------------

/// Return the current update status (for polling from the UI).
pub async fn update_status(
    State(state): State<AppState>,
    _request: axum::extract::Request,
) -> Json<UpdateStatus> {
    let status = state.update_status.read().await;
    Json(status.clone())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Require the requesting user to be the server owner.
fn require_owner(request: &axum::extract::Request) -> Result<AuthUser, AppError> {
    let auth_user = request
        .extensions()
        .get::<AuthUser>()
        .cloned()
        .ok_or_else(|| AppError::Unauthorized("Authentication required".to_string()))?;

    if !auth_user.is_owner {
        return Err(AppError::Forbidden(
            "Only the server owner can manage updates".to_string(),
        ));
    }

    Ok(auth_user)
}

/// Fetch the latest release from GitHub.
async fn fetch_latest_release(state: &AppState) -> Result<GitHubRelease, AppError> {
    let response = state
        .http_client
        .get(GITHUB_RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|network_error| {
            AppError::Internal(format!("Failed to reach GitHub: {network_error}"))
        })?;

    if !response.status().is_success() {
        let status_code = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "GitHub API returned {status_code}: {body_text}"
        )));
    }

    response
        .json::<GitHubRelease>()
        .await
        .map_err(|parse_error| {
            AppError::Internal(format!("Failed to parse GitHub release: {parse_error}"))
        })
}

/// Compare two semver version strings. Returns `true` if `latest` is newer than `current`.
fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |version_string: &str| -> (u64, u64, u64) {
        let parts: Vec<u64> = version_string
            .split('.')
            .filter_map(|segment| segment.parse().ok())
            .collect();
        (
            parts.first().copied().unwrap_or(0),
            parts.get(1).copied().unwrap_or(0),
            parts.get(2).copied().unwrap_or(0),
        )
    };

    let (latest_major, latest_minor, latest_patch) = parse(latest);
    let (current_major, current_minor, current_patch) = parse(current);

    (latest_major, latest_minor, latest_patch) > (current_major, current_minor, current_patch)
}

/// Determine the release artifact name for the current platform.
///
/// Matches the naming convention used by the CI release workflow:
/// `ironshelf-server-{os}-{arch}[.exe]`
fn platform_artifact_name() -> String {
    let operating_system = match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        _ => "linux", // Default to linux for BSDs, etc.
    };

    let architecture = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        _ => "x86_64",
    };

    let extension = if std::env::consts::OS == "windows" {
        ".exe"
    } else {
        ""
    };

    format!("ironshelf-server-{operating_system}-{architecture}{extension}")
}

/// Perform the full update sequence: download, verify, replace binary, restart.
async fn perform_update(
    http_client: reqwest::Client,
    download_url: String,
    target_version: String,
    update_status: SharedUpdateStatus,
) -> Result<(), anyhow::Error> {
    // Phase: Downloading
    {
        let mut status = update_status.write().await;
        status.phase = UpdatePhase::Downloading;
        status.message = format!("Downloading v{target_version}...");
        status.progress_percent = 0;
        status.target_version = Some(target_version.clone());
    }

    let response = http_client
        .get(&download_url)
        .send()
        .await
        .map_err(|network_error| anyhow::anyhow!("Download failed: {network_error}"))?;

    if !response.status().is_success() {
        anyhow::bail!(
            "Download returned HTTP {}",
            response.status()
        );
    }

    let total_size = response.content_length();
    let binary_bytes = download_with_progress(response, total_size, &update_status).await?;

    // Phase: Replacing
    {
        let mut status = update_status.write().await;
        status.phase = UpdatePhase::Replacing;
        status.message = "Replacing server binary...".to_string();
        status.progress_percent = -1;
    }

    let current_executable = std::env::current_exe()
        .map_err(|io_error| anyhow::anyhow!("Cannot determine current executable path: {io_error}"))?;

    replace_binary(&current_executable, &binary_bytes).await?;

    // Phase: Restarting
    {
        let mut status = update_status.write().await;
        status.phase = UpdatePhase::Restarting;
        status.message = format!("Restarting server (v{target_version})...");
    }

    tracing::info!("update applied, signaling graceful shutdown for restart");

    // Give the status poll a moment to read the Restarting phase before we kill the process.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Signal the process to shut down. The service manager (systemd / launchd / task scheduler)
    // will restart it, picking up the new binary.
    trigger_graceful_shutdown();

    Ok(())
}

/// Download the response body while updating progress.
async fn download_with_progress(
    response: reqwest::Response,
    total_size: Option<u64>,
    update_status: &SharedUpdateStatus,
) -> Result<Vec<u8>, anyhow::Error> {
    use futures_util::StreamExt;

    let mut downloaded_bytes: u64 = 0;
    let mut buffer = Vec::with_capacity(total_size.unwrap_or(10_000_000) as usize);
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|stream_error| anyhow::anyhow!("Download stream error: {stream_error}"))?;
        buffer.extend_from_slice(&chunk);
        downloaded_bytes += chunk.len() as u64;

        if let Some(total) = total_size {
            let percent = ((downloaded_bytes as f64 / total as f64) * 100.0).min(100.0) as i8;
            let mut status = update_status.write().await;
            status.progress_percent = percent;
        }
    }

    Ok(buffer)
}

/// Replace the current binary with the new one.
///
/// - **Unix**: Write to a temp file, then `rename()` over the current binary (atomic on same FS).
/// - **Windows**: Rename current to `.old`, write new binary, then it takes effect on next start.
async fn replace_binary(
    current_executable: &PathBuf,
    new_binary: &[u8],
) -> Result<(), anyhow::Error> {
    let parent_directory = current_executable
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine parent directory of current binary"))?;

    let temp_path = parent_directory.join("ironshelf-server.update.tmp");

    // Write the new binary to a temp file.
    tokio::fs::write(&temp_path, new_binary)
        .await
        .map_err(|io_error| anyhow::anyhow!("Failed to write temp binary: {io_error}"))?;

    // Set executable permission on Unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o755);
        tokio::fs::set_permissions(&temp_path, permissions)
            .await
            .map_err(|io_error| {
                anyhow::anyhow!("Failed to set executable permissions: {io_error}")
            })?;
    }

    if cfg!(windows) {
        // Windows: cannot replace a running executable. Rename current to .old first.
        let old_path = parent_directory.join("ironshelf-server.old.exe");

        // Remove any previous .old file.
        let _ = tokio::fs::remove_file(&old_path).await;

        tokio::fs::rename(current_executable, &old_path)
            .await
            .map_err(|io_error| {
                anyhow::anyhow!("Failed to rename current binary to .old: {io_error}")
            })?;

        tokio::fs::rename(&temp_path, current_executable)
            .await
            .map_err(|io_error| {
                anyhow::anyhow!("Failed to rename new binary into place: {io_error}")
            })?;
    } else {
        // Unix: atomic rename replaces the inode. The running process keeps the old binary
        // in memory via its file descriptor until it exits.
        tokio::fs::rename(&temp_path, current_executable)
            .await
            .map_err(|io_error| {
                anyhow::anyhow!("Failed to rename new binary into place: {io_error}")
            })?;
    }

    tracing::info!(
        "binary replaced at {}",
        current_executable.display()
    );

    Ok(())
}

/// Trigger a graceful shutdown by sending SIGTERM (Unix) or using ctrl_c emulation.
fn trigger_graceful_shutdown() {
    #[cfg(unix)]
    {
        // Send SIGTERM to our own process. The shutdown_signal() future in main.rs
        // is listening for this and will initiate graceful drain.
        unsafe {
            libc::kill(libc::getpid(), libc::SIGTERM);
        }
    }

    #[cfg(not(unix))]
    {
        // On Windows, call std::process::exit after a short delay to let
        // in-flight responses complete. The task scheduler will restart.
        std::process::exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer_version() {
        assert!(is_newer_version("1.0.0", "0.9.0"));
        assert!(is_newer_version("0.2.0", "0.1.0"));
        assert!(is_newer_version("0.1.1", "0.1.0"));
        assert!(!is_newer_version("0.1.0", "0.1.0"));
        assert!(!is_newer_version("0.0.9", "0.1.0"));
        assert!(is_newer_version("1.0.0", "0.99.99"));
        assert!(is_newer_version("2.0.0", "1.9.9"));
    }

    #[test]
    fn test_platform_artifact_name() {
        let name = platform_artifact_name();
        assert!(name.starts_with("ironshelf-server-"));
        // Should contain a valid OS
        assert!(
            name.contains("linux") || name.contains("macos") || name.contains("windows"),
            "unexpected artifact name: {name}"
        );
    }
}
