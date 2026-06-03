//! Cloudflare Quick Tunnel manager for remote access.
//!
//! When UPnP is unavailable or unreliable, the server can spawn a
//! `cloudflared tunnel --url http://localhost:{port}` child process.
//! Cloudflare assigns a random `*.trycloudflare.com` subdomain and proxies
//! all traffic through their edge network — no port forwarding, no firewall
//! changes, no account required.
//!
//! The child process is supervised: if it exits unexpectedly the scheduler
//! health-check task will respawn it automatically.

use serde::Serialize;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

/// How long to wait for `cloudflared` to print the tunnel URL before giving up.
const TUNNEL_STARTUP_TIMEOUT_SECONDS: u64 = 30;

/// Snapshot of the tunnel manager's current state, returned via the API.
#[derive(Debug, Clone, Serialize)]
pub struct TunnelStatus {
    /// Whether `cloudflared` is installed and reachable in PATH.
    pub is_available: bool,
    /// Whether the tunnel child process is currently running.
    pub is_active: bool,
    /// The generated `*.trycloudflare.com` public URL (set once the tunnel is up).
    pub public_url: Option<String>,
    /// Last error message if the tunnel failed to start or died.
    pub last_error: Option<String>,
}

/// Manages a single Cloudflare Quick Tunnel child process.
pub struct TunnelManager {
    child_process: Option<Child>,
    public_url: Option<String>,
    is_active: bool,
    last_error: Option<String>,
    internal_port: u16,
}

impl TunnelManager {
    /// Create a new manager targeting the given local server port.
    /// Does NOT start the tunnel until [`start`] is called.
    pub fn new(internal_port: u16) -> Self {
        Self {
            child_process: None,
            public_url: None,
            is_active: false,
            last_error: None,
            internal_port,
        }
    }

    /// Check whether `cloudflared` is installed and reachable in PATH.
    ///
    /// Runs `cloudflared version` and returns `true` if the command succeeds.
    /// This is a static check — it does not require a running tunnel.
    pub async fn is_cloudflared_available() -> bool {
        let cloudflared_binary = if cfg!(windows) {
            "cloudflared.exe"
        } else {
            "cloudflared"
        };

        Command::new(cloudflared_binary)
            .arg("version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|exit_status| exit_status.success())
            .unwrap_or(false)
    }

    /// Start the Cloudflare Quick Tunnel.
    ///
    /// 1. Verifies `cloudflared` is in PATH.
    /// 2. Spawns `cloudflared tunnel --url http://localhost:{port} --no-autoupdate`.
    /// 3. Reads stderr line-by-line looking for the generated `.trycloudflare.com` URL.
    /// 4. Times out after 30 seconds if no URL is found.
    ///
    /// Returns the public URL on success.
    pub async fn start(&mut self) -> Result<String, String> {
        // Kill any existing child process first.
        self.stop().await;
        self.last_error = None;

        if !Self::is_cloudflared_available().await {
            let message = "cloudflared is not installed or not in PATH".to_string();
            self.last_error = Some(message.clone());
            return Err(message);
        }

        let cloudflared_binary = if cfg!(windows) {
            "cloudflared.exe"
        } else {
            "cloudflared"
        };

        let local_url = format!("http://localhost:{}", self.internal_port);

        let mut child = Command::new(cloudflared_binary)
            .arg("tunnel")
            .arg("--url")
            .arg(&local_url)
            .arg("--no-autoupdate")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|spawn_error| {
                let message = format!("Failed to spawn cloudflared: {spawn_error}");
                self.last_error = Some(message.clone());
                message
            })?;

        // Read stderr to find the generated URL.
        let stderr = child.stderr.take().ok_or_else(|| {
            let message = "Failed to capture cloudflared stderr".to_string();
            self.last_error = Some(message.clone());
            message
        })?;

        let mut reader = BufReader::new(stderr).lines();

        // Scan stderr for the tunnel URL, accumulating recent log lines so that,
        // if cloudflared exits without producing a URL, we can surface its actual
        // output (the real reason) instead of an opaque message.
        let parsed_url = tokio::time::timeout(
            std::time::Duration::from_secs(TUNNEL_STARTUP_TIMEOUT_SECONDS),
            async {
                let mut recent_output: Vec<String> = Vec::new();
                while let Ok(Some(line)) = reader.next_line().await {
                    tracing::debug!("cloudflared: {line}");

                    if recent_output.len() >= 15 {
                        recent_output.remove(0);
                    }
                    recent_output.push(line.clone());

                    // Look for a trycloudflare.com URL in the log line.
                    if let Some(url_start) = line.find("https://") {
                        let url_candidate = &line[url_start..];
                        // Extract just the URL (stop at whitespace or end of line).
                        let url_end = url_candidate
                            .find(|character: char| character.is_whitespace())
                            .unwrap_or(url_candidate.len());
                        let extracted_url = &url_candidate[..url_end];

                        if extracted_url.contains(".trycloudflare.com") {
                            return (Some(extracted_url.to_string()), recent_output);
                        }
                    }
                }
                (None, recent_output)
            },
        )
        .await;

        match parsed_url {
            Ok((Some(tunnel_url), _)) => {
                self.child_process = Some(child);
                self.public_url = Some(tunnel_url.clone());
                self.is_active = true;
                self.last_error = None;

                tracing::info!(
                    "Cloudflare tunnel established: {tunnel_url} -> localhost:{}",
                    self.internal_port
                );

                Ok(tunnel_url)
            }
            Ok((None, recent_output)) => {
                // stderr closed without producing a URL — process likely exited.
                let exit_note = match child.wait().await {
                    Ok(status) => format!(" (exit status: {status})"),
                    Err(_) => String::new(),
                };
                let _ = child.kill().await;

                let detail = recent_output
                    .iter()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                    .cloned()
                    .unwrap_or_else(|| "no output captured".to_string());

                let message = format!(
                    "cloudflared exited before producing a tunnel URL{exit_note}. Last output: {detail}"
                );
                tracing::warn!("cloudflared startup failed; recent output: {recent_output:?}");
                self.last_error = Some(message.clone());
                self.is_active = false;
                Err(message)
            }
            Err(_timeout) => {
                // Timed out waiting for the URL.
                let _ = child.kill().await;
                let message = format!(
                    "Timed out after {TUNNEL_STARTUP_TIMEOUT_SECONDS}s waiting for cloudflared to produce a tunnel URL"
                );
                self.last_error = Some(message.clone());
                self.is_active = false;
                Err(message)
            }
        }
    }

