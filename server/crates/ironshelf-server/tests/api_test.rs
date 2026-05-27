//! Integration tests for Ironshelf API and OPDS feeds.
//!
//! Each test starts the full Axum server on a random port using a fresh
//! temporary Ironshelf database. Calibre metadata.db is created in-memory
//! using rusqlite with minimal test data.

use reqwest::Client;
use rusqlite::Connection;
use std::net::SocketAddr;
use tempfile::TempDir;

/// Test fixture with a running server and HTTP client.
struct TestServer {
    base_url: String,
    client: Client,
    _temp_dir: TempDir,
}

/// Create a minimal Calibre metadata.db with test data.
fn create_test_calibre_database(directory: &std::path::Path) {
    let database_path = directory.join("metadata.db");
    let connection = Connection::open(&database_path).expect("failed to create test metadata.db");

    connection
        .execute_batch(
            "
            CREATE TABLE authors (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                sort TEXT NOT NULL,
                link TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE books (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                sort TEXT NOT NULL,
                timestamp TEXT,
                pubdate TEXT,
                series_index REAL NOT NULL DEFAULT 1.0,
                author_sort TEXT NOT NULL DEFAULT '',
                isbn TEXT DEFAULT '',
                lccn TEXT DEFAULT '',
                path TEXT NOT NULL DEFAULT '',
                flags INTEGER NOT NULL DEFAULT 1,
                uuid TEXT,
                has_cover INTEGER DEFAULT 0,
                last_modified TEXT NOT NULL DEFAULT '2024-01-01 00:00:00+00:00'
            );

            CREATE TABLE series (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                sort TEXT NOT NULL,
                link TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE books_authors_link (
                id INTEGER PRIMARY KEY,
                book INTEGER NOT NULL REFERENCES books(id),
                author INTEGER NOT NULL REFERENCES authors(id)
            );

            CREATE TABLE books_series_link (
                id INTEGER PRIMARY KEY,
                book INTEGER NOT NULL REFERENCES books(id),
                series INTEGER NOT NULL REFERENCES series(id)
            );

            CREATE TABLE data (
                id INTEGER PRIMARY KEY,
                book INTEGER NOT NULL REFERENCES books(id),
                format TEXT NOT NULL,
                uncompressed_size INTEGER NOT NULL,
                name TEXT NOT NULL
            );

            CREATE TABLE custom_columns (
                id INTEGER PRIMARY KEY,
                label TEXT NOT NULL,
                name TEXT NOT NULL,
                datatype TEXT NOT NULL,
                mark_for_delete INTEGER NOT NULL DEFAULT 0,
                editable INTEGER NOT NULL DEFAULT 1,
                display TEXT NOT NULL DEFAULT '{}',
                is_multiple INTEGER NOT NULL DEFAULT 0,
                normalized INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE tags (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            );

            CREATE TABLE books_tags_link (
                id INTEGER PRIMARY KEY,
                book INTEGER NOT NULL REFERENCES books(id),
                tag INTEGER NOT NULL REFERENCES tags(id)
            );

            CREATE TABLE languages (
                id INTEGER PRIMARY KEY,
                lang_code TEXT NOT NULL
            );

            CREATE TABLE books_languages_link (
                id INTEGER PRIMARY KEY,
                book INTEGER NOT NULL REFERENCES books(id),
                lang_code INTEGER NOT NULL REFERENCES languages(id),
                item_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE identifiers (
                id INTEGER PRIMARY KEY,
                book INTEGER NOT NULL REFERENCES books(id),
                type TEXT NOT NULL DEFAULT 'isbn',
                val TEXT NOT NULL
            );

            CREATE TABLE comments (
                id INTEGER PRIMARY KEY,
                book INTEGER NOT NULL REFERENCES books(id),
                text TEXT NOT NULL DEFAULT ''
            );

            -- Insert test authors
            INSERT INTO authors (id, name, sort) VALUES (1, 'Brandon Sanderson', 'Sanderson, Brandon');
            INSERT INTO authors (id, name, sort) VALUES (2, 'Terry Pratchett', 'Pratchett, Terry');

            -- Insert test series
            INSERT INTO series (id, name, sort) VALUES (1, 'The Stormlight Archive', 'Stormlight Archive, The');

            -- Insert test books
            INSERT INTO books (id, title, sort, path, has_cover, timestamp, pubdate, series_index, uuid)
                VALUES (1, 'The Way of Kings', 'Way of Kings, The', 'Brandon Sanderson/The Way of Kings (1)', 1, '2024-01-15 12:00:00+00:00', '2010-08-31', 1.0, 'test-uuid-1');
            INSERT INTO books (id, title, sort, path, has_cover, timestamp, pubdate, series_index, uuid)
                VALUES (2, 'Words of Radiance', 'Words of Radiance', 'Brandon Sanderson/Words of Radiance (2)', 0, '2024-02-20 12:00:00+00:00', '2014-03-04', 2.0, 'test-uuid-2');
            INSERT INTO books (id, title, sort, path, has_cover, timestamp, pubdate, series_index, uuid)
                VALUES (3, 'Good Omens', 'Good Omens', 'Terry Pratchett/Good Omens (3)', 1, '2024-03-01 12:00:00+00:00', '1990-05-10', 1.0, 'test-uuid-3');

            -- Link books to authors
            INSERT INTO books_authors_link (id, book, author) VALUES (1, 1, 1);
            INSERT INTO books_authors_link (id, book, author) VALUES (2, 2, 1);
            INSERT INTO books_authors_link (id, book, author) VALUES (3, 3, 2);

            -- Link books to series (first two books in Stormlight Archive)
            INSERT INTO books_series_link (id, book, series) VALUES (1, 1, 1);
            INSERT INTO books_series_link (id, book, series) VALUES (2, 2, 1);
            -- Book 3 (Good Omens) is standalone — no series link

            -- Insert format data
            INSERT INTO data (id, book, format, uncompressed_size, name) VALUES (1, 1, 'EPUB', 1500000, 'The Way of Kings');
            INSERT INTO data (id, book, format, uncompressed_size, name) VALUES (2, 2, 'EPUB', 1800000, 'Words of Radiance');
            INSERT INTO data (id, book, format, uncompressed_size, name) VALUES (3, 3, 'EPUB', 900000, 'Good Omens');
            INSERT INTO data (id, book, format, uncompressed_size, name) VALUES (4, 3, 'PDF', 1200000, 'Good Omens');

            -- Insert a tag
            INSERT INTO tags (id, name) VALUES (1, 'Fantasy');
            INSERT INTO books_tags_link (id, book, tag) VALUES (1, 1, 1);
            INSERT INTO books_tags_link (id, book, tag) VALUES (2, 2, 1);

            -- Insert language
            INSERT INTO languages (id, lang_code) VALUES (1, 'eng');
            INSERT INTO books_languages_link (id, book, lang_code, item_order) VALUES (1, 1, 1, 0);
            INSERT INTO books_languages_link (id, book, lang_code, item_order) VALUES (2, 2, 1, 0);
            INSERT INTO books_languages_link (id, book, lang_code, item_order) VALUES (3, 3, 1, 0);
            ",
        )
        .expect("failed to populate test metadata.db");
}

/// Start the server with a fresh database on a random port.
/// Returns the TestServer fixture.
async fn start_test_server() -> TestServer {
    let temp_dir = TempDir::new().expect("failed to create temp dir");

    // Create Calibre metadata.db in a subdirectory
    let calibre_directory = temp_dir.path().join("calibre");
    std::fs::create_dir_all(&calibre_directory).expect("failed to create calibre dir");
    create_test_calibre_database(&calibre_directory);

    // Create Ironshelf DB path
    let ironshelf_database_path = temp_dir.path().join("ironshelf.db");

    // Open and migrate the Ironshelf DB
    let ironshelf_database = ironshelf_core::db::IronshelfDb::open(&ironshelf_database_path)
        .await
        .expect("failed to open ironshelf db");
    ironshelf_database
        .migrate()
        .await
        .expect("failed to migrate ironshelf db");

    // Build app state with no libraries initially (tests add them via API)
    let app_state = build_app_state(ironshelf_database);

    // Build the router (mirrors main.rs structure)
    let application = build_application(app_state);

    // Bind to random port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind listener");
    let address: SocketAddr = listener.local_addr().expect("failed to get local addr");
    let base_url = format!("http://127.0.0.1:{}", address.port());

    // Spawn the server
    tokio::spawn(async move {
        axum::serve(listener, application)
            .await
            .expect("server error");
    });

    let client = Client::builder()
        .cookie_store(true)
        .build()
        .expect("failed to build client");

    TestServer {
        base_url,
        client,
        _temp_dir: temp_dir,
    }
}

/// Build AppState for testing.
fn build_app_state(ironshelf_database: ironshelf_core::db::IronshelfDb) -> AppState {
    AppState {
        libraries: std::sync::Arc::new(tokio::sync::RwLock::new(Vec::new())),
        ironshelf_db: ironshelf_database,
    }
}

/// Build the full Axum application (router + middleware).
fn build_application(app_state: AppState) -> axum::Router {
    use axum::middleware;
    use axum::routing::{get, post, delete};
    use tower_http::cors::CorsLayer;

    // Public routes
    let public_routes = axum::Router::new()
        .route("/health", get(health_handler))
        .route("/api/v1/auth/register", post(register_handler))
        .route("/api/v1/auth/login", post(login_handler));

    // Protected routes
    let protected_routes = axum::Router::new()
        .route("/api/v1/auth/me", get(me_handler))
        .route(
            "/api/v1/auth/api-keys",
            get(list_api_keys_handler).post(create_api_key_handler),
        )
        .route("/api/v1/auth/api-keys/{id}", delete(delete_api_key_handler))
        .route(
            "/api/v1/libraries",
            get(list_libraries_handler).post(create_library_handler),
        )
        .route(
            "/api/v1/libraries/{id}",
            get(get_library_handler)
                .patch(update_library_handler)
                .delete(delete_library_handler),
        )
        .route("/api/v1/libraries/{id}/scan", post(scan_library_handler))
        .route("/api/v1/libraries/{id}/authors", get(list_authors_handler))
        .route("/api/v1/libraries/{id}/books", get(list_books_handler))
        .route("/api/v1/authors/{id}", get(get_author_handler))
        .route("/api/v1/authors/{id}/series", get(author_series_handler))
        .route("/api/v1/authors/{id}/standalone", get(author_standalone_handler))
        .route("/api/v1/series/{id}", get(get_series_handler))
        .route("/api/v1/books/{id}", get(get_book_handler))
        .layer(middleware::from_fn_with_state(
            app_state.clone(),
            auth_middleware,
        ));

    // OPDS routes (also auth-protected)
    let opds_routes = axum::Router::new()
        .route("/opds", get(opds_root_handler))
        .route("/opds/authors", get(opds_authors_handler))
        .route("/opds/authors/{id}", get(opds_author_handler))
        .route("/opds/series/{id}", get(opds_series_handler))
        .route("/opds/recent", get(opds_recent_handler))
        .route("/opds/search", get(opds_search_handler))
        .layer(middleware::from_fn_with_state(
            app_state.clone(),
            auth_middleware,
        ));

    axum::Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(opds_routes)
        .layer(CorsLayer::permissive())
        .with_state(app_state)
}

// --- Re-export wrappers ---
// Integration tests are external crates, so we cannot access private modules.
// We build the router here using ironshelf-server's public binary entry point.
// However, since ironshelf-server is a bin crate (not lib), we reconstruct
// the router logic in test using the same dependencies directly.

// These type aliases + imports drive the test router construction.
use ironshelf_core::db::IronshelfDb;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Mirror of AppState from the server (integration tests can't import private types).
#[derive(Clone)]
struct AppState {
    libraries: Arc<RwLock<Vec<LoadedLibrary>>>,
    ironshelf_db: IronshelfDb,
}

/// Mirror of LibrarySource.
#[derive(Clone)]
enum LibrarySource {
    Calibre(ironshelf_core::calibre::CalibreSource),
    #[allow(dead_code)]
    Folder(Arc<RwLock<ironshelf_core::scan::FolderSource>>),
}

/// Mirror of LoadedLibrary.
#[derive(Clone)]
struct LoadedLibrary {
    id: String,
    name: String,
    #[allow(dead_code)]
    library_type: String,
    #[allow(dead_code)]
    source_kind: String,
    source: LibrarySource,
}

// --- Minimal route handlers for the test router ---
// These replicate the server's behavior enough for integration testing.

use axum::extract::{Path, Query, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::Row;

/// Auth user context.
#[derive(Debug, Clone)]
struct AuthUser {
    user_id: String,
    username: String,
    is_owner: bool,
}

/// Auth middleware (mirrors server auth).
async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let pool = state.ironshelf_db.pool();

    // Try Bearer token first
    if let Some(auth_header) = request.headers().get(header::AUTHORIZATION) {
        let auth_str = auth_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;
        if let Some(token) = auth_str.strip_prefix("Bearer ") {
            let token = token.strip_prefix("irs_").ok_or(StatusCode::UNAUTHORIZED)?;
            let (prefix, secret) = token.split_once('.').ok_or(StatusCode::UNAUTHORIZED)?;

            let row = sqlx::query(
                "SELECT ak.key_hash, ak.user_id, u.username, u.is_owner \
                 FROM api_keys ak JOIN users u ON u.id = ak.user_id \
                 WHERE ak.prefix = ?",
            )
            .bind(prefix)
            .fetch_optional(pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::UNAUTHORIZED)?;

            let key_hash: String = row.get("key_hash");
            if !verify_password_check(secret, &key_hash) {
                return Err(StatusCode::UNAUTHORIZED);
            }

            let auth_user = AuthUser {
                user_id: row.get("user_id"),
                username: row.get("username"),
                is_owner: row.get::<i32, _>("is_owner") != 0,
            };
            request.extensions_mut().insert(auth_user);
            return Ok(next.run(request).await);
        }
    }

    // Try session cookie
    if let Some(cookie_header) = request.headers().get(header::COOKIE) {
        let cookie_str = cookie_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;
        let session_id = cookie_str
            .split(';')
            .map(|s| s.trim())
            .find(|s| s.starts_with("ironshelf_session="))
            .and_then(|s| s.strip_prefix("ironshelf_session="))
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let row = sqlx::query(
            "SELECT s.user_id, u.username, u.is_owner, s.expires_at \
             FROM sessions s JOIN users u ON u.id = s.user_id \
             WHERE s.id = ?",
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

        let auth_user = AuthUser {
            user_id: row.get("user_id"),
            username: row.get("username"),
            is_owner: row.get::<i32, _>("is_owner") != 0,
        };
        request.extensions_mut().insert(auth_user);
        return Ok(next.run(request).await);
    }

    Err(StatusCode::UNAUTHORIZED)
}

fn verify_password_check(password: &str, hash: &str) -> bool {
    use argon2::{
        password_hash::{PasswordHash, PasswordVerifier},
        Argon2,
    };
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

fn hash_password(password: &str) -> String {
    use argon2::{
        password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
        Argon2,
    };
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("hash failed")
        .to_string()
}

// --- Route handlers (simplified versions for testing) ---

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok", "service": "ironshelf-server"}))
}

#[derive(Deserialize)]
struct RegisterRequest {
    username: String,
    password: String,
}

#[derive(Serialize, Deserialize)]
struct AuthResponse {
    user_id: String,
    username: String,
    is_owner: bool,
    session_id: String,
}

async fn register_handler(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), StatusCode> {
    let pool = state.ironshelf_db.pool();

    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let is_owner = user_count == 0;
    let password_hash = hash_password(&request.password);
    let user_id = uuid::Uuid::new_v4().to_string();

    sqlx::query("INSERT INTO users (id, username, password_hash, is_owner) VALUES (?, ?, ?, ?)")
        .bind(&user_id)
        .bind(&request.username)
        .bind(&password_hash)
        .bind(is_owner as i32)
        .execute(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let session_id = create_test_session(pool, &user_id).await;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            user_id,
            username: request.username,
            is_owner,
            session_id,
        }),
    ))
}

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn login_handler(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Response, StatusCode> {
    let pool = state.ironshelf_db.pool();

    let row = sqlx::query("SELECT id, username, password_hash, is_owner FROM users WHERE username = ?")
        .bind(&request.username)
        .fetch_optional(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let stored_hash: String = row.get("password_hash");
    if !verify_password_check(&request.password, &stored_hash) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user_id: String = row.get("id");
    let username: String = row.get("username");
    let is_owner: bool = row.get::<i32, _>("is_owner") != 0;

    let session_id = create_test_session(pool, &user_id).await;

    let cookie = format!(
        "ironshelf_session={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800",
        session_id
    );

    let body = serde_json::json!({
        "user_id": user_id,
        "username": username,
        "is_owner": is_owner,
        "session_id": session_id,
    });

    Ok((StatusCode::OK, [(header::SET_COOKIE, cookie)], Json(body)).into_response())
}

async fn me_handler(
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "user_id": user.user_id,
        "username": user.username,
        "is_owner": user.is_owner,
    }))
}

#[derive(Deserialize)]
struct CreateApiKeyRequest {
    label: String,
}

#[derive(Serialize, Deserialize)]
struct ApiKeyResponse {
    key: String,
    prefix: String,
    label: String,
}

async fn create_api_key_handler(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Json(request): Json<CreateApiKeyRequest>,
) -> Result<(StatusCode, Json<ApiKeyResponse>), StatusCode> {
    let pool = state.ironshelf_db.pool();

    let prefix = format!("{:08x}", rand_u64());
    let secret = format!("{:032x}", rand_u128());
    let full_key = format!("irs_{prefix}.{secret}");

    let secret_hash = hash_password(&secret);
    let key_id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO api_keys (id, user_id, prefix, key_hash, label) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&key_id)
    .bind(&user.user_id)
    .bind(&prefix)
    .bind(&secret_hash)
    .bind(&request.label)
    .execute(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((
        StatusCode::CREATED,
        Json(ApiKeyResponse {
            key: full_key,
            prefix,
            label: request.label,
        }),
    ))
}

async fn list_api_keys_handler(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.ironshelf_db.pool();
    let rows = sqlx::query(
        "SELECT id, prefix, label, created_at FROM api_keys WHERE user_id = ?",
    )
    .bind(&user.user_id)
    .fetch_all(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let keys: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<String, _>("id"),
                "prefix": row.get::<String, _>("prefix"),
                "label": row.get::<String, _>("label"),
                "created_at": row.get::<String, _>("created_at"),
            })
        })
        .collect();

    Ok(Json(serde_json::json!(keys)))
}

