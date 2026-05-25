//! ironshelf-server — Axum HTTP server for the Ironshelf ebook platform.

mod auth;
mod config;
mod error;
mod pagination;
mod routes;
mod state;
mod web;

use axum::middleware;
use axum::{routing::get, Json, Router};
use ironshelf_core::calibre::CalibreSource;
use ironshelf_core::db::IronshelfDb;
use ironshelf_core::scan::FolderSource;
use serde_json::json;
use state::{AppState, LibrarySource, LoadedLibrary};
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

    let ironshelf_db = IronshelfDb::open(&config.database_path).await?;
    ironshelf_db.migrate().await?;
    tracing::info!("ironshelf db ready at {}", config.database_path.display());

    let libraries = load_libraries_from_db(&ironshelf_db).await;
    tracing::info!("{} libraries loaded from database", libraries.len());

    let app_state = AppState {
        libraries: Arc::new(RwLock::new(libraries)),
        ironshelf_db,
    };

    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/health", get(health))
        .route("/api/v1/server/info", get(routes::server_info::server_info))
        .route("/api/v1/auth/register", axum::routing::post(routes::auth::register))
        .route("/api/v1/auth/login", axum::routing::post(routes::auth::login));

    // Protected routes (auth required)
    let protected_routes = Router::new()
        // Auth management
        .route("/api/v1/auth/me", get(routes::auth::me))
        .route("/api/v1/auth/logout", axum::routing::post(routes::auth::logout))
        .route(
            "/api/v1/auth/api-keys",
            get(routes::auth::list_api_keys).post(routes::auth::create_api_key),
        )
        .route(
            "/api/v1/auth/api-keys/{id}",
            axum::routing::delete(routes::auth::delete_api_key),
        )
        // User management (owner / manage_users)
        .route("/api/v1/users", get(routes::users::list_users))
        .route(
            "/api/v1/users/invite",
            axum::routing::post(routes::users::create_invite),
        )
        .route(
            "/api/v1/users/{id}",
            axum::routing::delete(routes::users::delete_user),
        )
        .route(
            "/api/v1/users/{id}/permissions",
            axum::routing::patch(routes::users::set_permissions),
        )
        // Libraries (CRUD via GUI)
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
        // Search
        .route("/api/v1/search", get(routes::search::global_search))
        // Continue reading
        .route("/api/v1/books/continue", get(routes::continue_reading::continue_reading))
        // Books
        .route("/api/v1/books/{id}", get(routes::books::get_book))
        .route("/api/v1/books/{id}/cover", get(routes::files::get_cover))
        .route("/api/v1/books/{id}/file", get(routes::files::get_file))
        // Progress + bookmarks
        .route(
            "/api/v1/books/{id}/progress",
            get(routes::progress::get_progress).put(routes::progress::update_progress),
        )
        .route(
            "/api/v1/books/{id}/bookmarks",
            get(routes::progress::list_bookmarks).post(routes::progress::create_bookmark),
        )
        .route(
            "/api/v1/books/{id}/bookmarks/{bookmark_id}",
            axum::routing::delete(routes::progress::delete_bookmark),
        )
        // Collections (reading lists)
        .route(
            "/api/v1/collections",
            get(routes::collections::list_collections).post(routes::collections::create_collection),
        )
        .route(
            "/api/v1/collections/{id}",
            get(routes::collections::get_collection)
                .patch(routes::collections::update_collection)
                .delete(routes::collections::delete_collection),
        )
        .route(
            "/api/v1/collections/{id}/books",
            axum::routing::post(routes::collections::add_book_to_collection),
        )
        .route(
            "/api/v1/collections/{id}/books/{book_id}",
            axum::routing::delete(routes::collections::remove_book_from_collection),
        )
        // Stats + activity
        .route("/api/v1/stats", get(routes::stats::server_stats))
        .route("/api/v1/activity", get(routes::stats::user_activity))
        .route("/api/v1/activity/all", get(routes::stats::server_activity))
        .layer(middleware::from_fn_with_state(
            app_state.clone(),
            auth::auth_middleware,
        ));

    // OPDS catalog routes (Bearer auth via same middleware — OPDS readers use Authorization header)
    let opds_routes = Router::new()
        .route("/opds", get(routes::opds::root_feed))
        .route("/opds/authors", get(routes::opds::authors_feed))
        .route("/opds/authors/{id}", get(routes::opds::author_feed))
        .route("/opds/series", get(routes::opds::series_list_feed))
        .route("/opds/series/{id}", get(routes::opds::series_feed))
        .route("/opds/recent", get(routes::opds::recent_feed))
        .route("/opds/search", get(routes::opds::search_feed))
        .layer(middleware::from_fn_with_state(
            app_state.clone(),
            auth::auth_middleware,
        ));

    // Web UI (embedded static files)
    let web_routes = Router::new()
        .route("/", get(web::serve_index))
        .route("/{*path}", get(web::serve_web));

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(opds_routes)
        .merge(web_routes)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    tracing::info!("ironshelf-server listening on {}:{}", config.host, config.port);
    axum::serve(listener, app).await?;
    Ok(())
}

/// Load all libraries from DB and open their sources.
pub async fn load_libraries_from_db(ironshelf_db: &IronshelfDb) -> Vec<LoadedLibrary> {
    let stored = ironshelf_db.list_libraries().await.unwrap_or_default();
    let mut libraries = Vec::new();

    for stored_lib in stored {
        let source = match stored_lib.source_kind.as_str() {
            "calibre" => {
                match CalibreSource::open(&stored_lib.path).await {
                    Ok(s) => Some(LibrarySource::Calibre(s)),
                    Err(e) => {
                        tracing::error!("failed to open calibre library '{}': {e}", stored_lib.name);
                        None
                    }
                }
            }
            "folder" => {
                match FolderSource::open(&stored_lib.path).await {
                    Ok(s) => Some(LibrarySource::Folder(Arc::new(RwLock::new(s)))),
                    Err(e) => {
                        tracing::error!("failed to open folder library '{}': {e}", stored_lib.name);
                        None
                    }
                }
            }
            other => {
                tracing::error!("unknown source_kind '{}' for library '{}'", other, stored_lib.name);
                None
            }
        };

        if let Some(source) = source {
            tracing::info!("opened library '{}' ({}) at {}", stored_lib.name, stored_lib.source_kind, stored_lib.path);
            libraries.push(LoadedLibrary {
                id: stored_lib.id,
                name: stored_lib.name,
                library_type: stored_lib.library_type,
                source_kind: stored_lib.source_kind,
                source,
            });
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
