use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct LibrarySummary {
    pub id: String,
    pub name: String,
    pub library_type: String,
    pub source_kind: String,
}

#[derive(Serialize)]
pub struct LibraryDetail {
    #[serde(flatten)]
    pub summary: LibrarySummary,
    pub custom_columns: Vec<ironshelf_core::model::CustomColumn>,
}

/// GET /api/v1/libraries
pub async fn list_libraries(
    State(state): State<AppState>,
) -> Json<Vec<LibrarySummary>> {
    let libraries: Vec<LibrarySummary> = state
        .libraries
        .iter()
        .map(|library| LibrarySummary {
            id: library.id.clone(),
            name: library.name.clone(),
            library_type: library.library_type.clone(),
            source_kind: library.source_kind.clone(),
        })
        .collect();

    Json(libraries)
}

/// GET /api/v1/libraries/:id
pub async fn get_library(
    State(state): State<AppState>,
    axum::extract::Path(library_id): axum::extract::Path<String>,
) -> Result<Json<LibraryDetail>, axum::http::StatusCode> {
    let library = state
        .libraries
        .iter()
        .find(|l| l.id == library_id)
        .ok_or(axum::http::StatusCode::NOT_FOUND)?;

    let custom_columns = library
        .source
        .custom_columns()
        .await
        .unwrap_or_default();

    Ok(Json(LibraryDetail {
        summary: LibrarySummary {
            id: library.id.clone(),
            name: library.name.clone(),
            library_type: library.library_type.clone(),
            source_kind: library.source_kind.clone(),
        },
        custom_columns,
    }))
}