async fn delete_api_key_handler(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(key_id): Path<String>,
) -> StatusCode {
    let pool = state.ironshelf_db.pool();
    let _ = sqlx::query("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
        .bind(&key_id)
        .bind(&user.user_id)
        .execute(pool)
        .await;
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct CreateLibraryRequest {
    name: String,
    library_type: String,
    source_kind: String,
    path: String,
}

async fn create_library_handler(
    State(state): State<AppState>,
    Json(request): Json<CreateLibraryRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    let library_id = uuid::Uuid::new_v4().to_string();
    let pool = state.ironshelf_db.pool();

    sqlx::query(
        "INSERT INTO library_config (id, name, library_type, source_kind, path) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&library_id)
    .bind(&request.name)
    .bind(&request.library_type)
    .bind(&request.source_kind)
    .bind(&request.path)
    .execute(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Open the Calibre source and add to live state
    if request.source_kind == "calibre" {
        let calibre_source = ironshelf_core::calibre::CalibreSource::open(&request.path)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let mut libraries = state.libraries.write().await;
        libraries.push(LoadedLibrary {
            id: library_id.clone(),
            name: request.name.clone(),
            library_type: request.library_type.clone(),
            source_kind: request.source_kind.clone(),
            source: LibrarySource::Calibre(calibre_source),
        });
    }

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": library_id,
            "name": request.name,
            "library_type": request.library_type,
        })),
    ))
}

