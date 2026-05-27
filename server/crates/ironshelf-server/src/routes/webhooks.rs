//! Webhook management routes.

use axum::extract::{Path, Query, State};
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;
use crate::webhook_dispatcher;

/// Allowed webhook event types.
const VALID_EVENTS: &[&str] = &[
    "book.added",
    "book.completed",
    "library.scanned",
    "user.registered",
    "collection.updated",
];

#[derive(Deserialize)]
pub struct CreateWebhookRequest {
    pub name: String,
    pub url: String,
    pub secret: Option<String>,
    pub events: Vec<String>,
}

#[derive(Deserialize)]
pub struct UpdateWebhookRequest {
    pub name: Option<String>,
    pub url: Option<String>,
    pub secret: Option<String>,
    pub events: Option<Vec<String>>,
    pub is_active: Option<bool>,
}

#[derive(Deserialize)]
pub struct DeliveryQuery {
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct WebhookResponse {
    pub id: String,
    pub name: String,
    pub url: String,
    pub events: Vec<String>,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct DeliveryResponse {
    pub id: String,
    pub webhook_id: String,
    pub event: String,
    pub payload_json: String,
    pub response_status: Option<i32>,
    pub response_body: Option<String>,
    pub delivered_at: String,
    pub is_success: bool,
}

/// GET /api/v1/webhooks — list the current user's webhooks.
pub async fn list_webhooks(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Vec<WebhookResponse>>, AppError> {
    let webhooks = state
        .ironshelf_db
        .list_webhooks(&auth_user.user_id)
        .await
        .map_err(AppError::internal)?;

    let response: Vec<WebhookResponse> = webhooks
        .into_iter()
        .map(|webhook| WebhookResponse {
            id: webhook.id,
            name: webhook.name,
            url: webhook.url,
            events: webhook.events,
            is_active: webhook.is_active,
            created_at: webhook.created_at,
        })
        .collect();

    Ok(Json(response))
}

/// POST /api/v1/webhooks — create a new webhook.
pub async fn create_webhook(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<CreateWebhookRequest>,
) -> Result<(axum::http::StatusCode, Json<WebhookResponse>), AppError> {
    // Validate events
    for event in &body.events {
        if !VALID_EVENTS.contains(&event.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Invalid event type: {event}. Valid events: {}",
                VALID_EVENTS.join(", ")
            )));
        }
    }

    if body.events.is_empty() {
        return Err(AppError::BadRequest(
            "At least one event must be specified".to_string(),
        ));
    }

    if body.url.is_empty() || body.name.is_empty() {
        return Err(AppError::BadRequest(
            "Name and URL are required".to_string(),
        ));
    }

    let webhook_id = state
        .ironshelf_db
        .create_webhook(
            &auth_user.user_id,
            &body.name,
            &body.url,
            body.secret.as_deref(),
            &body.events,
        )
        .await
        .map_err(AppError::internal)?;

    let response = WebhookResponse {
        id: webhook_id,
        name: body.name,
        url: body.url,
        events: body.events,
        is_active: true,
        created_at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    };

    Ok((axum::http::StatusCode::CREATED, Json(response)))
}

/// PATCH /api/v1/webhooks/:id — update a webhook.
pub async fn update_webhook(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(webhook_id): Path<String>,
    Json(body): Json<UpdateWebhookRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Validate events if provided
    if let Some(ref events) = body.events {
        for event in events {
            if !VALID_EVENTS.contains(&event.as_str()) {
                return Err(AppError::BadRequest(format!(
                    "Invalid event type: {event}. Valid events: {}",
                    VALID_EVENTS.join(", ")
                )));
            }
        }
        if events.is_empty() {
            return Err(AppError::BadRequest(
                "At least one event must be specified".to_string(),
            ));
        }
    }

    state
        .ironshelf_db
        .update_webhook(
            &webhook_id,
            &auth_user.user_id,
            body.name.as_deref(),
            body.url.as_deref(),
            body.secret.as_deref(),
            body.events.as_deref(),
            body.is_active,
        )
        .await
        .map_err(AppError::internal)?;

    Ok(Json(serde_json::json!({ "updated": true })))
}

/// DELETE /api/v1/webhooks/:id — delete a webhook.
pub async fn delete_webhook(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(webhook_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .ironshelf_db
        .delete_webhook(&webhook_id, &auth_user.user_id)
        .await
        .map_err(|error| match error {
            ironshelf_core::db::DbError::NotFound => AppError::not_found("webhook"),
            other => AppError::internal(other),
        })?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// GET /api/v1/webhooks/:id/deliveries — delivery history.
pub async fn list_deliveries(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(webhook_id): Path<String>,
    Query(query): Query<DeliveryQuery>,
) -> Result<Json<Vec<DeliveryResponse>>, AppError> {
    // Verify ownership
    let webhook = state
        .ironshelf_db
        .get_webhook(&webhook_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("webhook"))?;

    if webhook.user_id != auth_user.user_id {
        return Err(AppError::Forbidden(
            "You do not own this webhook".to_string(),
        ));
    }

    let limit = query.limit.unwrap_or(20).min(100);

    let deliveries = state
        .ironshelf_db
        .get_webhook_deliveries(&webhook_id, limit)
        .await
        .map_err(AppError::internal)?;

    let response: Vec<DeliveryResponse> = deliveries
        .into_iter()
        .map(|delivery| DeliveryResponse {
            id: delivery.id,
            webhook_id: delivery.webhook_id,
            event: delivery.event,
            payload_json: delivery.payload_json,
            response_status: delivery.response_status,
            response_body: delivery.response_body,
            delivered_at: delivery.delivered_at,
            is_success: delivery.is_success,
        })
        .collect();

    Ok(Json(response))
}

/// POST /api/v1/webhooks/:id/test — send a test event.
pub async fn test_webhook(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(webhook_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Verify ownership
    let webhook = state
        .ironshelf_db
        .get_webhook(&webhook_id)
        .await
        .map_err(AppError::internal)?
        .ok_or(AppError::not_found("webhook"))?;

    if webhook.user_id != auth_user.user_id {
        return Err(AppError::Forbidden(
            "You do not own this webhook".to_string(),
        ));
    }

    let test_payload = serde_json::json!({
        "event": "test",
        "webhook_id": webhook_id,
        "timestamp": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        "message": "This is a test delivery from Ironshelf."
    });

    webhook_dispatcher::dispatch_event(&state.ironshelf_db, "test", &test_payload).await;

    Ok(Json(serde_json::json!({
        "sent": true,
        "message": "Test event dispatched"
    })))
}
