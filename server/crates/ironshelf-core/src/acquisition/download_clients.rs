//! Download client integrations — qBittorrent, Transmission, Deluge, direct HTTP.
//!
//! Each client type communicates with its respective daemon via HTTP API.

use crate::db::StoredDownloadClient;
use super::{AcquisitionError, DownloadState, DownloadStatus};

/// Add a download to the configured client, returning an external ID (torrent hash or download ID).
pub async fn add_download(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    download_url: &str,
    magnet_url: Option<&str>,
) -> Result<String, AcquisitionError> {
    match client_config.client_type.as_str() {
        "qbittorrent" => {
            add_qbittorrent(http_client, client_config, download_url, magnet_url).await
        }
        "transmission" => {
            add_transmission(http_client, client_config, download_url, magnet_url).await
        }
        "deluge" => {
            add_deluge(http_client, client_config, download_url, magnet_url).await
        }
        "direct" => {
            add_direct_download(http_client, client_config, download_url).await
        }
        other => Err(AcquisitionError::ClientError(format!(
            "unsupported download client type: {other}"
        ))),
    }
}

/// Check the status of a download in the configured client.
pub async fn check_download_status(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    external_identifier: &str,
) -> Result<DownloadStatus, AcquisitionError> {
    match client_config.client_type.as_str() {
        "qbittorrent" => {
            check_qbittorrent_status(http_client, client_config, external_identifier).await
        }
        "transmission" => {
            check_transmission_status(http_client, client_config, external_identifier).await
        }
        "deluge" => {
            check_deluge_status(http_client, client_config, external_identifier).await
        }
        "direct" => {
            // Direct downloads complete immediately upon add_download returning.
            Ok(DownloadStatus {
                state: DownloadState::Completed,
                progress_percent: 100.0,
                download_speed: None,
                eta_seconds: None,
            })
        }
        other => Err(AcquisitionError::ClientError(format!(
            "unsupported download client type: {other}"
        ))),
    }
}

/// Get the file path where a completed download was saved.
pub async fn get_download_file_path(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    external_identifier: &str,
) -> Result<Option<String>, AcquisitionError> {
    match client_config.client_type.as_str() {
        "qbittorrent" => {
            get_qbittorrent_file_path(http_client, client_config, external_identifier).await
        }
        "transmission" => {
            get_transmission_file_path(http_client, client_config, external_identifier).await
        }
        "deluge" => {
            get_deluge_file_path(http_client, client_config, external_identifier).await
        }
        "direct" => {
            // For direct downloads, the file is saved to download_directory/filename.
            Ok(client_config.download_directory.clone())
        }
        _ => Ok(None),
    }
}

/// Test connectivity to a download client.
pub async fn test_client_connection(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
) -> Result<(), AcquisitionError> {
    match client_config.client_type.as_str() {
        "qbittorrent" => test_qbittorrent(http_client, client_config).await,
        "transmission" => test_transmission(http_client, client_config).await,
        "deluge" => test_deluge(http_client, client_config).await,
        "direct" => Ok(()), // Direct downloads always "work" if the URL is reachable
        other => Err(AcquisitionError::ClientError(format!(
            "unsupported download client type: {other}"
        ))),
    }
}

// =========================================================================
// qBittorrent
// =========================================================================

fn qbittorrent_base_url(client_config: &StoredDownloadClient) -> String {
    let scheme = if client_config.use_ssl { "https" } else { "http" };
    format!("{}://{}:{}", scheme, client_config.host, client_config.port)
}

/// Authenticate with qBittorrent and return the session cookie (SID).
async fn qbittorrent_login(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
) -> Result<String, AcquisitionError> {
    let base_url = qbittorrent_base_url(client_config);
    let login_url = format!("{base_url}/api/v2/auth/login");

    let form_params = [
        (
            "username",
            client_config.username.as_deref().unwrap_or("admin"),
        ),
        (
            "password",
            client_config.password.as_deref().unwrap_or(""),
        ),
    ];

    let response = http_client
        .post(&login_url)
        .form(&form_params)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    let response_text = response.text().await?;

    if response_text.contains("Ok.") || response_text.contains("Ok") {
        // qBittorrent returns SID in Set-Cookie header. For simplicity,
        // we extract it from response or use the cookie value directly.
        // In practice, the reqwest client with cookie store would handle this,
        // but we pass it as a header for subsequent requests.
        Ok(response_text)
    } else {
        Err(AcquisitionError::AuthenticationFailed(format!(
            "qBittorrent login failed: {response_text}"
        )))
    }
}