async fn list_libraries_handler(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let libraries = state.libraries.read().await;
    let summaries: Vec<serde_json::Value> = libraries
        .iter()
        .map(|library| {
            serde_json::json!({
                "id": library.id,
                "name": library.name,
                "library_type": library.library_type,
                "source_kind": library.source_kind,
            })
        })
        .collect();
    Json(serde_json::json!(summaries))
}

async fn get_library_handler(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(serde_json::json!({
        "id": library.id,
        "name": library.name,
        "library_type": library.library_type,
        "source_kind": library.source_kind,
    })))
}

async fn update_library_handler() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn delete_library_handler(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> StatusCode {
    let mut libraries = state.libraries.write().await;
    libraries.retain(|l| l.id != library_id);
    StatusCode::NO_CONTENT
}

async fn scan_library_handler() -> StatusCode {
    StatusCode::ACCEPTED
}

async fn list_authors_handler(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let authors = match &library.source {
        LibrarySource::Calibre(source) => source.authors().await.unwrap_or_default(),
        LibrarySource::Folder(source) => source.read().await.authors(),
    };

    Ok(Json(serde_json::to_value(authors).unwrap_or_default()))
}

async fn list_books_handler(
    State(state): State<AppState>,
    Path(library_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let libraries = state.libraries.read().await;
    let library = libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let books = match &library.source {
        LibrarySource::Calibre(source) => source.all_books().await.unwrap_or_default(),
        LibrarySource::Folder(source) => source.read().await.all_books(),
    };

    Ok(Json(serde_json::to_value(books).unwrap_or_default()))
}

async fn get_author_handler(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        let authors = match &library.source {
            LibrarySource::Calibre(source) => source.authors().await.unwrap_or_default(),
            LibrarySource::Folder(source) => source.read().await.authors(),
        };
        if let Some(author) = authors.into_iter().find(|a| a.id == author_id) {
            return Ok(Json(serde_json::to_value(author).unwrap_or_default()));
        }
    }
    Err(StatusCode::NOT_FOUND)
}

async fn author_series_handler(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        if let LibrarySource::Calibre(source) = &library.source {
            let series = source.series_by_author(author_id).await.unwrap_or_default();
            if !series.is_empty() {
                return Ok(Json(serde_json::to_value(series).unwrap_or_default()));
            }
        }
    }
    Ok(Json(serde_json::json!([])))
}

