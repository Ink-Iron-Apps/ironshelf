//! Server info/config endpoint — public, returns server capabilities and registration state.

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use sqlx::Row;

use crate::error::AppError;
use crate::state::AppState;

/// Response body for the server info endpoint.
#[derive(Debug, Serialize)]
pub struct ServerInfoResponse {
    pub name: &'static str,
    pub version: &'static str,
    pub features: Vec<&'static str>,
    pub registration_open: bool,
    pub invite_required: bool,
}

/// GET /api/v1/server/info — public endpoint describing server capabilities.
pub async fn server_info(
    State(state): State<AppState>,
) -> Result<Json<ServerInfoResponse>, AppError> {
    let pool = state.ironshelf_db.pool();

    // Check if any users exist to determine registration state.
    let user_count: i64 = sqlx::query("SELECT COUNT(*) as count FROM users")
        .fetch_one(pool)
        .await
        .map(|row| row.get("count"))
        .unwrap_or(0);

    let registration_open = user_count == 0;
    let invite_required = user_count > 0;

    Ok(Json(ServerInfoResponse {
        name: "Ironshelf",
        version: env!("CARGO_PKG_VERSION"),
        features: vec![
            "opds",
            "search",
            "custom_columns",
            "reading_progress",
        ],
        registration_open,
        invite_required,
    }))
}
