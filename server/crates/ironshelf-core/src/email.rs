//! SMTP email sender for Send-to-Kindle integration.
//!
//! Uses lettre to send ebook files as attachments to a user's @kindle.com address.
//! Amazon's Send-to-Kindle service converts supported formats automatically.

use std::path::Path;

use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

/// SMTP configuration for outbound email.
#[derive(Debug, Clone)]
pub struct EmailConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: String,
    pub smtp_password: String,
    pub from_address: String,
}

/// Supported ebook formats for Send-to-Kindle.
/// Amazon converts EPUB automatically; PDF and MOBI are accepted directly.
const SUPPORTED_KINDLE_FORMATS: &[&str] = &["epub", "pdf", "mobi"];

/// Check whether a format is supported for Send-to-Kindle.
pub fn is_kindle_supported_format(format: &str) -> bool {
    SUPPORTED_KINDLE_FORMATS.contains(&format.to_lowercase().as_str())
}

/// Send a book file as an email attachment to a Kindle address.
///
/// The subject line is used by Kindle for organization in the library.
/// Returns `Ok(())` on successful SMTP submission, or an error string on failure.
pub async fn send_book_to_kindle(
    config: &EmailConfig,
    kindle_email: &str,
    book_title: &str,
    file_path: &Path,
    format: &str,
) -> Result<(), String> {
    let format_lower = format.to_lowercase();
    if !is_kindle_supported_format(&format_lower) {
        return Err(format!(
            "Format '{}' is not supported for Send-to-Kindle. Supported: {}",
            format,
            SUPPORTED_KINDLE_FORMATS.join(", ")
        ));
    }

    // Read the file
    let file_content = tokio::fs::read(file_path)
        .await
        .map_err(|error| format!("Failed to read book file: {error}"))?;

    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("book")
        .to_string();

    // Determine MIME type
    let content_type = match format_lower.as_str() {
        "epub" => ContentType::parse("application/epub+zip")
            .unwrap_or(ContentType::APPLICATION_OCTET_STREAM),
        "pdf" => ContentType::parse("application/pdf")
            .unwrap_or(ContentType::APPLICATION_OCTET_STREAM),
        "mobi" => ContentType::parse("application/x-mobipocket-ebook")
            .unwrap_or(ContentType::APPLICATION_OCTET_STREAM),
        _ => ContentType::APPLICATION_OCTET_STREAM,
    };

    // Build email with attachment
    let attachment = Attachment::new(file_name).body(file_content, content_type);

    let body_text = format!(
        "Sent from Ironshelf: {book_title}\n\n\
         This book was sent to your Kindle via Ironshelf's Send-to-Kindle feature."
    );

    let email = Message::builder()
        .from(
            config
                .from_address
                .parse()
                .map_err(|error| format!("Invalid from address: {error}"))?,
        )
        .to(kindle_email
            .parse()
            .map_err(|error| format!("Invalid Kindle email address: {error}"))?)
        .subject(format!("Ironshelf: {book_title}"))
        .multipart(
            MultiPart::mixed()
                .singlepart(SinglePart::plain(body_text))
                .singlepart(attachment),
        )
        .map_err(|error| format!("Failed to build email: {error}"))?;

    // Connect and send via SMTP
    let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)
        .map_err(|error| format!("Failed to create SMTP transport: {error}"))?
        .port(config.smtp_port)
        .credentials(Credentials::new(
            config.smtp_user.clone(),
            config.smtp_password.clone(),
        ))
        .build();

    mailer
        .send(email)
        .await
        .map_err(|error| format!("SMTP send failed: {error}"))?;

    Ok(())
}