async fn add_qbittorrent(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    download_url: &str,
    magnet_url: Option<&str>,
) -> Result<String, AcquisitionError> {
    let base_url = qbittorrent_base_url(client_config);

    // Authenticate first.
    qbittorrent_login(http_client, client_config).await?;

    let add_url = format!("{base_url}/api/v2/torrents/add");

    // Prefer magnet URL if available, otherwise use the download URL (torrent file).
    let torrent_source = magnet_url.unwrap_or(download_url);

    let mut form_params = vec![("urls", torrent_source.to_string())];

    if let Some(ref category) = client_config.category {
        form_params.push(("category", category.clone()));
    }

    if let Some(ref download_directory) = client_config.download_directory {
        form_params.push(("savepath", download_directory.clone()));
    }

    let response = http_client
        .post(&add_url)
        .form(&form_params)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(AcquisitionError::ClientError(format!(
            "qBittorrent add failed ({status}): {error_body}"
        )));
    }

    // Return the magnet hash or a generated identifier.
    // Extract info_hash from magnet URL if present.
    if let Some(magnet) = magnet_url {
        if let Some(hash) = extract_info_hash_from_magnet(magnet) {
            return Ok(hash);
        }
    }

    // Fallback: use a hash of the download URL as an external identifier.
    Ok(sha256_short(download_url))
}

async fn check_qbittorrent_status(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    torrent_hash: &str,
) -> Result<DownloadStatus, AcquisitionError> {
    let base_url = qbittorrent_base_url(client_config);
    qbittorrent_login(http_client, client_config).await?;

    let info_url = format!(
        "{base_url}/api/v2/torrents/info?hashes={torrent_hash}"
    );

    let response = http_client
        .get(&info_url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    let body: serde_json::Value = response.json().await?;

    if let Some(torrents) = body.as_array() {
        if let Some(torrent) = torrents.first() {
            let progress = torrent
                .get("progress")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);

            let state_string = torrent
                .get("state")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");

            let download_state = match state_string {
                "downloading" | "stalledDL" | "forcedDL" | "metaDL"
                | "allocating" | "checkingDL" => DownloadState::Downloading,
                "uploading" | "stalledUP" | "forcedUP" | "checkingUP" => DownloadState::Seeding,
                "pausedDL" | "pausedUP" => DownloadState::Paused,
                "error" | "missingFiles" => DownloadState::Failed,
                _ => {
                    if progress >= 1.0 {
                        DownloadState::Completed
                    } else {
                        DownloadState::Unknown
                    }
                }
            };

            let download_speed = torrent
                .get("dlspeed")
                .and_then(|value| value.as_u64());

            let eta_seconds = torrent
                .get("eta")
                .and_then(|value| value.as_i64());

            return Ok(DownloadStatus {
                state: download_state,
                progress_percent: progress * 100.0,
                download_speed,
                eta_seconds,
            });
        }
    }

    Err(AcquisitionError::ClientError(format!(
        "torrent not found in qBittorrent: {torrent_hash}"
    )))
}