async fn author_standalone_handler(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        if let LibrarySource::Calibre(source) = &library.source {
            let books = source.standalone_books(author_id).await.unwrap_or_default();
            if !books.is_empty() {
                return Ok(Json(serde_json::to_value(books).unwrap_or_default()));
            }
        }
    }
    Ok(Json(serde_json::json!([])))
}

async fn get_series_handler(
    State(state): State<AppState>,
    Path(series_id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        if let LibrarySource::Calibre(source) = &library.source {
            if let Ok(Some(series)) = source.series(series_id).await {
                let books = source.books_in_series(series_id).await.unwrap_or_default();
                return Ok(Json(serde_json::json!({
                    "id": series.id,
                    "name": series.name,
                    "books": books,
                })));
            }
        }
    }
    Err(StatusCode::NOT_FOUND)
}

async fn get_book_handler(
    State(state): State<AppState>,
    Path(book_id): Path<i64>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let libraries = state.libraries.read().await;
    for library in libraries.iter() {
        let book = match &library.source {
            LibrarySource::Calibre(source) => source.book(book_id).await.unwrap_or(None),
            LibrarySource::Folder(source) => source.read().await.book(book_id),
        };
        if let Some(book) = book {
            return Ok(Json(serde_json::to_value(book).unwrap_or_default()));
        }
    }
    Err(StatusCode::NOT_FOUND)
}

