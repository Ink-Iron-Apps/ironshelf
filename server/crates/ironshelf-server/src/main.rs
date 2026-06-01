//! ironshelf-server — Axum HTTP server for the Ironshelf ebook platform.

mod auth;
mod config;
mod error;
mod middleware;
mod pagination;
mod routes;
mod scheduler;
mod state;
mod tasks;
pub mod thumbnail;
pub mod tunnel;
pub mod upnp;
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

    // CLI subcommands run against the DB and exit, without starting the server.
    // Usage: ironshelf-server reset-password <username> [new-password]
    let cli_args: Vec<String> = std::env::args().collect();
    if cli_args.get(1).map(String::as_str) == Some("reset-password") {
        return run_reset_password(&ironshelf_db, &cli_args).await;
    }

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

    let update_status = routes::update::new_update_status();

    // UPnP port forwarding manager. The external port defaults to the server
    // port if not explicitly configured.
    let effective_external_port = config.external_port.unwrap_or(config.port);
    let upnp_manager = upnp::UpnpManager::new(config.port, effective_external_port);

    // Cloudflare Quick Tunnel manager for zero-config remote access.
    let tunnel_manager = tunnel::TunnelManager::new(config.port);

    let app_state = AppState {
        libraries: Arc::new(RwLock::new(libraries)),
        ironshelf_db,
        started_at: Instant::now(),
        search_index,
        thumbnail_cache_path: config.thumbnail_cache_path.clone(),
        config: config.clone(),
        oidc_state_store,
        http_client,
        update_status,
        upnp_manager: Arc::new(RwLock::new(upnp_manager)),
        tunnel_manager: Arc::new(RwLock::new(tunnel_manager)),
        tasks: Arc::new(tasks::TaskRegistry::new()),
    };

    // Determine which remote access method to use, in priority order:
    //   1. a method persisted in the DB by the UI (start tunnel / select method),
    //   2. "tunnel" if the server is claimed to the cloud (so remote access and
    //      the cloud URL survive restarts),
    //   3. the legacy config-file setting (remote_access_enabled → upnp).
    let persisted_remote_method = app_state
        .ironshelf_db
        .get_cloud_config("remote_access_method")
        .await
        .ok()
        .flatten();
    let is_claimed = app_state
        .ironshelf_db
        .get_cloud_config("claim_token")
        .await
        .ok()
        .flatten()
        .is_some();

    let effective_remote_access_method: String = match persisted_remote_method {
        Some(method) if method != "none" => method,
        _ if is_claimed => "tunnel".to_string(),
        _ if config.remote_access_enabled && config.remote_access_method == "none" => {
            "upnp".to_string()
        }
        _ => config.remote_access_method.clone(),
    };

    match effective_remote_access_method.as_str() {
        "upnp" => {
            let mut upnp_guard = app_state.upnp_manager.write().await;
            match upnp_guard.enable().await {
                Ok(public_url) => {
                    tracing::info!("remote access (UPnP): {public_url}");
                }
                Err(upnp_error) => {
                    tracing::warn!(
                        "UPnP failed: {upnp_error} — you can manually forward port {} on your router",
                        effective_external_port,
                    );
                }
            }
            drop(upnp_guard);
        }
        "tunnel" => {
            let mut tunnel_guard = app_state.tunnel_manager.write().await;
            match tunnel_guard.start().await {
                Ok(public_url) => {
                    tracing::info!("remote access (Cloudflare Tunnel): {public_url}");

                    // If the server is claimed, update Ironshelf Cloud with the tunnel URL.
                    let cloud_state = app_state.clone();
                    let tunnel_url_for_cloud = public_url.clone();
                    tokio::spawn(async move {
                        update_cloud_server_url(&cloud_state, &tunnel_url_for_cloud).await;
                    });
                }
                Err(tunnel_error) => {
                    tracing::warn!("Cloudflare tunnel failed: {tunnel_error}");
                }
            }
            drop(tunnel_guard);
        }
        "manual" => {
            tracing::info!("remote access: manual mode — user manages port forwarding externally");
        }
        _ => {
            tracing::info!("remote access: disabled");
        }
    }

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
        .route(
            "/api/v1/auth/cloud-login",
            axum::routing::post(routes::cloud_auth::cloud_login),
        )
        .route(
            "/api/v1/auth/claim",
            axum::routing::post(routes::cloud_auth::claim_server),
        )
        .route(
            "/api/v1/auth/claim-status",
            get(routes::cloud_auth::claim_status),
        )
        .with_state(app_state.clone());

    // Protected routes (auth required).
    // Split into sub-routers and merged to keep the type tree shallow enough
    // for Rust's trait solver to verify the middleware Service bounds.
    let auth_management_routes = Router::new()
        .route("/api/v1/auth/me", get(routes::auth::me))
        .route("/api/v1/auth/logout", axum::routing::post(routes::auth::logout))
        .route(
            "/api/v1/auth/password",
            axum::routing::put(routes::password::change_password),
        )
        .route(
            "/api/v1/auth/link-cloud",
            axum::routing::post(routes::cloud_auth::link_cloud),
        )
        .route(
            "/api/v1/auth/unlink-cloud",
            axum::routing::post(routes::cloud_auth::unlink_cloud),
        )
        .route(
            "/api/v1/auth/api-keys",
            get(routes::auth::list_api_keys).post(routes::auth::create_api_key),
        )
        .route(
            "/api/v1/auth/api-keys/{id}",
            axum::routing::delete(routes::auth::delete_api_key),
        )
        .route(
            "/api/v1/auth/unclaim",
            axum::routing::delete(routes::cloud_auth::unclaim_server),
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
        )
        .route(
            "/api/v1/users/{id}/password",
            axum::routing::put(routes::users::reset_user_password),
        )
        .route(
            "/api/v1/users/invites",
            get(routes::users::list_invites),
        )
        .route(
            "/api/v1/users/{id}/library-access",
            get(routes::library_access::get_library_access)
                .patch(routes::library_access::set_library_access),
        );

    let filesystem_routes = Router::new()
        .route(
            "/api/v1/filesystem/browse",
            get(routes::filesystem::browse_filesystem),
        )
        .route(
            "/api/v1/filesystem/validate",
            get(routes::filesystem::validate_filesystem_path),
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
        .route("/api/v1/authors/{id}/photo", get(routes::authors::get_author_photo))
        .route("/api/v1/authors/{id}/info", get(routes::authors::get_author_info))
        .route(
            "/api/v1/authors/photos/prefetch",
            axum::routing::post(routes::authors::prefetch_author_photos),
        )
        .route(
            "/api/v1/server/settings",
            get(routes::authors::get_server_settings)
                .put(routes::authors::update_server_settings),
        )
        .route(
            "/api/v1/server/tasks",
            get(routes::authors::list_background_tasks),
        )
        .route("/api/v1/series/{id}", get(routes::series::get_series))
        .route("/api/v1/search", get(routes::search::global_search))
        .route("/api/v1/search/rebuild", axum::routing::post(routes::search::rebuild_search_index))
        .route("/api/v1/books/continue", get(routes::continue_reading::continue_reading))
        .route("/api/v1/books/{id}", get(routes::books::get_book))
        .route("/api/v1/books/{id}/cover", get(routes::files::get_cover))
        .route("/api/v1/books/{id}/file", get(routes::files::get_file))
        .route("/api/v1/books/{id}/metadata/search", get(routes::metadata::search_metadata))
        .route("/api/v1/books/{id}/metadata/apply", axum::routing::post(routes::metadata::apply_metadata))
        .route(
            "/api/v1/books/{id}/ratings",
            get(routes::ratings_reviews::get_book_ratings)
                .post(routes::ratings_reviews::set_book_rating),
        )
        .route(
            "/api/v1/books/{id}/reviews",
            get(routes::ratings_reviews::list_book_reviews)
                .post(routes::ratings_reviews::create_review),
        )
        .route(
            "/api/v1/reviews/{id}",
            get(routes::ratings_reviews::get_review)
                .patch(routes::ratings_reviews::update_review)
                .delete(routes::ratings_reviews::delete_review),
        )
        .route(
            "/api/v1/books/{id}/convert",
            axum::routing::post(routes::conversions::start_conversion),
        )
        .route(
            "/api/v1/conversions/{id}",
            get(routes::conversions::get_conversion_status),
        );

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
            "/api/v1/me/bookmarks",
            get(routes::progress::list_all_bookmarks),
        )
        .route(
            "/api/v1/me/highlights",
            get(routes::highlights::list_all_highlights),
        )
        .route(
            "/api/v1/me/queue",
            get(routes::reading_queue::list_queue).post(routes::reading_queue::add_to_queue),
        )
        .route(
            "/api/v1/me/queue/reorder",
            axum::routing::post(routes::reading_queue::reorder_queue),
        )
        .route(
            "/api/v1/me/queue/{book_id}",
            axum::routing::delete(routes::reading_queue::remove_from_queue),
        )
        .route(
            "/api/v1/me/queue/{book_id}/move",
            axum::routing::patch(routes::reading_queue::move_queue_item),
        )
        .route(
            "/api/v1/me/reading-goal",
            get(routes::reading_goals::get_reading_goal)
                .post(routes::reading_goals::set_reading_goal),
        )
        .route(
            "/api/v1/me/stats",
            get(routes::personal_stats::personal_stats),
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
        .route("/api/v1/activity/all", get(routes::stats::server_activity))
        .route(
            "/api/v1/duplicates/scan",
            get(routes::duplicates::scan_duplicates),
        );

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

    let update_routes = Router::new()
        .route(
            "/api/v1/server/update/check",
            get(routes::update::check_for_update),
        )
        .route(
            "/api/v1/server/update/apply",
            axum::routing::post(routes::update::apply_update),
        )
        .route(
            "/api/v1/server/update/status",
            get(routes::update::update_status),
        )
        .route(
            "/api/v1/server/converters",
            get(routes::converters::server_converters),
        )
        .route(
            "/api/v1/server/remote-access",
            get(routes::remote_access::get_remote_access_status),
        )
        .route(
            "/api/v1/server/remote-access/enable",
            axum::routing::post(routes::remote_access::enable_remote_access),
        )
        .route(
            "/api/v1/server/remote-access/disable",
            axum::routing::post(routes::remote_access::disable_remote_access),
        )
        .route(
            "/api/v1/server/remote-access/test",
            axum::routing::post(routes::remote_access::test_remote_access),
        )
        .route(
            "/api/v1/server/remote-access/tunnel/start",
            axum::routing::post(routes::remote_access::start_tunnel),
        )
        .route(
            "/api/v1/server/remote-access/tunnel/stop",
            axum::routing::post(routes::remote_access::stop_tunnel),
        );

    let protected_routes = Router::new()
        .merge(auth_management_routes)
        .merge(filesystem_routes)
        .merge(library_routes)
        .merge(reading_routes)
        .merge(data_routes)
        .merge(genre_webhook_routes)
        .merge(acquisition_routes)
        .merge(update_routes)
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

/// If the server is claimed to Ironshelf Cloud, update the stored server URL
/// so cloud routing points to the current tunnel/public address.
pub(crate) async fn update_cloud_server_url(application_state: &AppState, new_public_url: &str) {
    let server_id = match application_state
        .ironshelf_db
        .get_cloud_config("server_id")
        .await
    {
        Ok(Some(id)) => id,
        _ => return, // Not claimed — nothing to update.
    };

    let cloud_service_url = match application_state
        .ironshelf_db
        .get_cloud_config("cloud_service_url")
        .await
    {
        Ok(Some(url)) => url,
        _ => return,
    };

    let claim_token = match application_state
        .ironshelf_db
        .get_cloud_config("claim_token")
        .await
    {
        Ok(Some(token)) => token,
        _ => return,
    };

    let update_url = format!("{}/api/v1/servers/{}", cloud_service_url.trim_end_matches('/'), server_id);

    match application_state
        .http_client
        .patch(&update_url)
        .bearer_auth(&claim_token)
        .json(&serde_json::json!({ "public_url": new_public_url }))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            tracing::info!(
                "updated cloud server URL to {new_public_url}"
            );
        }
        Ok(response) => {
            tracing::warn!(
                "failed to update cloud server URL: HTTP {}",
                response.status()
            );
        }
        Err(request_error) => {
            tracing::warn!(
                "failed to update cloud server URL: {request_error}"
            );
        }
    }
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