async fn get_qbittorrent_file_path(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    torrent_hash: &str,
) -> Result<Option<String>, AcquisitionError> {
    let base_url = qbittorrent_base_url(client_config);
    qbittorrent_login(http_client, client_config).await?;

    let info_url = format!(
        "{base_url}/api/v2/torrents/info?hashes={torrent_hash}"
    );

    let response = http_client
        .get(&info_url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    let body: serde_json::Value = response.json().await?;

    if let Some(torrents) = body.as_array() {
        if let Some(torrent) = torrents.first() {
            let content_path = torrent
                .get("content_path")
                .and_then(|value| value.as_str())
                .map(String::from);
            return Ok(content_path);
        }
    }

    Ok(None)
}

async fn test_qbittorrent(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
) -> Result<(), AcquisitionError> {
    qbittorrent_login(http_client, client_config).await?;
    Ok(())
}

// =========================================================================
// Transmission
// =========================================================================

fn transmission_rpc_url(client_config: &StoredDownloadClient) -> String {
    let scheme = if client_config.use_ssl { "https" } else { "http" };
    format!("{}://{}:{}/transmission/rpc", scheme, client_config.host, client_config.port)
}

/// Get the Transmission session ID (X-Transmission-Session-Id) via a 409 response.
async fn transmission_session_id(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
) -> Result<String, AcquisitionError> {
    let rpc_url = transmission_rpc_url(client_config);

    let mut request_builder = http_client
        .post(&rpc_url)
        .json(&serde_json::json!({"method": "session-get"}))
        .timeout(std::time::Duration::from_secs(10));

    if let (Some(ref username), Some(ref password)) =
        (&client_config.username, &client_config.password)
    {
        request_builder = request_builder.basic_auth(username, Some(password));
    }

    let response = request_builder.send().await?;

    // Transmission returns 409 with X-Transmission-Session-Id header on first request.
    if let Some(session_id_header) = response.headers().get("x-transmission-session-id") {
        return Ok(session_id_header
            .to_str()
            .unwrap_or_default()
            .to_string());
    }

    // If we got 200, we can extract it from the successful response too.
    if response.status().is_success() {
        // No session ID needed (possibly disabled).
        return Ok(String::new());
    }

    Err(AcquisitionError::AuthenticationFailed(
        "could not obtain Transmission session ID".to_string(),
    ))
}

/// Send a Transmission RPC request with proper auth and session ID.
async fn transmission_rpc(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    body: &serde_json::Value,
) -> Result<serde_json::Value, AcquisitionError> {
    let rpc_url = transmission_rpc_url(client_config);
    let session_id = transmission_session_id(http_client, client_config).await?;

    let mut request_builder = http_client
        .post(&rpc_url)
        .header("X-Transmission-Session-Id", &session_id)
        .json(body)
        .timeout(std::time::Duration::from_secs(15));

    if let (Some(ref username), Some(ref password)) =
        (&client_config.username, &client_config.password)
    {
        request_builder = request_builder.basic_auth(username, Some(password));
    }

    let response = request_builder.send().await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(AcquisitionError::ClientError(format!(
            "Transmission RPC failed ({status}): {error_body}"
        )));
    }

    let response_json: serde_json::Value = response.json().await?;
    Ok(response_json)
}

async fn add_transmission(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    download_url: &str,
    magnet_url: Option<&str>,
) -> Result<String, AcquisitionError> {
    let source = magnet_url.unwrap_or(download_url);

    let mut arguments = serde_json::json!({
        "filename": source,
    });

    if let Some(ref download_directory) = client_config.download_directory {
        arguments["download-dir"] = serde_json::Value::String(download_directory.clone());
    }

    let body = serde_json::json!({
        "method": "torrent-add",
        "arguments": arguments,
    });

    let response = transmission_rpc(http_client, client_config, &body).await?;

    // Extract the torrent hash from the response.
    let torrent_added = response
        .get("arguments")
        .and_then(|arguments| {
            arguments
                .get("torrent-added")
                .or_else(|| arguments.get("torrent-duplicate"))
        });

    if let Some(torrent_info) = torrent_added {
        if let Some(hash_string) = torrent_info.get("hashString").and_then(|value| value.as_str())
        {
            return Ok(hash_string.to_string());
        }
        if let Some(torrent_id) = torrent_info.get("id").and_then(|value| value.as_i64()) {
            return Ok(torrent_id.to_string());
        }
    }

    // Fallback.
    if let Some(magnet) = magnet_url {
        if let Some(hash) = extract_info_hash_from_magnet(magnet) {
            return Ok(hash);
        }
    }

    Ok(sha256_short(download_url))
}

async fn check_transmission_status(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    external_identifier: &str,
) -> Result<DownloadStatus, AcquisitionError> {
    // Try to parse as integer ID first, then fall back to hash lookup.
    let torrent_ids: serde_json::Value = if let Ok(numeric_id) = external_identifier.parse::<i64>()
    {
        serde_json::json!([numeric_id])
    } else {
        serde_json::json!([external_identifier])
    };

    let body = serde_json::json!({
        "method": "torrent-get",
        "arguments": {
            "ids": torrent_ids,
            "fields": ["percentDone", "status", "rateDownload", "eta", "downloadDir", "files"]
        }
    });

    let response = transmission_rpc(http_client, client_config, &body).await?;

    let torrents = response
        .get("arguments")
        .and_then(|arguments| arguments.get("torrents"))
        .and_then(|torrents| torrents.as_array());

    if let Some(torrent_list) = torrents {
        if let Some(torrent) = torrent_list.first() {
            let percent_done = torrent
                .get("percentDone")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);

            // Transmission status codes: 0=stopped, 1=check_wait, 2=checking,
            // 3=download_wait, 4=downloading, 5=seed_wait, 6=seeding
            let status_code = torrent
                .get("status")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);

            let download_state = match status_code {
                3 | 4 => DownloadState::Downloading,
                5 | 6 => DownloadState::Seeding,
                0 => {
                    if percent_done >= 1.0 {
                        DownloadState::Completed
                    } else {
                        DownloadState::Paused
                    }
                }
                1 | 2 => DownloadState::Downloading,
                _ => DownloadState::Unknown,
            };

            let download_speed = torrent
                .get("rateDownload")
                .and_then(|value| value.as_u64());

            let eta_seconds = torrent.get("eta").and_then(|value| value.as_i64());

            return Ok(DownloadStatus {
                state: download_state,
                progress_percent: percent_done * 100.0,
                download_speed,
                eta_seconds,
            });
        }
    }

    Err(AcquisitionError::ClientError(format!(
        "torrent not found in Transmission: {external_identifier}"
    )))
}

