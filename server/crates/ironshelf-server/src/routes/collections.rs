use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

// --- Response types ---

#[derive(Serialize)]
pub struct CollectionSummary {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct CollectionDetail {
    #[serde(flatten)]
    pub summary: CollectionSummary,
    pub books: Vec<CollectionBookEntry>,
}

#[derive(Serialize)]
pub struct CollectionBookEntry {
    pub book_id: String,
    pub position: i64,
    pub added_at: String,
}

#[derive(Serialize)]
pub struct CreateCollectionResponse {
    pub id: String,
    pub name: String,
}

// --- Request types ---

#[derive(Deserialize)]
pub struct CreateCollectionRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub is_public: bool,
}

#[derive(Deserialize)]
pub struct UpdateCollectionRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
}

#[derive(Deserialize)]
pub struct AddBookRequest {
    pub book_id: String,
    #[serde(default)]
    pub position: Option<i64>,
}

// --- Handlers ---

/// GET /api/v1/collections — list user's own + public collections.
pub async fn list_collections(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
) -> Result<Json<Vec<CollectionSummary>>, AppError> {
    let collections = state
        .ironshelf_db
        .list_collections(&user.user_id)
        .await
        .map_err(AppError::internal)?;

    let summaries = collections
        .into_iter()
        .map(|collection| CollectionSummary {
            id: collection.id,
            user_id: collection.user_id,
            name: collection.name,
            description: collection.description,
            is_public: collection.is_public,
            created_at: collection.created_at,
            updated_at: collection.updated_at,
        })
        .collect();

    Ok(Json(summaries))
}

/// POST /api/v1/collections — create a new collection.
pub async fn create_collection(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Json(request): Json<CreateCollectionRequest>,
) -> Result<(StatusCode, Json<CreateCollectionResponse>), AppError> {
    let trimmed_name = request.name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::BadRequest(
            "collection name must not be empty".to_string(),
        ));
    }

    let collection_id = state
        .ironshelf_db
        .create_collection(
            &user.user_id,
            trimmed_name,
            request.description.as_deref(),
            request.is_public,
        )
        .await
        .map_err(AppError::internal)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateCollectionResponse {
            id: collection_id,
            name: trimmed_name.to_string(),
        }),
    ))
}

/// GET /api/v1/collections/:id — collection detail with book entries.
pub async fn get_collection(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(collection_id): Path<String>,
) -> Result<Json<CollectionDetail>, AppError> {
    let collection = state
        .ironshelf_db
        .get_collection(&collection_id)
        .await
        .map_err(|_| AppError::not_found("collection"))?;

    // Visibility check: owner can always see, others only if public
    if collection.user_id != user.user_id && !collection.is_public {
        return Err(AppError::not_found("collection"));
    }

    let stored_books = state
        .ironshelf_db
        .get_collection_books(&collection_id)
        .await
        .map_err(AppError::internal)?;

    let books = stored_books
        .into_iter()
        .map(|entry| CollectionBookEntry {
            book_id: entry.book_id,
            position: entry.position,
            added_at: entry.added_at,
        })
        .collect();

    Ok(Json(CollectionDetail {
        summary: CollectionSummary {
            id: collection.id,
            user_id: collection.user_id,
            name: collection.name,
            description: collection.description,
            is_public: collection.is_public,
            created_at: collection.created_at,
            updated_at: collection.updated_at,
        },
        books,
    }))
}

/// PATCH /api/v1/collections/:id — update name/description/public flag.
pub async fn update_collection(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(collection_id): Path<String>,
    Json(request): Json<UpdateCollectionRequest>,
) -> Result<StatusCode, AppError> {
    let collection = state
        .ironshelf_db
        .get_collection(&collection_id)
        .await
        .map_err(|_| AppError::not_found("collection"))?;

    // Only the owner can update their collection
    if collection.user_id != user.user_id {
        return Err(AppError::Forbidden(
            "only the collection owner can update it".to_string(),
        ));
    }

    // Validate and trim name if provided
    let trimmed_name = request.name.as_deref().map(|name| name.trim().to_string());
    if let Some(ref name) = trimmed_name {
        if name.is_empty() {
            return Err(AppError::BadRequest(
                "collection name must not be empty".to_string(),
            ));
        }
    }

    state
        .ironshelf_db
        .update_collection(
            &collection_id,
            trimmed_name.as_deref(),
            request.description.as_deref(),
            request.is_public,
        )
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/v1/collections/:id — delete collection (owner only).
pub async fn delete_collection(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(collection_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let collection = state
        .ironshelf_db
        .get_collection(&collection_id)
        .await
        .map_err(|_| AppError::not_found("collection"))?;

    if collection.user_id != user.user_id {
        return Err(AppError::Forbidden(
            "only the collection owner can delete it".to_string(),
        ));
    }

    state
        .ironshelf_db
        .delete_collection(&collection_id)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/v1/collections/:id/books — add a book to the collection.
pub async fn add_book_to_collection(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path(collection_id): Path<String>,
    Json(request): Json<AddBookRequest>,
) -> Result<StatusCode, AppError> {
    let collection = state
        .ironshelf_db
        .get_collection(&collection_id)
        .await
        .map_err(|_| AppError::not_found("collection"))?;

    if collection.user_id != user.user_id {
        return Err(AppError::Forbidden(
            "only the collection owner can add books".to_string(),
        ));
    }

    // Validate position if explicitly provided
    if let Some(position) = request.position {
        if position < 0 {
            return Err(AppError::BadRequest(
                "position must not be negative".to_string(),
            ));
        }
    }

    // Default position: append at end (use count of existing books)
    let position = match request.position {
        Some(position) => position,
        None => {
            let existing_books = state
                .ironshelf_db
                .get_collection_books(&collection_id)
                .await
                .map_err(AppError::internal)?;
            existing_books.len() as i64
        }
    };

    state
        .ironshelf_db
        .add_book_to_collection(&collection_id, &request.book_id, position)
        .await
        .map_err(AppError::internal)?;

    Ok(StatusCode::CREATED)
}

/// DELETE /api/v1/collections/:id/books/:book_id — remove a book from the collection.
pub async fn remove_book_from_collection(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthUser>,
    Path((collection_id, book_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let collection = state
        .ironshelf_db
        .get_collection(&collection_id)
        .await
        .map_err(|_| AppError::not_found("collection"))?;

    if collection.user_id != user.user_id {
        return Err(AppError::Forbidden(
            "only the collection owner can remove books".to_string(),
        ));
    }

    state
        .ironshelf_db
        .remove_book_from_collection(&collection_id, &book_id)
        .await
        .map_err(|_| AppError::not_found("book in collection"))?;

    Ok(StatusCode::NO_CONTENT)
}