/// CLI: reset a local user's password. Reads the new password from argv[3] or,
/// if absent, prompts on stdin. Clears the user's sessions afterward.
async fn run_reset_password(db: &IronshelfDb, args: &[String]) -> anyhow::Result<()> {
    let username = args
        .get(2)
        .ok_or_else(|| anyhow::anyhow!("usage: ironshelf-server reset-password <username> [new-password]"))?;

    let new_password = match args.get(3) {
        Some(password) => password.clone(),
        None => {
            use std::io::Write;
            eprint!("New password for {username}: ");
            std::io::stderr().flush().ok();
            let mut line = String::new();
            std::io::stdin().read_line(&mut line)?;
            line.trim_end_matches(['\r', '\n']).to_string()
        }
    };

    if new_password.len() < 8 {
        anyhow::bail!("password must be at least 8 characters");
    }

    let password_hash =
        auth::hash_password(&new_password).map_err(|_| anyhow::anyhow!("failed to hash password"))?;

    let pool = db.pool();
    let result = sqlx::query("UPDATE users SET password_hash = ? WHERE username = ?")
        .bind(&password_hash)
        .bind(username)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("no user named '{username}'");
    }

    // Sign out existing sessions for that user.
    let _ = sqlx::query(
        "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)",
    )
    .bind(username)
    .execute(pool)
    .await;

    println!("Password updated for '{username}'. Existing sessions were signed out.");
    Ok(())
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