async fn get_transmission_file_path(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    external_identifier: &str,
) -> Result<Option<String>, AcquisitionError> {
    let torrent_ids: serde_json::Value = if let Ok(numeric_id) = external_identifier.parse::<i64>()
    {
        serde_json::json!([numeric_id])
    } else {
        serde_json::json!([external_identifier])
    };

    let body = serde_json::json!({
        "method": "torrent-get",
        "arguments": {
            "ids": torrent_ids,
            "fields": ["downloadDir", "files", "name"]
        }
    });

    let response = transmission_rpc(http_client, client_config, &body).await?;

    let torrents = response
        .get("arguments")
        .and_then(|arguments| arguments.get("torrents"))
        .and_then(|torrents| torrents.as_array());

    if let Some(torrent_list) = torrents {
        if let Some(torrent) = torrent_list.first() {
            let download_directory = torrent
                .get("downloadDir")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let torrent_name = torrent
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("");

            if !download_directory.is_empty() && !torrent_name.is_empty() {
                return Ok(Some(format!("{download_directory}/{torrent_name}")));
            }
        }
    }

    Ok(None)
}

async fn test_transmission(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
) -> Result<(), AcquisitionError> {
    let body = serde_json::json!({"method": "session-get"});
    transmission_rpc(http_client, client_config, &body).await?;
    Ok(())
}

// =========================================================================
// Deluge
// =========================================================================

fn deluge_rpc_url(client_config: &StoredDownloadClient) -> String {
    let scheme = if client_config.use_ssl { "https" } else { "http" };
    format!("{}://{}:{}/json", scheme, client_config.host, client_config.port)
}

