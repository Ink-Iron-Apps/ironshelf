//! ironshelf-server — Axum HTTP server for the Ironshelf ebook platform.
//!
//! Like Plex for books: serves libraries with Author → Series → Book hierarchy.
//! Reads Calibre metadata.db (RO) as source. Flutter app is the reader client.

mod config;
mod routes;
mod state;

use axum::{routing::get, Json, Router};
use ironshelf_core::calibre::CalibreSource;
use ironshelf_core::db::IronshelfDb;
use serde_json::json;
use state::{AppState, LoadedLibrary};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ironshelf_server=info,tower_http=info".into()),
        )
        .init();

    let config = config::Config::load()?;
    tracing::info!("loaded config: {} libraries configured", config.libraries.len());

    // Open Ironshelf's own database
    let ironshelf_db = IronshelfDb::open(&config.database_path).await?;
    ironshelf_db.migrate().await?;
    tracing::info!("ironshelf db ready at {}", config.database_path.display());

    // Open each configured Calibre library
    let mut libraries = Vec::new();
    for (index, lib_config) in config.libraries.iter().enumerate() {
        match CalibreSource::open(&lib_config.path).await {
            Ok(source) => {
                let loaded = LoadedLibrary {
                    id: format!("lib_{index}"),
                    name: lib_config.name.clone(),
                    library_type: lib_config.library_type.clone(),
                    source_kind: lib_config.source_kind.clone(),
                    source,
                };
                tracing::info!("opened library '{}' at {}", lib_config.name, lib_config.path.display());
                libraries.push(loaded);
            }
            Err(error) => {
                tracing::error!(
                    "failed to open library '{}' at {}: {error}",
                    lib_config.name,
                    lib_config.path.display()
                );
            }
        }
    }

    let app_state = AppState {
        libraries: Arc::new(libraries),
        ironshelf_db,
    };

    let app = Router::new()
        // Health
        .route("/health", get(health))
        // Libraries
        .route("/api/v1/libraries", get(routes::libraries::list_libraries))
        .route("/api/v1/libraries/{id}", get(routes::libraries::get_library))
        .route("/api/v1/libraries/{id}/authors", get(routes::authors::list_authors))
        .route("/api/v1/libraries/{id}/books", get(routes::books::list_books))
        // Authors
        .route("/api/v1/authors/{id}", get(routes::authors::get_author))
        .route("/api/v1/authors/{id}/series", get(routes::authors::author_series))
        .route("/api/v1/authors/{id}/standalone", get(routes::authors::author_standalone))
        // Series
        .route("/api/v1/series/{id}", get(routes::series::get_series))
        // Books
        .route("/api/v1/books/{id}", get(routes::books::get_book))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    tracing::info!("ironshelf-server listening on {}:{}", config.host, config.port);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "ironshelf-server",
        "version": env!("CARGO_PKG_VERSION")
    }))
}
