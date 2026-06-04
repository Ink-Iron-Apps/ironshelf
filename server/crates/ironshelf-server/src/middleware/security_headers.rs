//! Security response headers middleware.
//!
//! Adds defense-in-depth HTTP headers to every response: CSP, framing
//! protection, MIME-sniffing prevention, referrer policy, permissions policy.

use axum::body::Body;
use axum::http::header::HeaderValue;
use axum::http::{Request, Response};
use axum::middleware::Next;

/// Content-Security-Policy value.
///
/// - `default-src 'self'` — baseline: only same-origin.
/// - `script-src` — allow self + CDN JS (Cloudflare, jsDelivr).
/// - `style-src` — allow self + inline (needed for many UI frameworks) + Google Fonts CSS.
/// - `font-src` — Google Fonts static files.
/// - `img-src` — self + data URIs (inline covers) + blob URIs (canvas exports).
/// - `connect-src` — self + cloud API + external metadata APIs.
const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; \
    script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; \
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
    font-src https://fonts.gstatic.com; \
    img-src 'self' data: blob: https:; \
    connect-src 'self' https://cloud.inknironapps.com https://*.workers.dev https://*.trycloudflare.com";

/// Middleware that appends security headers to every response.
pub async fn security_headers(request: Request<Body>, next: Next) -> Response<Body> {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    // Prevent MIME-type sniffing — browser must respect declared Content-Type.
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );

    // Deny all framing — clickjacking protection.
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));

    // Disable XSS auditor. Modern browsers removed it; the header value "1"
    // can actually introduce vulnerabilities, so "0" is the safe choice.
    headers.insert("x-xss-protection", HeaderValue::from_static("0"));

    // Control how much referrer information is sent with navigations.
    headers.insert(
        "referrer-policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    // Restrict access to powerful browser features the app does not need.
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );

    // Content Security Policy — primary defense against XSS and injection.
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );

    // HSTS — once a browser sees this over HTTPS it refuses plaintext for a year.
    // Only meaningful (and only sent) on HTTPS, which is enforced at the edge for
    // tunnel/cloud access. Harmless on plain-HTTP LAN (browsers ignore it there).
    headers.insert(
        "strict-transport-security",
        HeaderValue::from_static("max-age=31536000; includeSubDomains"),
    );

    response
}