/// Authenticate with Deluge's JSON-RPC API.
async fn deluge_login(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
) -> Result<(), AcquisitionError> {
    let rpc_url = deluge_rpc_url(client_config);
    let password = client_config.password.as_deref().unwrap_or("");

    let login_body = serde_json::json!({
        "method": "auth.login",
        "params": [password],
        "id": 1
    });

    let response = http_client
        .post(&rpc_url)
        .json(&login_body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    let response_json: serde_json::Value = response.json().await?;

    let is_authenticated = response_json
        .get("result")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    if !is_authenticated {
        return Err(AcquisitionError::AuthenticationFailed(
            "Deluge auth.login returned false".to_string(),
        ));
    }

    Ok(())
}

/// Send a Deluge JSON-RPC request (must be authenticated first).
async fn deluge_rpc(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, AcquisitionError> {
    let rpc_url = deluge_rpc_url(client_config);

    let body = serde_json::json!({
        "method": method,
        "params": params,
        "id": 2
    });

    let response = http_client
        .post(&rpc_url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;

    let response_json: serde_json::Value = response.json().await?;

    if let Some(error) = response_json.get("error") {
        if !error.is_null() {
            return Err(AcquisitionError::ClientError(format!(
                "Deluge RPC error: {error}"
            )));
        }
    }

    Ok(response_json)
}

async fn add_deluge(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    download_url: &str,
    magnet_url: Option<&str>,
) -> Result<String, AcquisitionError> {
    deluge_login(http_client, client_config).await?;

    let source = magnet_url.unwrap_or(download_url);

    let mut options = serde_json::json!({});
    if let Some(ref download_directory) = client_config.download_directory {
        options["download_location"] = serde_json::Value::String(download_directory.clone());
    }

    // Use add_torrent_magnet for magnet links, add_torrent_url for HTTP URLs.
    let (method, params) = if source.starts_with("magnet:") {
        (
            "core.add_torrent_magnet",
            serde_json::json!([source, options]),
        )
    } else {
        (
            "core.add_torrent_url",
            serde_json::json!([source, options]),
        )
    };

    let response = deluge_rpc(http_client, client_config, method, params).await?;

    // Deluge returns the torrent hash as the result.
    if let Some(torrent_hash) = response.get("result").and_then(|value| value.as_str()) {
        return Ok(torrent_hash.to_string());
    }

    if let Some(magnet) = magnet_url {
        if let Some(hash) = extract_info_hash_from_magnet(magnet) {
            return Ok(hash);
        }
    }

    Ok(sha256_short(download_url))
}

async fn check_deluge_status(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    torrent_hash: &str,
) -> Result<DownloadStatus, AcquisitionError> {
    deluge_login(http_client, client_config).await?;

    let params = serde_json::json!([
        torrent_hash,
        ["progress", "state", "download_payload_rate", "eta"]
    ]);

    let response =
        deluge_rpc(http_client, client_config, "core.get_torrent_status", params).await?;

    if let Some(result) = response.get("result") {
        let progress = result
            .get("progress")
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0);

        let state_string = result
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown");

        let download_state = match state_string {
            "Downloading" => DownloadState::Downloading,
            "Seeding" => DownloadState::Seeding,
            "Paused" => DownloadState::Paused,
            "Error" => DownloadState::Failed,
            "Checking" | "Queued" | "Moving" => DownloadState::Downloading,
            _ => {
                if progress >= 100.0 {
                    DownloadState::Completed
                } else {
                    DownloadState::Unknown
                }
            }
        };

        let download_speed = result
            .get("download_payload_rate")
            .and_then(|value| value.as_u64());

        let eta_seconds = result.get("eta").and_then(|value| value.as_i64());

        return Ok(DownloadStatus {
            state: download_state,
            progress_percent: progress,
            download_speed,
            eta_seconds,
        });
    }

    Err(AcquisitionError::ClientError(format!(
        "torrent not found in Deluge: {torrent_hash}"
    )))
}

async fn get_deluge_file_path(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    torrent_hash: &str,
) -> Result<Option<String>, AcquisitionError> {
    deluge_login(http_client, client_config).await?;

    let params = serde_json::json!([
        torrent_hash,
        ["save_path", "name"]
    ]);

    let response =
        deluge_rpc(http_client, client_config, "core.get_torrent_status", params).await?;

    if let Some(result) = response.get("result") {
        let save_path = result
            .get("save_path")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let torrent_name = result
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        if !save_path.is_empty() && !torrent_name.is_empty() {
            return Ok(Some(format!("{save_path}/{torrent_name}")));
        }
    }

    Ok(None)
}

async fn test_deluge(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
) -> Result<(), AcquisitionError> {
    deluge_login(http_client, client_config).await
}

// =========================================================================
// Direct HTTP download
// =========================================================================

async fn add_direct_download(
    http_client: &reqwest::Client,
    client_config: &StoredDownloadClient,
    download_url: &str,
) -> Result<String, AcquisitionError> {
    let download_directory = client_config
        .download_directory
        .as_deref()
        .unwrap_or("/tmp/ironshelf-downloads");

    // Create download directory if it doesn't exist.
    tokio::fs::create_dir_all(download_directory).await?;

    // Extract filename from URL or generate one.
    let file_name = download_url
        .rsplit('/')
        .next()
        .and_then(|segment| {
            let decoded = urlencoding::decode(segment).unwrap_or_default();
            let cleaned = decoded.split('?').next().unwrap_or(&decoded).to_string();
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned)
            }
        })
        .unwrap_or_else(|| format!("{}.download", sha256_short(download_url)));

    let target_path = format!("{download_directory}/{file_name}");

    let response = http_client
        .get(download_url)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(AcquisitionError::ClientError(format!(
            "direct download failed: HTTP {}",
            response.status()
        )));
    }

    let body_bytes = response.bytes().await?;
    tokio::fs::write(&target_path, &body_bytes).await?;

    tracing::info!("direct download saved to {target_path} ({} bytes)", body_bytes.len());

    Ok(target_path)
}

// =========================================================================
// Helpers
// =========================================================================

/// Extract the info hash from a magnet URI.
/// Magnet URIs contain `xt=urn:btih:<hash>`.
fn extract_info_hash_from_magnet(magnet: &str) -> Option<String> {
    for param in magnet.split('&') {
        let param = param.trim_start_matches("magnet:?");
        if let Some(value) = param.strip_prefix("xt=urn:btih:") {
            // Hash may be followed by other params.
            let hash = value.split('&').next().unwrap_or(value);
            return Some(hash.to_lowercase());
        }
    }
    None
}

/// Produce a short SHA-256 hex digest of a string (first 40 chars).
fn sha256_short(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..20])
}
