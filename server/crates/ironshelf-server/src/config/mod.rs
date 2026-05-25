//! Configuration loading from TOML file + environment variable overrides.

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Top-level server configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: u16,

    #[serde(default = "default_host")]
    pub host: String,

    /// Path to the Ironshelf own database (created if missing).
    #[serde(default = "default_ironshelf_db")]
    pub database_path: PathBuf,

    /// Configured Calibre libraries.
    #[serde(default)]
    pub libraries: Vec<LibraryConfig>,
}

/// A single library source configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct LibraryConfig {
    pub name: String,
    pub path: PathBuf,

    #[serde(default = "default_library_type")]
    pub library_type: String,

    #[serde(default = "default_source_kind")]
    pub source_kind: String,
}

fn default_port() -> u16 {
    10810
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_ironshelf_db() -> PathBuf {
    PathBuf::from("ironshelf.db")
}

fn default_library_type() -> String {
    "book".to_string()
}

fn default_source_kind() -> String {
    "calibre".to_string()
}

impl Config {
    /// Load config from a TOML file, with env var overrides.
    /// Looks for config at: $IRONSHELF_CONFIG, ./ironshelf.toml, /etc/ironshelf/config.toml
    pub fn load() -> anyhow::Result<Self> {
        let config_path = std::env::var("IRONSHELF_CONFIG")
            .map(PathBuf::from)
            .ok()
            .or_else(|| {
                let local = Path::new("ironshelf.toml");
                if local.exists() {
                    Some(local.to_path_buf())
                } else {
                    None
                }
            })
            .or_else(|| {
                let system = Path::new("/etc/ironshelf/config.toml");
                if system.exists() {
                    Some(system.to_path_buf())
                } else {
                    None
                }
            });

        let mut config: Config = if let Some(path) = config_path {
            let content = std::fs::read_to_string(&path)?;
            toml::from_str(&content)?
        } else {
            // No config file — use defaults
            Config {
                port: default_port(),
                host: default_host(),
                database_path: default_ironshelf_db(),
                libraries: vec![],
            }
        };

        // Env overrides
        if let Ok(port) = std::env::var("IRONSHELF_PORT") {
            if let Ok(port) = port.parse() {
                config.port = port;
            }
        }
        if let Ok(host) = std::env::var("IRONSHELF_HOST") {
            config.host = host;
        }
        if let Ok(db_path) = std::env::var("IRONSHELF_DB") {
            config.database_path = PathBuf::from(db_path);
        }

        Ok(config)
    }
}
