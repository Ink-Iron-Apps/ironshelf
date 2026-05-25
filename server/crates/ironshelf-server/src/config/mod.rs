//! Server bootstrap configuration (TOML/env).
//! Only server-level settings here. Libraries are managed via API + stored in DB.

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// SMTP configuration for outbound email (Send-to-Kindle, etc).
#[derive(Debug, Clone, Deserialize)]
pub struct SmtpConfig {
    pub host: String,
    #[serde(default = "default_smtp_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    pub from_address: String,
}

fn default_smtp_port() -> u16 {
    587
}

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

    /// Optional SMTP configuration for email features (Send-to-Kindle).
    #[serde(default)]
    pub smtp: Option<SmtpConfig>,
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
                smtp: None,
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

        // SMTP env overrides — if IRONSHELF_SMTP_HOST is set, build or override SmtpConfig
        if let Ok(smtp_host) = std::env::var("IRONSHELF_SMTP_HOST") {
            let smtp = config.smtp.get_or_insert(SmtpConfig {
                host: smtp_host.clone(),
                port: default_smtp_port(),
                user: String::new(),
                password: String::new(),
                from_address: String::new(),
            });
            smtp.host = smtp_host;

            if let Ok(smtp_port) = std::env::var("IRONSHELF_SMTP_PORT") {
                if let Ok(parsed_port) = smtp_port.parse() {
                    smtp.port = parsed_port;
                }
            }
            if let Ok(smtp_user) = std::env::var("IRONSHELF_SMTP_USER") {
                smtp.user = smtp_user;
            }
            if let Ok(smtp_password) = std::env::var("IRONSHELF_SMTP_PASSWORD") {
                smtp.password = smtp_password;
            }
            if let Ok(smtp_from) = std::env::var("IRONSHELF_SMTP_FROM") {
                smtp.from_address = smtp_from;
            }
        }

        Ok(config)
    }
}
