//! ironshelf-server — Axum HTTP server for the Ironshelf ebook platform.
//!
//! Like Plex for books: serves libraries with Author → Series → Book hierarchy.
//! Libraries are managed via API (add/remove/configure through GUI).
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
use tokio::sync::RwLock;
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

    // Open Ironshelf's own database (libraries stored here, not in config)
    let ironshelf_db = IronshelfDb::open(&config.database_path).await?;
    ironshelf_db.migrate().await?;
    tracing::info!("ironshelf db ready at {}", config.database_path.display());

    // Load libraries from DB
    let libraries = load_libraries_from_db(&ironshelf_db).await;
    tracing::info!("{} libraries loaded from database", libraries.len());

    let app_state = AppState {
        libraries: Arc::new(RwLock::new(libraries)),
        ironshelf_db,
    };

    let app = Router::new()
        // Health
        .route("/health", get(health))
        // Libraries (CRUD — managed via GUI)
        .route(
            "/api/v1/libraries",
            get(routes::libraries::list_libraries).post(routes::libraries::create_library),
        )
        .route(
            "/api/v1/libraries/{id}",
            get(routes::libraries::get_library)
                .patch(routes::libraries::update_library)
                .delete(routes::libraries::delete_library),
        )
        .route("/api/v1/libraries/{id}/scan", axum::routing::post(routes::libraries::scan_library))
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

/// Load all libraries from the database and open their sources.
pub async fn load_libraries_from_db(ironshelf_db: &IronshelfDb) -> Vec<LoadedLibrary> {
    let stored = ironshelf_db.list_libraries().await.unwrap_or_default();
    let mut libraries = Vec::new();

    for stored_lib in stored {
        match CalibreSource::open(&stored_lib.path).await {
            Ok(source) => {
                tracing::info!("opened library '{}' at {}", stored_lib.name, stored_lib.path);
                libraries.push(LoadedLibrary {
                    id: stored_lib.id,
                    name: stored_lib.name,
                    library_type: stored_lib.library_type,
                    source_kind: stored_lib.source_kind,
                    source,
                });
            }
            Err(error) => {
                tracing::error!(
                    "failed to open library '{}' at {}: {error}",
                    stored_lib.name,
                    stored_lib.path
                );
            }
        }
    }

    libraries
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "ironshelf-server",
        "version": env!("CARGO_PKG_VERSION")
    }))
}
