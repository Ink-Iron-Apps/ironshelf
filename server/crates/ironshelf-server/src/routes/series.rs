use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;

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
    Path(series_id): Path<i64>,
) -> Result<Json<SeriesDetail>, AppError> {
    let libraries = state.libraries.read().await;

    for library in libraries.iter() {
        if let Ok(Some(series)) = library.source.series(series_id).await {
            let books = library
                .source
                .books_in_series(series_id)
                .await
                .unwrap_or_default();

            return Ok(Json(SeriesDetail { series, books }));
        }
    }

    Err(AppError::not_found("series"))
}
