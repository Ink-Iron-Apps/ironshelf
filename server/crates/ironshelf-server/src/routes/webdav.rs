//! Minimal WebDAV server for KOReader reading progress sync.
//!
//! Mounted at `/webdav/{auth_token}/` with authentication embedded in the URL path,
//! the same pattern used by Kobo sync. KOReader stores progress metadata in
//! `.koreader/md5hash/metadata.{epub,pdf}.lua` files — these are stored virtually
//! in the `webdav_files` database table rather than on disk.

use axum::body::{Body, Bytes};
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};

use crate::auth::{validate_api_key, AuthUser};
use crate::error::AppError;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

/// Validate the path-embedded auth token for WebDAV requests.
async fn authenticate_webdav_token(
    state: &AppState,
    auth_token: &str,
) -> Result<AuthUser, AppError> {
    let pool = state.ironshelf_db.pool();
    validate_api_key(pool, auth_token)
        .await
        .map_err(|_| AppError::Unauthorized("Invalid WebDAV auth token".to_string()))
}

// ---------------------------------------------------------------------------
// Top-level dispatchers (axum MethodFilter doesn't support custom WebDAV methods)
// ---------------------------------------------------------------------------

/// Unified dispatch handler for WebDAV requests nested under `/webdav/`.
/// Parses auth_token from the first path segment, remainder is the resource path.
/// Routes by HTTP method: OPTIONS, PROPFIND, GET, PUT, MKCOL, DELETE.
pub async fn webdav_dispatch(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, AppError> {
    // Extract the path after /webdav/ from the request URI
    let full_path = request.uri().path();
    let webdav_path = full_path
        .strip_prefix("/webdav/")
        .or_else(|| full_path.strip_prefix("/webdav"))
        .unwrap_or("")
        .to_string();

    // Parse: "auth_token/some/resource/path" or just "auth_token" or "auth_token/"
    let (auth_token, resource_path) = match webdav_path.find('/') {
        Some(slash_pos) => {
            let token = &webdav_path[..slash_pos];
            let path = webdav_path[slash_pos + 1..].trim_end_matches('/');
            (token.to_string(), path.to_string())
        }
        None => (webdav_path.trim_end_matches('/').to_string(), String::new()),
    };

    let method = request.method().clone();
    let headers = request.headers().clone();

    // Root path (no resource) — only OPTIONS and PROPFIND
    if resource_path.is_empty() {
        return match method.as_str() {
            "OPTIONS" => webdav_options(State(state), Path(auth_token)).await.map(IntoResponse::into_response),
            "PROPFIND" => propfind_root(State(state), Path(auth_token), headers).await.map(IntoResponse::into_response),
            _ => Ok(Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .body(Body::empty())
                .unwrap()),
        };
    }

    // Resource path — validate against traversal
    validate_webdav_path(&resource_path)?;

    match method.as_str() {
        "OPTIONS" => webdav_options_path(State(state), Path((auth_token, resource_path))).await.map(IntoResponse::into_response),
        "PROPFIND" => propfind_path(State(state), Path((auth_token, resource_path)), headers).await.map(IntoResponse::into_response),
        "GET" => webdav_get(State(state), Path((auth_token, resource_path))).await.map(IntoResponse::into_response),
        "PUT" => {
            let body = axum::body::to_bytes(request.into_body(), 50 * 1024 * 1024)
                .await
                .map_err(|error| AppError::BadRequest(format!("Failed to read request body: {error}")))?;
            webdav_put(State(state), Path((auth_token, resource_path)), headers, body).await.map(IntoResponse::into_response)
        }
        "MKCOL" => webdav_mkcol(State(state), Path((auth_token, resource_path))).await.map(IntoResponse::into_response),
        "DELETE" => webdav_delete(State(state), Path((auth_token, resource_path))).await.map(IntoResponse::into_response),
        _ => Ok(Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(Body::empty())
            .unwrap()),
    }
}

// ---------------------------------------------------------------------------
// OPTIONS
// ---------------------------------------------------------------------------

/// `OPTIONS /webdav/{auth_token}/` and `OPTIONS /webdav/{auth_token}/{*path}`
/// Return allowed methods and DAV compliance header.
pub async fn webdav_options(
    State(state): State<AppState>,
    Path(auth_token): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // Validate token even for OPTIONS to prevent enumeration
    let _auth_user = authenticate_webdav_token(&state, &auth_token).await?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("DAV", "1")
        .header("Allow", "OPTIONS, GET, PUT, PROPFIND, MKCOL, DELETE")
        .header(header::CONTENT_LENGTH, "0")
        .body(Body::empty())
        .unwrap())
}

