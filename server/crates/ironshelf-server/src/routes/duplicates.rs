//! Duplicate book detection — /api/v1/duplicates/scan

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use std::collections::HashMap;

use crate::auth::{require_owner, AuthUser};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct DuplicateBookEntry {
    pub id: i64,
    pub title: String,
    pub author_names: Vec<String>,
    pub library_name: String,
}

#[derive(Debug, Serialize)]
pub struct DuplicateGroup {
    pub confidence: f64,
    pub reason: String,
    pub books: Vec<DuplicateBookEntry>,
}

/// GET /api/v1/duplicates/scan — scan all libraries for duplicate books (owner only).
pub async fn scan_duplicates(
    State(state): State<AppState>,
    axum::Extension(current_user): axum::Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_owner(&current_user)?;

    let libraries = state.libraries.read().await;

    // Collect all books with their library name.
    // Key: normalized "title|author" for dedup grouping.
    let mut book_groups: HashMap<String, Vec<DuplicateBookEntry>> = HashMap::new();

    for library in libraries.iter() {
        let all_books = library
            .source
            .all_books()
            .await
            .unwrap_or_default();

        for book in &all_books {
            let normalized_title = book.title.trim().to_lowercase();
            let mut author_names: Vec<String> = book.author_names.clone();
            author_names.sort();

            let normalized_authors = author_names
                .iter()
                .map(|name| name.trim().to_lowercase())
                .collect::<Vec<_>>()
                .join("|");

            let group_key = format!("{}||{}", normalized_title, normalized_authors);

            book_groups
                .entry(group_key)
                .or_default()
                .push(DuplicateBookEntry {
                    id: book.id,
                    title: book.title.clone(),
                    author_names,
                    library_name: library.name.clone(),
                });
        }
    }

    // Filter to groups with 2+ books (actual duplicates).
    let groups: Vec<DuplicateGroup> = book_groups
        .into_values()
        .filter(|entries| entries.len() >= 2)
        .map(|entries| DuplicateGroup {
            confidence: 0.95,
            reason: "same_title_author".to_string(),
            books: entries,
        })
        .collect();

    Ok(Json(serde_json::json!({ "groups": groups })))
}