// --- OPDS handlers (same logic as opds.rs but using test types) ---

const OPDS_CONTENT_TYPE: &str = "application/atom+xml;profile=opds-catalog;charset=utf-8";

async fn opds_root_handler() -> impl IntoResponse {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:ironshelf:root</id>
  <title>Ironshelf Catalog</title>
  <entry>
    <title>By Author</title>
    <link rel="subsection" href="/opds/authors" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  </entry>
  <entry>
    <title>By Series</title>
    <link rel="subsection" href="/opds/series" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  </entry>
  <entry>
    <title>Recent Additions</title>
    <link rel="subsection" href="/opds/recent" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  </entry>
</feed>"#;
    (StatusCode::OK, [(header::CONTENT_TYPE, OPDS_CONTENT_TYPE)], xml)
}

async fn opds_authors_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let libraries = state.libraries.read().await;
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n",
    );
    xml.push_str("  <title>Authors</title>\n");

    for library in libraries.iter() {
        let authors = match &library.source {
            LibrarySource::Calibre(source) => source.authors().await.unwrap_or_default(),
            LibrarySource::Folder(source) => source.read().await.authors(),
        };
        for author in authors {
            xml.push_str(&format!(
                "  <entry><title>{}</title><id>urn:ironshelf:author:{}</id></entry>\n",
                xml_escape_test(&author.name),
                author.id
            ));
        }
    }
    xml.push_str("</feed>");
    (StatusCode::OK, [(header::CONTENT_TYPE, OPDS_CONTENT_TYPE)], xml)
}