/// `OPTIONS /webdav/{auth_token}/{*path}`
pub async fn webdav_options_path(
    State(state): State<AppState>,
    Path((auth_token, _resource_path)): Path<(String, String)>,
) -> Result<impl IntoResponse, AppError> {
    let _auth_user = authenticate_webdav_token(&state, &auth_token).await?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("DAV", "1")
        .header("Allow", "OPTIONS, GET, PUT, PROPFIND, MKCOL, DELETE")
        .header(header::CONTENT_LENGTH, "0")
        .body(Body::empty())
        .unwrap())
}

// ---------------------------------------------------------------------------
// PROPFIND
// ---------------------------------------------------------------------------

/// `PROPFIND /webdav/{auth_token}/` — list the root directory.
pub async fn propfind_root(
    State(state): State<AppState>,
    Path(auth_token): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    let auth_user = authenticate_webdav_token(&state, &auth_token).await?;
    let depth = parse_depth(&headers);

    let mut responses = Vec::new();

    // Root collection entry
    responses.push(build_collection_response(&format!("/webdav/{auth_token}/"), "/"));

    if depth > 0 {
        // List top-level WebDAV files/directories for this user
        let files = state
            .ironshelf_db
            .list_webdav_files(&auth_user.user_id, "/")
            .await
            .map_err(AppError::internal)?;

        // Collect unique top-level entries (directories and files)
        let mut seen_directories: std::collections::HashSet<String> = std::collections::HashSet::new();
        for file in &files {
            let relative_path = file.path.trim_start_matches('/');
            // Get the first path component
            if let Some(first_segment) = relative_path.split('/').next() {
                if first_segment.is_empty() {
                    continue;
                }
                // If the path has more segments, it's a directory
                let is_directory = relative_path.contains('/') && !relative_path.ends_with(first_segment);
                if is_directory || file.content_type == "httpd/unix-directory" {
                    if seen_directories.insert(first_segment.to_string()) {
                        responses.push(build_collection_response(
                            &format!("/webdav/{auth_token}/{first_segment}/"),
                            first_segment,
                        ));
                    }
                } else {
                    responses.push(build_file_response(
                        &format!("/webdav/{auth_token}/{}", relative_path),
                        first_segment,
                        file.size,
                        &file.modified_at,
                    ));
                }
            }
        }
    }

    let xml_body = build_multistatus_xml(&responses);

    Ok(Response::builder()
        .status(StatusCode::MULTI_STATUS)
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(Body::from(xml_body))
        .unwrap())
}

/// `PROPFIND /webdav/{auth_token}/{*path}` — list a subdirectory.
pub async fn propfind_path(
    State(state): State<AppState>,
    Path((auth_token, resource_path)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    let auth_user = authenticate_webdav_token(&state, &auth_token).await?;
    let depth = parse_depth(&headers);
    let normalized_path = normalize_path(&resource_path);

    let mut responses = Vec::new();

    // The directory itself
    let display_name = normalized_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(&normalized_path);
    responses.push(build_collection_response(
        &format!("/webdav/{auth_token}/{normalized_path}"),
        display_name,
    ));

    if depth > 0 {
        let prefix = if normalized_path.ends_with('/') {
            normalized_path.clone()
        } else {
            format!("{normalized_path}/")
        };

        let files = state
            .ironshelf_db
            .list_webdav_files(&auth_user.user_id, &format!("/{prefix}"))
            .await
            .map_err(AppError::internal)?;

        let prefix_len = format!("/{prefix}").len();
        let mut seen_directories: std::collections::HashSet<String> = std::collections::HashSet::new();

        for file in &files {
            let remaining = &file.path[prefix_len.min(file.path.len())..];
            if remaining.is_empty() {
                continue;
            }

            if let Some(first_segment) = remaining.split('/').next() {
                if first_segment.is_empty() {
                    continue;
                }
                let has_more_segments = remaining.len() > first_segment.len() + 1;
                if has_more_segments || file.content_type == "httpd/unix-directory" {
                    if seen_directories.insert(first_segment.to_string()) {
                        responses.push(build_collection_response(
                            &format!("/webdav/{auth_token}/{prefix}{first_segment}/"),
                            first_segment,
                        ));
                    }
                } else {
                    responses.push(build_file_response(
                        &format!("/webdav/{auth_token}/{prefix}{}", remaining.trim_start_matches('/')),
                        first_segment,
                        file.size,
                        &file.modified_at,
                    ));
                }
            }
        }
    }

    let xml_body = build_multistatus_xml(&responses);

    Ok(Response::builder()
        .status(StatusCode::MULTI_STATUS)
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .body(Body::from(xml_body))
        .unwrap())
}

// ---------------------------------------------------------------------------
// GET — download a file
// ---------------------------------------------------------------------------

/// `GET /webdav/{auth_token}/{*path}` — download a WebDAV file.
pub async fn webdav_get(
    State(state): State<AppState>,
    Path((auth_token, resource_path)): Path<(String, String)>,
) -> Result<impl IntoResponse, AppError> {
    let auth_user = authenticate_webdav_token(&state, &auth_token).await?;
    let normalized_path = format!("/{}", normalize_path(&resource_path));

    let file = state
        .ironshelf_db
        .get_webdav_file(&auth_user.user_id, &normalized_path)
        .await
        .map_err(AppError::internal)?
        .ok_or_else(|| AppError::not_found("WebDAV file"))?;

    let content = file.content.unwrap_or_default();

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &file.content_type)
        .header(header::CONTENT_LENGTH, content.len().to_string())
        .header("Last-Modified", &file.modified_at)
        .body(Body::from(content))
        .unwrap())
}

