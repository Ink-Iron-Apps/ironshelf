//! ironshelf-server — Axum HTTP server for the Ironshelf ebook platform.

mod auth;
mod config;
mod error;
mod middleware;
mod pagination;
mod routes;
mod scheduler;
mod state;
pub mod thumbnail;
mod web;
mod webhook_dispatcher;

use axum::extract::State;
use axum::http::StatusCode;
use axum::{routing::get, Json, Router};
use ironshelf_core::calibre::CalibreSource;
use ironshelf_core::db::IronshelfDb;
use ironshelf_core::scan::FolderSource;
use ironshelf_core::search_index::SearchIndex;
use serde_json::json;
use state::{AppState, LibrarySource, LoadedLibrary};
use std::sync::Arc;
use std::time::Instant;
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

    // Initialize tantivy full-text search index.
    let search_index = match SearchIndex::open(&config.search_index_path) {
        Ok(index) => {
            tracing::info!(
                "search index ready at {}",
                config.search_index_path.display()
            );
            Some(Arc::new(RwLock::new(index)))
        }
        Err(index_error) => {
            tracing::error!(
                "failed to open search index at {}: {index_error} — full-text search disabled",
                config.search_index_path.display()
            );
            None
        }
    };

    let oidc_state_store = routes::oidc::OidcStateStore::new();

    // Shared HTTP client for all outbound requests (metadata providers, webhooks).
    // Created once to reuse connection pools and TLS sessions across the server lifetime.
    let http_client = reqwest::Client::builder()
        .user_agent("ironshelf-server/0.1")
        .build()
        .expect("failed to build shared reqwest client");

    let app_state = AppState {
        libraries: Arc::new(RwLock::new(libraries)),
        ironshelf_db,
        started_at: Instant::now(),
        search_index,
        thumbnail_cache_path: config.thumbnail_cache_path.clone(),
        config: config.clone(),
        oidc_state_store,
        http_client,
    };

    // Start background scheduled tasks (rescan, session cleanup, metadata enrich).
    scheduler::start(app_state.clone());

    // Initialize rate limiters and spawn background cleanup tasks.
    let api_rate_limiter = middleware::rate_limit::RateLimiter::api_tier()
        .with_trust_proxy_headers(config.trust_proxy_headers);
    api_rate_limiter.spawn_cleanup_task();
    let auth_rate_limiter = middleware::rate_limit::RateLimiter::auth_tier()
        .with_trust_proxy_headers(config.trust_proxy_headers);
    auth_rate_limiter.spawn_cleanup_task();

    // Auth routes with strict rate limiting (10 req/min per IP).
    let auth_routes = Router::new()
        .route("/api/v1/auth/register", axum::routing::post(routes::auth::register))
        .route("/api/v1/auth/login", axum::routing::post(routes::auth::login))
        .route("/api/v1/auth/oidc/login", get(routes::oidc::oidc_login))
        .route("/api/v1/auth/oidc/callback", get(routes::oidc::oidc_callback))
        .with_state(app_state.clone())
        .layer(axum::middleware::from_fn_with_state(
            auth_rate_limiter,
            middleware::rate_limit::rate_limit_auth,
        ));

    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/health", get(health))
        .route("/ready", get(readiness))
        .route("/alive", get(liveness))
        .route("/api/v1/server/info", get(routes::server_info::server_info))
        .with_state(app_state.clone());

    // Protected routes (auth required).
    // Split into sub-routers and merged to keep the type tree shallow enough
    // for Rust's trait solver to verify the middleware Service bounds.
    let auth_management_routes = Router::new()
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
        );

    let library_routes = Router::new()
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
        .route("/api/v1/libraries/{id}/metadata/scan", axum::routing::post(routes::metadata::bulk_metadata_scan))
        .route("/api/v1/libraries/{id}/authors", get(routes::authors::list_authors))
        .route("/api/v1/libraries/{id}/books", get(routes::books::list_books))
        .route("/api/v1/authors/{id}", get(routes::authors::get_author))
        .route("/api/v1/authors/{id}/series", get(routes::authors::author_series))
        .route("/api/v1/authors/{id}/standalone", get(routes::authors::author_standalone))
        .route("/api/v1/series/{id}", get(routes::series::get_series))
        .route("/api/v1/search", get(routes::search::global_search))
        .route("/api/v1/search/rebuild", axum::routing::post(routes::search::rebuild_search_index))
        .route("/api/v1/books/continue", get(routes::continue_reading::continue_reading))
        .route("/api/v1/books/{id}", get(routes::books::get_book))
        .route("/api/v1/books/{id}/cover", get(routes::files::get_cover))
        .route("/api/v1/books/{id}/file", get(routes::files::get_file))
        .route("/api/v1/books/{id}/metadata/search", get(routes::metadata::search_metadata))
        .route("/api/v1/books/{id}/metadata/apply", axum::routing::post(routes::metadata::apply_metadata));

    let reading_routes = Router::new()
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
        .route(
            "/api/v1/books/{id}/highlights",
            get(routes::highlights::list_book_highlights)
                .post(routes::highlights::create_highlight),
        )
        .route(
            "/api/v1/highlights/{id}",
            axum::routing::patch(routes::highlights::update_highlight)
                .delete(routes::highlights::delete_highlight),
        )
        .route(
            "/api/v1/me/highlights",
            get(routes::highlights::list_all_highlights),
        )
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
        );

    let data_routes = Router::new()
        .route("/api/v1/export/reading-progress", get(routes::import_export::export_reading_progress))
        .route("/api/v1/export/bookmarks", get(routes::import_export::export_bookmarks))
        .route("/api/v1/export/collections", get(routes::import_export::export_collections))
        .route("/api/v1/export/all", get(routes::import_export::export_all))
        .route("/api/v1/import", axum::routing::post(routes::import_export::import_user_data))
        .route("/api/v1/export/library-config", get(routes::import_export::export_library_config))
        .route("/api/v1/import/library-config", axum::routing::post(routes::import_export::import_library_config))
        .route(
            "/api/v1/notifications",
            get(routes::notifications::list_notifications),
        )
        .route(
            "/api/v1/notifications/count",
            get(routes::notifications::unread_count),
        )
        .route(
            "/api/v1/notifications/{id}/read",
            axum::routing::patch(routes::notifications::mark_read),
        )
        .route(
            "/api/v1/notifications/read-all",
            axum::routing::post(routes::notifications::mark_all_read),
        )
        .route(
            "/api/v1/notifications/{id}",
            axum::routing::delete(routes::notifications::delete_notification),
        )
        .route("/api/v1/stats", get(routes::stats::server_stats))
        .route("/api/v1/activity", get(routes::stats::user_activity))
        .route("/api/v1/activity/all", get(routes::stats::server_activity));

    let genre_webhook_routes = Router::new()
        .route("/api/v1/genres", get(routes::genres::list_all_genres))
        .route("/api/v1/genres/{genre_name}", get(routes::genres::get_genre_books))
        .route("/api/v1/genres/{genre_name}/authors", get(routes::genres::genre_authors))
        .route("/api/v1/genres/{genre_name}/series", get(routes::genres::genre_series))
        .route("/api/v1/libraries/{id}/genres", get(routes::genres::list_library_genres))
        .route(
            "/api/v1/libraries/{id}/genres/{genre_name}/books",
            get(routes::genres::list_library_genre_books),
        )
        .route(
            "/api/v1/webhooks",
            get(routes::webhooks::list_webhooks).post(routes::webhooks::create_webhook),
        )
        .route(
            "/api/v1/webhooks/{id}",
            axum::routing::patch(routes::webhooks::update_webhook)
                .delete(routes::webhooks::delete_webhook),
        )
        .route(
            "/api/v1/webhooks/{id}/deliveries",
            get(routes::webhooks::list_deliveries),
        )
        .route(
            "/api/v1/webhooks/{id}/test",
            axum::routing::post(routes::webhooks::test_webhook),
        );

    let acquisition_routes = Router::new()
        .route(
            "/api/v1/indexers",
            get(routes::acquisition::list_indexers)
                .post(routes::acquisition::create_indexer),
        )
        .route(
            "/api/v1/indexers/{id}",
            axum::routing::patch(routes::acquisition::update_indexer)
                .delete(routes::acquisition::delete_indexer),
        )
        .route(
            "/api/v1/indexers/{id}/test",
            axum::routing::post(routes::acquisition::test_indexer),
        )
        .route(
            "/api/v1/download-clients",
            get(routes::acquisition::list_download_clients)
                .post(routes::acquisition::create_download_client),
        )
        .route(
            "/api/v1/download-clients/{id}",
            axum::routing::patch(routes::acquisition::update_download_client)
                .delete(routes::acquisition::delete_download_client),
        )
        .route(
            "/api/v1/download-clients/{id}/test",
            axum::routing::post(routes::acquisition::test_download_client),
        )
        .route(
            "/api/v1/wanted",
            get(routes::acquisition::list_wanted)
                .post(routes::acquisition::create_wanted),
        )
        .route(
            "/api/v1/wanted/{id}",
            axum::routing::patch(routes::acquisition::update_wanted)
                .delete(routes::acquisition::delete_wanted),
        )
        .route(
            "/api/v1/wanted/{id}/search",
            axum::routing::post(routes::acquisition::search_wanted_item),
        )
        .route(
            "/api/v1/wanted/{id}/grab",
            axum::routing::post(routes::acquisition::grab_wanted_item),
        )
        .route(
            "/api/v1/downloads",
            get(routes::acquisition::list_downloads),
        )
        .route(
            "/api/v1/downloads/{id}",
            get(routes::acquisition::get_download)
                .delete(routes::acquisition::delete_download),
        )
        .route(
            "/api/v1/downloads/{id}/retry",
            axum::routing::post(routes::acquisition::retry_download),
        )
        .route(
            "/api/v1/acquisition/search",
            get(routes::acquisition::acquisition_search),
        )
        .route(
            "/api/v1/acquisition/grab",
            axum::routing::post(routes::acquisition::acquisition_grab),
        );

    // Build the auth middleware layer using a closure that captures AppState.
    // This avoids the `from_fn_with_state` + `State<>` extractor pattern which
    // triggers a type-inference failure in Rust's trait solver when the router
    // has many merged sub-routers (FromFn's extractor tuple type becomes _).
    let auth_state = app_state.clone();
    let auth_middleware_layer = axum::middleware::from_fn(move |request, next| {
        let state = auth_state.clone();
        async move { auth::auth_middleware(State(state), request, next).await }
    });

    let protected_routes = Router::new()
        .merge(auth_management_routes)
        .merge(library_routes)
        .merge(reading_routes)
        .merge(data_routes)
        .merge(genre_webhook_routes)
        .merge(acquisition_routes)
        .with_state(app_state.clone())
        .layer(auth_middleware_layer.clone());

    // OPDS catalog routes (Bearer auth via same middleware — OPDS readers use Authorization header)
    let opds_routes = Router::new()
        .route("/opds", get(routes::opds::root_feed))
        .route("/opds/authors", get(routes::opds::authors_feed))
        .route("/opds/authors/{id}", get(routes::opds::author_feed))
        .route("/opds/series", get(routes::opds::series_list_feed))
        .route("/opds/series/{id}", get(routes::opds::series_feed))
        .route("/opds/recent", get(routes::opds::recent_feed))
        .route("/opds/search", get(routes::opds::search_feed))
        .with_state(app_state.clone())
        .layer(auth_middleware_layer);

    // Kobo Sync API routes (auth is via path token, no session middleware)
    let kobo_routes = Router::new()
        .route(
            "/kobo/{auth_token}/v1/initialization",
            get(routes::kobo::initialization),
        )
        .route(
            "/kobo/{auth_token}/v1/library/sync",
            get(routes::kobo::library_sync),
        )
        .route(
            "/kobo/{auth_token}/v1/library/tags",
            get(routes::kobo::library_tags),
        )
        .route(
            "/kobo/{auth_token}/v1/books/{book_id}/file/{format}",
            get(routes::kobo::download_book),
        )
        .route(
            "/kobo/{auth_token}/v1/books/{book_id}/image/{width}/{height}/{quality}/image.jpg",
            get(routes::kobo::cover_image),
        )
        .route(
            "/kobo/{auth_token}/v1/library/{book_id}/state",
            axum::routing::put(routes::kobo::update_reading_state),
        )
        .with_state(app_state.clone());

    // WebDAV routes for KOReader sync (auth is via path token, no session middleware).
    // Uses `any()` because WebDAV methods (PROPFIND, MKCOL) are not in axum's MethodFilter.
    // Method dispatch happens inside the handler.
    let webdav_routes = Router::new()
        .route(
            "/webdav/{auth_token}",
            axum::routing::any(routes::webdav::webdav_dispatch_root),
        )
        .route(
            "/webdav/{*webdav_path}",
            axum::routing::any(routes::webdav::webdav_dispatch),
        )
        .with_state(app_state.clone());

    // Web UI (embedded static files — no state needed, but resolve for type consistency)
    let web_routes = Router::new()
        .route("/", get(web::serve_index))
        .route("/{*path}", get(web::serve_web));

    // All sub-routers above have been resolved to `Router<()>` via `.with_state()`.
    // The final app router is also `Router<()>` — global middleware layers use
    // `from_fn_with_state` for their own state, independent of the router state.
    let app: Router = Router::new()
        .merge(public_routes)
        .merge(auth_routes)
        .merge(protected_routes)
        .merge(opds_routes)
        .merge(kobo_routes)
        .merge(webdav_routes)
        .merge(web_routes)
        // Rate limit: 100 req/min per IP across all routes (auth routes have
        // their own stricter limiter layered above this one).
        .layer(axum::middleware::from_fn_with_state(
            api_rate_limiter,
            middleware::rate_limit::rate_limit_api,
        ))
        // Request ID: UUID per request for log correlation + X-Request-Id header.
        .layer(axum::middleware::from_fn(
            middleware::request_id::request_id,
        ))
        // Security headers: CSP, X-Frame-Options, etc. on every response.
        .layer(axum::middleware::from_fn(
            middleware::security_headers::security_headers,
        ))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    tracing::info!("ironshelf-server listening on {}:{}", config.host, config.port);

    let shutdown_signal = shutdown_signal();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await?;

    tracing::info!("server shut down gracefully");
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

async fn shutdown_signal() {
    use tokio::signal;

    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to listen for ctrl+c");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to listen for SIGTERM")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received, draining connections...");
}

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let uptime_seconds = state.started_at.elapsed().as_secs();
    let libraries_loaded = state.libraries.read().await.len();

    let database_status = match state.ironshelf_db.health_check().await {
        Ok(_) => "connected",
        Err(_) => "disconnected",
    };

    Json(json!({
        "status": "healthy",
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_seconds": uptime_seconds,
        "libraries_loaded": libraries_loaded,
        "database": database_status,
    }))
}

async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    let database_ok = state.ironshelf_db.health_check().await.is_ok();
    let libraries_loaded = state.libraries.read().await.len();
    // A fresh install with zero libraries is a valid ready state — the user
    // simply has not added any libraries yet. Only the database must be up.
    let is_ready = database_ok;

    let status_code = if is_ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status_code,
        Json(json!({
            "ready": is_ready,
            "database": if database_ok { "connected" } else { "disconnected" },
            "libraries_loaded": libraries_loaded,
        })),
    )
}

async fn liveness() -> Json<serde_json::Value> {
    Json(json!({ "alive": true }))
}