    /// Start a *named* Cloudflare tunnel from a tunnel token.
    ///
    /// Unlike a quick tunnel, the public hostname is configured in the
    /// Cloudflare dashboard (the tunnel's ingress rule points at this server),
    /// so the caller supplies the stable [`hostname`]; `cloudflared` just
    /// connects with `tunnel run --token`. The URL never rotates.
    pub async fn start_named(&mut self, token: &str, hostname: &str) -> Result<String, String> {
        self.stop().await;
        self.last_error = None;

        if !Self::is_cloudflared_available().await {
            let message = "cloudflared is not installed or not in PATH".to_string();
            self.last_error = Some(message.clone());
            return Err(message);
        }

        let trimmed_host = hostname.trim().trim_end_matches('/');
        if trimmed_host.is_empty() {
            let message = "Named tunnel requires a public hostname".to_string();
            self.last_error = Some(message.clone());
            return Err(message);
        }
        let public_url = if trimmed_host.starts_with("http://") || trimmed_host.starts_with("https://")
        {
            trimmed_host.to_string()
        } else {
            format!("https://{trimmed_host}")
        };

        let cloudflared_binary = if cfg!(windows) {
            "cloudflared.exe"
        } else {
            "cloudflared"
        };

        let mut child = Command::new(cloudflared_binary)
            .arg("--no-autoupdate")
            .arg("tunnel")
            .arg("run")
            .arg("--token")
            .arg(token)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|spawn_error| {
                let message = format!("Failed to spawn cloudflared: {spawn_error}");
                self.last_error = Some(message.clone());
                message
            })?;

        // A named tunnel doesn't print a URL. Give it a few seconds to connect;
        // if the process exits early the token is almost certainly wrong.
        for _ in 0..6 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            match child.try_wait() {
                Ok(Some(status)) => {
                    let message = format!(
                        "cloudflared exited during startup (status: {status}) — check the tunnel token"
                    );
                    self.last_error = Some(message.clone());
                    self.is_active = false;
                    return Err(message);
                }
                Ok(None) => {}
                Err(_) => break,
            }
        }

        self.child_process = Some(child);
        self.public_url = Some(public_url.clone());
        self.is_active = true;
        self.last_error = None;
        tracing::info!("Named Cloudflare tunnel running -> {public_url}");
        Ok(public_url)
    }

    /// Stop the tunnel by killing the child process.
    pub async fn stop(&mut self) {
        if let Some(mut child) = self.child_process.take() {
            match child.kill().await {
                Ok(()) => {
                    tracing::info!("Cloudflare tunnel stopped");
                }
                Err(kill_error) => {
                    tracing::warn!("Failed to kill cloudflared process: {kill_error}");
                }
            }
        }

        self.is_active = false;
        self.public_url = None;
        self.last_error = None;
    }

    /// Return a snapshot of the current tunnel state.
    ///
    /// The `is_available` field is always set to `false` here because checking
    /// availability requires an async process spawn. The API route handler
    /// should call [`is_cloudflared_available`] separately and override this
    /// field before returning.
    pub fn get_status(&self) -> TunnelStatus {
        TunnelStatus {
            is_available: false, // Overridden by caller with async check.
            is_active: self.is_active,
            public_url: self.public_url.clone(),
            last_error: self.last_error.clone(),
        }
    }

    /// Check whether the child process is still running.
    ///
    /// Returns `true` if the process has not exited, `false` if it exited or
    /// was never started. If the process exited unexpectedly, updates internal
    /// state to reflect that.
    pub fn check_health(&mut self) -> bool {
        if let Some(ref mut child) = self.child_process {
            match child.try_wait() {
                Ok(Some(exit_status)) => {
                    // Process exited.
                    let message = format!(
                        "cloudflared exited unexpectedly with status: {exit_status}"
                    );
                    tracing::warn!("{message}");
                    self.last_error = Some(message);
                    self.is_active = false;
                    self.public_url = None;
                    self.child_process = None;
                    false
                }
                Ok(None) => {
                    // Still running.
                    true
                }
                Err(wait_error) => {
                    let message =
                        format!("Failed to check cloudflared status: {wait_error}");
                    tracing::warn!("{message}");
                    self.last_error = Some(message);
                    self.is_active = false;
                    false
                }
            }
        } else {
            false
        }
    }

    /// Return the current public URL if the tunnel is active.
    pub fn public_url(&self) -> Option<&str> {
        if self.is_active {
            self.public_url.as_deref()
        } else {
            None
        }
    }
}

impl Drop for TunnelManager {
    fn drop(&mut self) {
        // Best-effort kill on drop. `kill_on_drop(true)` on the child process
        // already handles this, but we clear our state too.
        if let Some(mut child) = self.child_process.take() {
            // `start_kill` is non-blocking — suitable for Drop.
            let _ = child.start_kill();
        }
    }
}
