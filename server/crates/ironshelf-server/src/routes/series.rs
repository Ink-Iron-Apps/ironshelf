use axum::extract::{Path, State};
use axum::{Extension, Json};
use serde::Serialize;

use crate::access::{accessible_library_ids, library_allowed};
use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Serialize)]
pub struct SeriesDetail {
    #[serde(flatten)]
    pub series: ironshelf_core::model::Series,
    pub books: Vec<ironshelf_core::model::Book>,
}

/// GET /api/v1/series/:id
pub async fn get_series(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(series_id): Path<i64>,
) -> Result<Json<SeriesDetail>, AppError> {
    let allowed = accessible_library_ids(&state, &auth_user).await;
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if !library_allowed(&allowed, &library.id) {
            continue;
        }
        if let Ok(Some(series)) = library.source.series(series_id).await {
            let books = library.source.books_in_series(series_id).await?;

            return Ok(Json(SeriesDetail { series, books }));
        }
    }

    Err(AppError::not_found("series"))
}
