//! Outbound webhook dispatcher.
//!
//! Finds active webhooks subscribed to an event, POSTs the payload to each URL
//! with an HMAC-SHA256 signature header, logs delivery results, and retries once on failure.

use hmac::{Hmac, Mac};
use ironshelf_core::db::IronshelfDb;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Dispatch an event to all subscribed webhooks.
///
/// Spawns a background task per webhook so the caller is never blocked.
pub async fn dispatch_event(
    ironshelf_db: &IronshelfDb,
    event: &str,
    payload: &serde_json::Value,
) {
    let webhooks = match ironshelf_db.get_webhooks_for_event(event).await {
        Ok(webhooks) => webhooks,
        Err(error) => {
            tracing::error!("failed to query webhooks for event {event}: {error}");
            return;
        }
    };

    if webhooks.is_empty() {
        return;
    }

    let payload_string = serde_json::to_string(payload).unwrap_or_default();

    for webhook in webhooks {
        let database = ironshelf_db.clone();
        let event_name = event.to_string();
        let body = payload_string.clone();
        let webhook_url = webhook.url.clone();
        let webhook_secret = webhook.secret.clone();
        let webhook_id = webhook.id.clone();

        tokio::spawn(async move {
            let signature = compute_signature(&body, webhook_secret.as_deref());
            let delivery_result = send_webhook_request(&webhook_url, &body, &signature).await;

            match delivery_result {
                Ok((status_code, response_body)) => {
                    let is_success = (200..300).contains(&status_code);
                    let _ = database
                        .log_webhook_delivery(
                            &webhook_id,
                            &event_name,
                            &body,
                            Some(status_code),
                            Some(&response_body),
                            is_success,
                        )
                        .await;

                    if !is_success {
                        // Retry once after 5 seconds
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                        let retry_result =
                            send_webhook_request(&webhook_url, &body, &signature).await;
                        match retry_result {
                            Ok((retry_status, retry_body)) => {
                                let retry_success = (200..300).contains(&retry_status);
                                let _ = database
                                    .log_webhook_delivery(
                                        &webhook_id,
                                        &event_name,
                                        &body,
                                        Some(retry_status),
                                        Some(&retry_body),
                                        retry_success,
                                    )
                                    .await;
                            }
                            Err(retry_error) => {
                                let _ = database
                                    .log_webhook_delivery(
                                        &webhook_id,
                                        &event_name,
                                        &body,
                                        None,
                                        Some(&retry_error),
                                        false,
                                    )
                                    .await;
                            }
                        }
                    }
                }
                Err(error_message) => {
                    let _ = database
                        .log_webhook_delivery(
                            &webhook_id,
                            &event_name,
                            &body,
                            None,
                            Some(&error_message),
                            false,
                        )
                        .await;

                    // Retry once after 5 seconds
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    let retry_result =
                        send_webhook_request(&webhook_url, &body, &signature).await;
                    match retry_result {
                        Ok((retry_status, retry_body)) => {
                            let retry_success = (200..300).contains(&retry_status);
                            let _ = database
                                .log_webhook_delivery(
                                    &webhook_id,
                                    &event_name,
                                    &body,
                                    Some(retry_status),
                                    Some(&retry_body),
                                    retry_success,
                                )
                                .await;
                        }
                        Err(retry_error) => {
                            let _ = database
                                .log_webhook_delivery(
                                    &webhook_id,
                                    &event_name,
                                    &body,
                                    None,
                                    Some(&retry_error),
                                    false,
                                )
                                .await;
                        }
                    }
                }
            }
        });
    }
}

/// Send the HTTP POST to the webhook URL with signature header.
async fn send_webhook_request(
    url: &str,
    body: &str,
    signature: &str,
) -> Result<(i32, String), String> {
    let client = reqwest::Client::new();

    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("X-Ironshelf-Signature", signature)
        .header("User-Agent", "Ironshelf-Webhook/1.0")
        .body(body.to_string())
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;

    let status_code = response.status().as_u16() as i32;
    let response_body = response
        .text()
        .await
        .unwrap_or_else(|_| "<failed to read body>".to_string());

    Ok((status_code, response_body))
}

/// Compute HMAC-SHA256 signature of the body using the webhook secret.
/// If no secret is configured, returns an empty string.
fn compute_signature(body: &str, secret: Option<&str>) -> String {
    match secret {
        Some(secret_value) if !secret_value.is_empty() => {
            let mut mac =
                HmacSha256::new_from_slice(secret_value.as_bytes()).expect("HMAC accepts any key");
            mac.update(body.as_bytes());
            let result = mac.finalize();
            format!("sha256={}", hex::encode(result.into_bytes()))
        }
        _ => String::new(),
    }
}
