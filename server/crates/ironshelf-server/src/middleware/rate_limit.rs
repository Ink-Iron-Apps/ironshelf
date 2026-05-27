//! Token-bucket rate limiter middleware.
//!
//! Two layers: generous for general API traffic, strict for auth endpoints.
//! In-memory only — no external deps. Background task prunes stale buckets.

use axum::body::Body;
use axum::http::{Request, Response, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use serde_json::json;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// A single token bucket for one client IP.
struct TokenBucket {
    /// Remaining tokens available for this client.
    remaining_tokens: u32,
    /// When tokens were last refilled.
    last_refill: Instant,
    /// Maximum tokens the bucket can hold.
    maximum_tokens: u32,
    /// How many tokens are added per second.
    refill_per_second: f64,
}

impl TokenBucket {
    fn new(maximum_tokens: u32, refill_per_second: f64) -> Self {
        Self {
            remaining_tokens: maximum_tokens,
            last_refill: Instant::now(),
            maximum_tokens,
            refill_per_second,
        }
    }

    /// Refill tokens based on elapsed time, then try to consume one.
    /// Returns `true` if the request is allowed.
    fn try_consume(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill);
        let tokens_to_add = (elapsed.as_secs_f64() * self.refill_per_second) as u32;

        if tokens_to_add > 0 {
            self.remaining_tokens =
                (self.remaining_tokens + tokens_to_add).min(self.maximum_tokens);
            self.last_refill = now;
        }

        if self.remaining_tokens > 0 {
            self.remaining_tokens -= 1;
            true
        } else {
            false
        }
    }

    /// Seconds until at least one token is available.
    fn seconds_until_refill(&self) -> u64 {
        if self.remaining_tokens > 0 {
            return 0;
        }
        let seconds_per_token = 1.0 / self.refill_per_second;
        seconds_per_token.ceil() as u64
    }

    /// Whether this bucket has been idle long enough to be pruned.
    fn is_stale(&self, staleness_threshold: Duration) -> bool {
        self.last_refill.elapsed() > staleness_threshold
            && self.remaining_tokens == self.maximum_tokens
    }
}

/// Shared rate limiter state keyed by client IP address.
#[derive(Clone)]
pub struct RateLimiter {
    buckets: Arc<Mutex<HashMap<IpAddr, TokenBucket>>>,
    maximum_tokens: u32,
    refill_per_second: f64,
}

impl RateLimiter {
    /// Create a new rate limiter with the given capacity and refill rate.
    pub fn new(maximum_tokens: u32, refill_per_second: f64) -> Self {
        Self {
            buckets: Arc::new(Mutex::new(HashMap::new())),
            maximum_tokens,
            refill_per_second,
        }
    }

    /// API-tier limiter: 100 requests/minute (~1.67/s).
    pub fn api_tier() -> Self {
        Self::new(100, 100.0 / 60.0)
    }

    /// Auth-tier limiter: 10 requests/minute (~0.167/s).
    pub fn auth_tier() -> Self {
        Self::new(10, 10.0 / 60.0)
    }

    /// Check whether a request from `client_address` is allowed.
    /// Returns `Ok(())` or `Err(retry_after_seconds)`.
    async fn check(&self, client_address: IpAddr) -> Result<(), u64> {
        let mut buckets = self.buckets.lock().await;
        let bucket = buckets
            .entry(client_address)
            .or_insert_with(|| TokenBucket::new(self.maximum_tokens, self.refill_per_second));

        if bucket.try_consume() {
            Ok(())
        } else {
            Err(bucket.seconds_until_refill())
        }
    }

    /// Spawn a background task that prunes stale bucket entries every 5 minutes.
    pub fn spawn_cleanup_task(&self) {
        let buckets = Arc::clone(&self.buckets);
        let staleness_threshold = Duration::from_secs(10 * 60); // 10 minutes idle

        tokio::spawn(async move {
            let mut cleanup_interval = tokio::time::interval(Duration::from_secs(5 * 60));
            cleanup_interval.tick().await; // first tick is immediate, skip it

            loop {
                cleanup_interval.tick().await;
                let mut locked_buckets = buckets.lock().await;
                let count_before = locked_buckets.len();
                locked_buckets.retain(|_address, bucket| !bucket.is_stale(staleness_threshold));
                let pruned_count = count_before - locked_buckets.len();
                if pruned_count > 0 {
                    tracing::debug!(
                        "rate limiter cleanup: pruned {pruned_count} stale entries, {} remaining",
                        locked_buckets.len()
                    );
                }
            }
        });
    }
}

/// Extract the client IP from the request.
///
/// Checks `X-Forwarded-For` first (first IP in the chain), then `X-Real-Ip`,
/// then falls back to the peer socket address.
///
/// TODO(security): X-Forwarded-For is trivially spoofable by direct clients.
/// When not behind a trusted reverse proxy, an attacker can bypass rate limiting
/// by rotating the header value. Consider adding a config flag to disable header
/// trust when the server is directly exposed, or use the rightmost non-private IP.
fn extract_client_address<B>(request: &Request<B>) -> IpAddr {
    // X-Forwarded-For: client, proxy1, proxy2 — take first.
    if let Some(forwarded_for) = request.headers().get("x-forwarded-for") {
        if let Ok(header_value) = forwarded_for.to_str() {
            if let Some(first_address) = header_value.split(',').next() {
                if let Ok(parsed_address) = first_address.trim().parse::<IpAddr>() {
                    return parsed_address;
                }
            }
        }
    }

    // X-Real-Ip (common with nginx).
    if let Some(real_ip) = request.headers().get("x-real-ip") {
        if let Ok(header_value) = real_ip.to_str() {
            if let Ok(parsed_address) = header_value.trim().parse::<IpAddr>() {
                return parsed_address;
            }
        }
    }

    // Fall back to peer address from the connection.
    request
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|connect_info| connect_info.ip())
        .unwrap_or_else(|| IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
}

/// Build a 429 Too Many Requests response with Retry-After header.
fn too_many_requests_response(retry_after_seconds: u64) -> Response<Body> {
    let body = json!({
        "error": "Too many requests. Please slow down.",
        "code": "rate_limited",
        "retry_after": retry_after_seconds,
    });

    let mut response = (StatusCode::TOO_MANY_REQUESTS, axum::Json(body)).into_response();
    response.headers_mut().insert(
        "retry-after",
        retry_after_seconds
            .to_string()
            .parse()
            .expect("valid header value"),
    );
    response
}

/// Middleware for general API rate limiting (100 req/min).
pub async fn rate_limit_api(
    axum::extract::State(limiter): axum::extract::State<RateLimiter>,
    request: Request<Body>,
    next: Next,
) -> Response<Body> {
    let client_address = extract_client_address(&request);

    match limiter.check(client_address).await {
        Ok(()) => next.run(request).await,
        Err(retry_after_seconds) => {
            tracing::warn!(
                client = %client_address,
                "API rate limit exceeded"
            );
            too_many_requests_response(retry_after_seconds)
        }
    }
}

/// Middleware for auth endpoint rate limiting (10 req/min).
pub async fn rate_limit_auth(
    axum::extract::State(limiter): axum::extract::State<RateLimiter>,
    request: Request<Body>,
    next: Next,
) -> Response<Body> {
    let client_address = extract_client_address(&request);

    match limiter.check(client_address).await {
        Ok(()) => next.run(request).await,
        Err(retry_after_seconds) => {
            tracing::warn!(
                client = %client_address,
                "Auth rate limit exceeded"
            );
            too_many_requests_response(retry_after_seconds)
        }
    }
}