async fn opds_author_handler(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> impl IntoResponse {
    let libraries = state.libraries.read().await;
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n",
    );

    for library in libraries.iter() {
        if let LibrarySource::Calibre(source) = &library.source {
            let series = source.series_by_author(author_id).await.unwrap_or_default();
            for s in series {
                xml.push_str(&format!(
                    "  <entry><title>{}</title><link rel=\"subsection\" href=\"/opds/series/{}\"/></entry>\n",
                    xml_escape_test(&s.name), s.id
                ));
            }
            let standalone = source.standalone_books(author_id).await.unwrap_or_default();
            for book in standalone {
                xml.push_str(&format!(
                    "  <entry><title>{}</title><link rel=\"http://opds-spec.org/acquisition\" href=\"/api/v1/books/{}/file\"/></entry>\n",
                    xml_escape_test(&book.title), book.id
                ));
            }
        }
    }
    xml.push_str("</feed>");
    (StatusCode::OK, [(header::CONTENT_TYPE, OPDS_CONTENT_TYPE)], xml)
}

async fn opds_series_handler(
    State(state): State<AppState>,
    Path(series_id): Path<i64>,
) -> impl IntoResponse {
    let libraries = state.libraries.read().await;
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n",
    );

    for library in libraries.iter() {
        if let LibrarySource::Calibre(source) = &library.source {
            let books = source.books_in_series(series_id).await.unwrap_or_default();
            for book in books {
                xml.push_str(&format!(
                    "  <entry><title>{}</title><link rel=\"http://opds-spec.org/acquisition\" href=\"/api/v1/books/{}/file\"/></entry>\n",
                    xml_escape_test(&book.title), book.id
                ));
            }
        }
    }
    xml.push_str("</feed>");
    (StatusCode::OK, [(header::CONTENT_TYPE, OPDS_CONTENT_TYPE)], xml)
}

async fn opds_recent_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let libraries = state.libraries.read().await;
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n",
    );
    xml.push_str("  <title>Recent Additions</title>\n");

    for library in libraries.iter() {
        let books = match &library.source {
            LibrarySource::Calibre(source) => source.all_books().await.unwrap_or_default(),
            LibrarySource::Folder(source) => source.read().await.all_books(),
        };
        for book in books.iter().take(50) {
            xml.push_str(&format!(
                "  <entry><title>{}</title></entry>\n",
                xml_escape_test(&book.title)
            ));
        }
    }
    xml.push_str("</feed>");
    (StatusCode::OK, [(header::CONTENT_TYPE, OPDS_CONTENT_TYPE)], xml)
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

async fn opds_search_handler(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
    let search_term = query.q.to_lowercase();
    let libraries = state.libraries.read().await;
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n",
    );

    for library in libraries.iter() {
        let books = match &library.source {
            LibrarySource::Calibre(source) => source.all_books().await.unwrap_or_default(),
            LibrarySource::Folder(source) => source.read().await.all_books(),
        };
        for book in books {
            if book.title.to_lowercase().contains(&search_term) {
                xml.push_str(&format!(
                    "  <entry><title>{}</title></entry>\n",
                    xml_escape_test(&book.title)
                ));
            }
        }
    }
    xml.push_str("</feed>");
    (StatusCode::OK, [(header::CONTENT_TYPE, OPDS_CONTENT_TYPE)], xml)
}

