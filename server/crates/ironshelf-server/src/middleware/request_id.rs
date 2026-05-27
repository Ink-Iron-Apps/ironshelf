//! Request ID middleware.
//!
//! Generates a UUID v4 for every inbound request, attaches it as an
//! `X-Request-Id` response header, and adds it to the tracing span so
//! all log lines for that request share the same correlation ID.

use axum::body::Body;
use axum::http::header::HeaderValue;
use axum::http::{Request, Response};
use axum::middleware::Next;
use uuid::Uuid;

/// Middleware that assigns a unique request ID to each request.
///
/// The ID is:
/// - Added as an `X-Request-Id` response header for client-side correlation.
/// - Inserted into the current tracing span so server logs include it.
pub async fn request_id(request: Request<Body>, next: Next) -> Response<Body> {
    let generated_id = Uuid::new_v4().to_string();

    // Record the request ID in the current tracing span so every log line
    // emitted while handling this request includes it automatically.
    tracing::Span::current().record("request_id", &*generated_id);
    tracing::debug!(request_id = %generated_id, "assigned request id");

    let mut response = next.run(request).await;

    if let Ok(header_value) = HeaderValue::from_str(&generated_id) {
        response
            .headers_mut()
            .insert("x-request-id", header_value);
    }

    response
}
