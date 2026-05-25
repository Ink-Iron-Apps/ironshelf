//! ironshelf-server — Axum HTTP server.
//!
//! M0 scaffold: boots + serves `/health` only. See docs/ROADMAP.md (M1) for the
//! Calibre hierarchy API. See docs/API.md for the route plan.

use axum::{routing::get, Json, Router};
use serde_json::json;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ironshelf_server=info,tower_http=info".into()),
        )
        .init();

    let app = Router::new().route("/health", get(health));

    // TODO(M1): load config (calibre lib path, ironshelf db path, port), mount
    // /api/v1 libraries + authors/series/books routers, auth middleware.
    let port: u16 = std::env::var("IRONSHELF_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(10810);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("ironshelf-server listening on 0.0.0.0:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "service": "ironshelf-server", "version": env!("CARGO_PKG_VERSION") }))
}