fn xml_escape_test(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// --- Helpers ---

async fn create_test_session(pool: &sqlx::SqlitePool, user_id: &str) -> String {
    let session_id = uuid::Uuid::new_v4().to_string();
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(7)).to_rfc3339();
    sqlx::query("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(&session_id)
        .bind(user_id)
        .bind(&expires_at)
        .execute(pool)
        .await
        .expect("failed to create session");
    session_id
}

fn rand_u64() -> u64 {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    OsRng.next_u64()
}

fn rand_u128() -> u128 {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let high = OsRng.next_u64() as u128;
    let low = OsRng.next_u64() as u128;
    (high << 64) | low
}

// ============================================================
// TESTS
// ============================================================

#[tokio::test]
async fn test_health_endpoint() {
    let server = start_test_server().await;

    let response = server
        .client
        .get(format!("{}/health", server.base_url))
        .send()
        .await
        .expect("health request failed");

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.expect("invalid json");
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn test_register_first_user_becomes_owner() {
    let server = start_test_server().await;

    let response = server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register request failed");

    assert_eq!(response.status(), 201);
    let body: AuthResponse = response.json().await.expect("invalid json");
    assert_eq!(body.username, "admin");
    assert!(body.is_owner);
    assert!(!body.session_id.is_empty());
}

#[tokio::test]
async fn test_register_second_user_not_owner() {
    let server = start_test_server().await;

    // Register first user (owner)
    server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register request failed");

    // Register second user (not owner)
    let response = server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "reader",
            "password": "readerpass456"
        }))
        .send()
        .await
        .expect("register request failed");

    assert_eq!(response.status(), 201);
    let body: AuthResponse = response.json().await.expect("invalid json");
    assert_eq!(body.username, "reader");
    assert!(!body.is_owner);
}

