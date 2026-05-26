//! Server bootstrap configuration (TOML/env).
//! Only server-level settings here. Libraries are managed via API + stored in DB.

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Server bootstrap config. Libraries NOT here — they live in the DB.
#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: u16,

    #[serde(default = "default_host")]
    pub host: String,

    /// Path to the Ironshelf own database (created if missing).
    #[serde(default = "default_ironshelf_db")]
    pub database_path: PathBuf,

    /// Path to the tantivy full-text search index directory.
    #[serde(default = "default_search_index_path")]
    pub search_index_path: PathBuf,
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

fn default_search_index_path() -> PathBuf {
    PathBuf::from("./ironshelf-search-index/")
}

impl Config {
    /// Load config from TOML file + env var overrides.
    /// Search: $IRONSHELF_CONFIG → ./ironshelf.toml → /etc/ironshelf/config.toml
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
            Config {
                port: default_port(),
                host: default_host(),
                database_path: default_ironshelf_db(),
                search_index_path: default_search_index_path(),
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
        if let Ok(search_index_path) = std::env::var("IRONSHELF_SEARCH_INDEX") {
            config.search_index_path = PathBuf::from(search_index_path);
        }

        Ok(config)
    }
}
