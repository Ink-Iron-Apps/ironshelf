//! Auto-acquisition engine — book discovery, monitoring, downloading, and import.
//!
//! Speaks Torznab/Newznab (Prowlarr, Jackett) for indexer search and integrates
//! with qBittorrent, Transmission, Deluge for torrent downloads plus direct HTTP
//! download for non-torrent sources.

pub mod download_clients;
pub mod import;
pub mod indexers;
pub mod search;

use thiserror::Error;

/// Errors from the acquisition subsystem.
#[derive(Debug, Error)]
pub enum AcquisitionError {
    #[error("HTTP request failed: {0}")]
    HttpRequest(#[from] reqwest::Error),

    #[error("XML parse error: {0}")]
    XmlParse(String),

    #[error("client authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("download client error: {0}")]
    ClientError(String),

    #[error("no enabled download client configured")]
    NoDownloadClient,

    #[error("no enabled indexers configured")]
    NoIndexers,

    #[error("import error: {0}")]
    ImportError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// A search result from an indexer query.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchResult {
    pub title: String,
    pub author_guess: Option<String>,
    pub size_bytes: Option<i64>,
    pub download_url: String,
    pub magnet_url: Option<String>,
    pub info_hash: Option<String>,
    pub seeders: Option<i32>,
    pub leechers: Option<i32>,
    pub category: Option<String>,
    pub indexer_name: String,
    pub published_at: Option<String>,
}

/// Status of a download tracked by a torrent/download client.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadStatus {
    pub state: DownloadState,
    pub progress_percent: f64,
    pub download_speed: Option<u64>,
    pub eta_seconds: Option<i64>,
}

/// Possible states of a download in a client.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum DownloadState {
    Downloading,
    Seeding,
    Completed,
    Paused,
    Failed,
    Unknown,
}