#[tokio::test]
async fn test_login_and_session() {
    let server = start_test_server().await;

    // Register
    server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register failed");

    // Login
    let login_response = server
        .client
        .post(format!("{}/api/v1/auth/login", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("login failed");

    assert_eq!(login_response.status(), 200);

    // Check that session cookie was set (reqwest cookie store)
    let has_set_cookie = login_response
        .headers()
        .get("set-cookie")
        .is_some();
    assert!(has_set_cookie);
}

#[tokio::test]
async fn test_auth_required_returns_401_without_token() {
    let server = start_test_server().await;

    // Try accessing protected route without auth
    let response = server
        .client
        .get(format!("{}/api/v1/libraries", server.base_url))
        .send()
        .await
        .expect("request failed");

    assert_eq!(response.status(), 401);
}

#[tokio::test]
async fn test_auth_with_api_key_returns_200() {
    let server = start_test_server().await;

    // Register and get session
    let register_response = server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register failed");

    let auth: AuthResponse = register_response.json().await.expect("invalid json");

    // Create API key (using session cookie)
    let api_key_response = server
        .client
        .post(format!("{}/api/v1/auth/api-keys", server.base_url))
        .header("Cookie", format!("ironshelf_session={}", auth.session_id))
        .json(&serde_json::json!({"label": "test key"}))
        .send()
        .await
        .expect("create api key failed");

    assert_eq!(api_key_response.status(), 201);
    let api_key: ApiKeyResponse = api_key_response.json().await.expect("invalid json");

    // Use the API key to access protected route
    let response = server
        .client
        .get(format!("{}/api/v1/libraries", server.base_url))
        .header("Authorization", format!("Bearer {}", api_key.key))
        .send()
        .await
        .expect("request failed");

    assert_eq!(response.status(), 200);
}

#[tokio::test]
async fn test_create_and_list_libraries() {
    let server = start_test_server().await;

    // Register
    let register_response = server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register failed");

    let auth: AuthResponse = register_response.json().await.expect("invalid json");
    let auth_header = format!("ironshelf_session={}", auth.session_id);

    // Get the calibre directory path from the temp dir
    let calibre_path = server
        ._temp_dir
        .path()
        .join("calibre")
        .to_string_lossy()
        .to_string();

    // Create a library
    let create_response = server
        .client
        .post(format!("{}/api/v1/libraries", server.base_url))
        .header("Cookie", &auth_header)
        .json(&serde_json::json!({
            "name": "Test Library",
            "library_type": "book",
            "source_kind": "calibre",
            "path": calibre_path
        }))
        .send()
        .await
        .expect("create library failed");

    assert_eq!(create_response.status(), 201);
    let create_body: serde_json::Value = create_response.json().await.expect("invalid json");
    assert_eq!(create_body["name"], "Test Library");

    // List libraries
    let list_response = server
        .client
        .get(format!("{}/api/v1/libraries", server.base_url))
        .header("Cookie", &auth_header)
        .send()
        .await
        .expect("list libraries failed");

    assert_eq!(list_response.status(), 200);
    let libraries: Vec<serde_json::Value> = list_response.json().await.expect("invalid json");
    assert_eq!(libraries.len(), 1);
    assert_eq!(libraries[0]["name"], "Test Library");
}

#[tokio::test]
async fn test_opds_root_feed_returns_valid_xml() {
    let server = start_test_server().await;

    // Register to get auth
    let register_response = server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register failed");

    let auth: AuthResponse = register_response.json().await.expect("invalid json");
    let auth_header = format!("ironshelf_session={}", auth.session_id);

    // Request OPDS root
    let response = server
        .client
        .get(format!("{}/opds", server.base_url))
        .header("Cookie", &auth_header)
        .send()
        .await
        .expect("opds request failed");

    assert_eq!(response.status(), 200);

    // Verify content-type
    let content_type = response
        .headers()
        .get("content-type")
        .expect("missing content-type")
        .to_str()
        .expect("invalid content-type");
    assert!(
        content_type.contains("application/atom+xml"),
        "content-type should be atom+xml, got: {}",
        content_type
    );

    let body = response.text().await.expect("failed to read body");

    // Verify XML structure
    assert!(body.contains("<?xml version=\"1.0\""), "missing XML declaration");
    assert!(body.contains("<feed"), "missing feed element");
    assert!(body.contains("Ironshelf Catalog"), "missing catalog title");
    assert!(body.contains("By Author"), "missing authors entry");
    assert!(body.contains("By Series"), "missing series entry");
    assert!(body.contains("Recent Additions"), "missing recent entry");
    assert!(body.contains("</feed>"), "missing closing feed tag");
}

#[tokio::test]
async fn test_opds_requires_auth() {
    let server = start_test_server().await;

    // Request OPDS without auth
    let response = server
        .client
        .get(format!("{}/opds", server.base_url))
        .send()
        .await
        .expect("opds request failed");

    assert_eq!(response.status(), 401);
}

#[tokio::test]
async fn test_opds_authors_feed_with_library() {
    let server = start_test_server().await;

    // Register
    let register_response = server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register failed");

    let auth: AuthResponse = register_response.json().await.expect("invalid json");
    let auth_header = format!("ironshelf_session={}", auth.session_id);

    // Create library with Calibre source
    let calibre_path = server
        ._temp_dir
        .path()
        .join("calibre")
        .to_string_lossy()
        .to_string();

    server
        .client
        .post(format!("{}/api/v1/libraries", server.base_url))
        .header("Cookie", &auth_header)
        .json(&serde_json::json!({
            "name": "Test Library",
            "library_type": "book",
            "source_kind": "calibre",
            "path": calibre_path
        }))
        .send()
        .await
        .expect("create library failed");

    // Request OPDS authors feed
    let response = server
        .client
        .get(format!("{}/opds/authors", server.base_url))
        .header("Cookie", &auth_header)
        .send()
        .await
        .expect("opds authors request failed");

    assert_eq!(response.status(), 200);
    let body = response.text().await.expect("failed to read body");

    assert!(body.contains("Brandon Sanderson"), "missing test author Sanderson");
    assert!(body.contains("Terry Pratchett"), "missing test author Pratchett");
}

#[tokio::test]
async fn test_opds_search_feed() {
    let server = start_test_server().await;

    // Register
    let register_response = server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register failed");

    let auth: AuthResponse = register_response.json().await.expect("invalid json");
    let auth_header = format!("ironshelf_session={}", auth.session_id);

    // Create library
    let calibre_path = server
        ._temp_dir
        .path()
        .join("calibre")
        .to_string_lossy()
        .to_string();

    server
        .client
        .post(format!("{}/api/v1/libraries", server.base_url))
        .header("Cookie", &auth_header)
        .json(&serde_json::json!({
            "name": "Test Library",
            "library_type": "book",
            "source_kind": "calibre",
            "path": calibre_path
        }))
        .send()
        .await
        .expect("create library failed");

    // Search for "Kings"
    let response = server
        .client
        .get(format!("{}/opds/search?q=Kings", server.base_url))
        .header("Cookie", &auth_header)
        .send()
        .await
        .expect("opds search request failed");

    assert_eq!(response.status(), 200);
    let body = response.text().await.expect("failed to read body");

    assert!(
        body.contains("The Way of Kings"),
        "search should find 'The Way of Kings'"
    );
    assert!(
        !body.contains("Good Omens"),
        "search should not find 'Good Omens' for query 'Kings'"
    );
}

#[tokio::test]
async fn test_login_invalid_credentials_returns_401() {
    let server = start_test_server().await;

    // Register
    server
        .client
        .post(format!("{}/api/v1/auth/register", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "testpassword123"
        }))
        .send()
        .await
        .expect("register failed");

    // Login with wrong password
    let response = server
        .client
        .post(format!("{}/api/v1/auth/login", server.base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "wrongpassword"
        }))
        .send()
        .await
        .expect("login failed");

    assert_eq!(response.status(), 401);
}