// ---------------------------------------------------------------------------
// PUT — upload/update a file
// ---------------------------------------------------------------------------

/// `PUT /webdav/{auth_token}/{*path}` — create or update a WebDAV file.
pub async fn webdav_put(
    State(state): State<AppState>,
    Path((auth_token, resource_path)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, AppError> {
    let auth_user = authenticate_webdav_token(&state, &auth_token).await?;
    let normalized_path = format!("/{}", normalize_path(&resource_path));

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream");

    // Ensure parent directories exist as markers
    ensure_parent_directories(&state, &auth_user.user_id, &normalized_path).await?;

    state
        .ironshelf_db
        .upsert_webdav_file(&auth_user.user_id, &normalized_path, &body, content_type)
        .await
        .map_err(AppError::internal)?;

    tracing::debug!(
        user_id = %auth_user.user_id,
        path = %normalized_path,
        size = body.len(),
        "webdav file uploaded"
    );

    Ok(StatusCode::CREATED)
}

// ---------------------------------------------------------------------------
// MKCOL — create a directory
// ---------------------------------------------------------------------------

/// `MKCOL /webdav/{auth_token}/{*path}` — create a directory (collection).
pub async fn webdav_mkcol(
    State(state): State<AppState>,
    Path((auth_token, resource_path)): Path<(String, String)>,
) -> Result<impl IntoResponse, AppError> {
    let auth_user = authenticate_webdav_token(&state, &auth_token).await?;
    let normalized_path = format!("/{}", normalize_path(&resource_path));

    // Ensure parent directories exist
    ensure_parent_directories(&state, &auth_user.user_id, &normalized_path).await?;

    state
        .ironshelf_db
        .create_webdav_directory(&auth_user.user_id, &normalized_path)
        .await
        .map_err(AppError::internal)?;

    tracing::debug!(
        user_id = %auth_user.user_id,
        path = %normalized_path,
        "webdav directory created"
    );

    Ok(StatusCode::CREATED)
}

// ---------------------------------------------------------------------------
// DELETE — remove a file
// ---------------------------------------------------------------------------

/// `DELETE /webdav/{auth_token}/{*path}` — delete a WebDAV file or directory.
/// For directories, also deletes all child files to prevent orphaned entries.
pub async fn webdav_delete(
    State(state): State<AppState>,
    Path((auth_token, resource_path)): Path<(String, String)>,
) -> Result<impl IntoResponse, AppError> {
    let auth_user = authenticate_webdav_token(&state, &auth_token).await?;
    let normalized_path = format!("/{}", normalize_path(&resource_path));

    // Delete the exact path (file or directory marker).
    state
        .ironshelf_db
        .delete_webdav_file(&auth_user.user_id, &normalized_path)
        .await
        .map_err(AppError::internal)?;

    // If this looks like a directory, also delete with trailing slash and all children.
    // This prevents orphaned files when a directory is deleted.
    let directory_prefix = if normalized_path.ends_with('/') {
        normalized_path.clone()
    } else {
        format!("{normalized_path}/")
    };

    state
        .ironshelf_db
        .delete_webdav_file(&auth_user.user_id, &directory_prefix)
        .await
        .map_err(AppError::internal)?;

    state
        .ironshelf_db
        .delete_webdav_files_by_prefix(&auth_user.user_id, &directory_prefix)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// XML builders
// ---------------------------------------------------------------------------

struct DavResponse {
    href: String,
    display_name: String,
    is_collection: bool,
    content_length: i64,
    last_modified: String,
}

fn build_collection_response(href: &str, display_name: &str) -> DavResponse {
    DavResponse {
        href: href.to_string(),
        display_name: display_name.to_string(),
        is_collection: true,
        content_length: 0,
        last_modified: chrono::Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string(),
    }
}

fn build_file_response(
    href: &str,
    display_name: &str,
    size: i64,
    modified_at: &str,
) -> DavResponse {
    // Convert ISO 8601 to HTTP date format for Last-Modified
    let last_modified = chrono::DateTime::parse_from_rfc3339(modified_at)
        .map(|datetime| datetime.format("%a, %d %b %Y %H:%M:%S GMT").to_string())
        .unwrap_or_else(|_| modified_at.to_string());

    DavResponse {
        href: href.to_string(),
        display_name: display_name.to_string(),
        is_collection: false,
        content_length: size,
        last_modified,
    }
}

fn build_multistatus_xml(responses: &[DavResponse]) -> String {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
    xml.push_str("<D:multistatus xmlns:D=\"DAV:\">\n");

    for response in responses {
        xml.push_str("  <D:response>\n");
        xml.push_str(&format!(
            "    <D:href>{}</D:href>\n",
            xml_escape(&response.href)
        ));
        xml.push_str("    <D:propstat>\n");
        xml.push_str("      <D:prop>\n");
        xml.push_str(&format!(
            "        <D:displayname>{}</D:displayname>\n",
            xml_escape(&response.display_name)
        ));
        xml.push_str(&format!(
            "        <D:getcontentlength>{}</D:getcontentlength>\n",
            response.content_length
        ));
        xml.push_str(&format!(
            "        <D:getlastmodified>{}</D:getlastmodified>\n",
            xml_escape(&response.last_modified)
        ));
        if response.is_collection {
            xml.push_str("        <D:resourcetype><D:collection/></D:resourcetype>\n");
        } else {
            xml.push_str("        <D:resourcetype/>\n");
        }
        xml.push_str("      </D:prop>\n");
        xml.push_str("      <D:status>HTTP/1.1 200 OK</D:status>\n");
        xml.push_str("    </D:propstat>\n");
        xml.push_str("  </D:response>\n");
    }

    xml.push_str("</D:multistatus>\n");
    xml
}

/// Minimal XML escaping for attribute/text content.
fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse the `Depth` header from the request (defaults to 1).
fn parse_depth(headers: &HeaderMap) -> u32 {
    headers
        .get("Depth")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| match value {
            "0" => Some(0),
            "1" => Some(1),
            "infinity" => Some(1), // Cap at 1 for safety
            _ => None,
        })
        .unwrap_or(1)
}

/// Normalize a path: remove leading/trailing slashes, collapse doubles.
/// Returns an empty string for root paths.
///
/// SAFETY: The caller must validate the result against path traversal
/// before using it. Use `validate_webdav_path()` for user-facing paths.
fn normalize_path(path: &str) -> String {
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        String::new()
    } else {
        trimmed.to_string()
    }
}

/// Validate that a WebDAV resource path does not contain path traversal segments.
/// Returns `Err(AppError)` if `..` segments or null bytes are found.
fn validate_webdav_path(path: &str) -> Result<(), AppError> {
    // Reject paths with null bytes, which could bypass path checks in some systems.
    if path.contains('\0') {
        return Err(AppError::BadRequest("Invalid path: null bytes not allowed".to_string()));
    }
    // Reject path traversal via `..` segments.
    for segment in path.split('/') {
        if segment == ".." {
            return Err(AppError::BadRequest("Invalid path: '..' segments not allowed".to_string()));
        }
    }
    Ok(())
}

/// Ensure all parent directory markers exist for a given file path.
async fn ensure_parent_directories(
    state: &AppState,
    user_id: &str,
    path: &str,
) -> Result<(), AppError> {
    let parts: Vec<&str> = path
        .trim_matches('/')
        .split('/')
        .collect();

    // Create each parent directory (skip the last component which is the file itself)
    let mut accumulated_path = String::new();
    for part in &parts[..parts.len().saturating_sub(1)] {
        accumulated_path.push('/');
        accumulated_path.push_str(part);
        state
            .ironshelf_db
            .create_webdav_directory(user_id, &accumulated_path)
            .await
            .map_err(AppError::internal)?;
    }

    Ok(())
}
