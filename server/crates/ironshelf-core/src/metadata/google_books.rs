//! Google Books API provider.
//!
//! Uses the public Google Books API v1 (no API key required for basic search).
//! Endpoint: `https://www.googleapis.com/books/v1/volumes`

use reqwest::Client;
use serde::Deserialize;

use super::{BookMetadata, MetadataError, MetadataMatch, MetadataProvider, compute_confidence};

/// Google Books metadata provider.
pub struct GoogleBooksProvider {
    http_client: Client,
}

impl GoogleBooksProvider {
    // TODO(security): This expect() will panic if TLS backend init fails at runtime.
    // Consider making this fallible (return Result) and constructing once at startup
    // rather than per-request in route handlers.
    pub fn new() -> Self {
        Self {
            http_client: Client::builder()
                .user_agent("ironshelf-server/0.1")
                .build()
                .expect("failed to build reqwest client"),
        }
    }
}

impl MetadataProvider for GoogleBooksProvider {
    fn name(&self) -> &str {
        "google_books"
    }

    async fn search(
        &self,
        title: &str,
        author: Option<&str>,
    ) -> Result<Vec<MetadataMatch>, MetadataError> {
        let mut query_parts = vec![format!("intitle:{}", title)];
        if let Some(author_name) = author {
            query_parts.push(format!("inauthor:{}", author_name));
        }
        let query_string = query_parts.join("+");

        let url = format!(
            "https://www.googleapis.com/books/v1/volumes?q={}&maxResults=5",
            urlencoding::encode(&query_string)
        );

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|error| MetadataError::Http(error.to_string()))?;

        let body = response
            .text()
            .await
            .map_err(|error| MetadataError::Http(error.to_string()))?;

        let search_response: GoogleBooksSearchResponse =
            serde_json::from_str(&body).map_err(|error| MetadataError::Parse(error.to_string()))?;

        let items = search_response.items.unwrap_or_default();
        if items.is_empty() {
            return Ok(vec![]);
        }

        let matches = items
            .into_iter()
            .filter_map(|item| {
                let volume_info = item.volume_info?;
                let result_title = volume_info.title.clone().unwrap_or_default();
                let result_authors = volume_info.authors.clone().unwrap_or_default();

                let confidence =
                    compute_confidence(title, author, &result_title, &result_authors);

                let cover_url = volume_info
                    .image_links
                    .and_then(|links| links.thumbnail.or(links.small_thumbnail))
                    // Google returns HTTP URLs; upgrade to HTTPS.
                    .map(|url| url.replace("http://", "https://"));

                let isbn = volume_info
                    .industry_identifiers
                    .and_then(|identifiers| {
                        identifiers
                            .iter()
                            .find(|identifier| identifier.identifier_type == "ISBN_13")
                            .or_else(|| {
                                identifiers
                                    .iter()
                                    .find(|identifier| identifier.identifier_type == "ISBN_10")
                            })
                            .map(|identifier| identifier.identifier.clone())
                    });

                Some(MetadataMatch {
                    provider_name: "google_books".to_string(),
                    external_id: item.id?,
                    confidence,
                    metadata: BookMetadata {
                        title: volume_info.title,
                        authors: result_authors,
                        description: volume_info.description,
                        cover_url,
                        isbn,
                        publisher: volume_info.publisher,
                        publish_date: volume_info.published_date,
                        page_count: volume_info.page_count,
                        categories: volume_info.categories.unwrap_or_default(),
                    },
                })
            })
            .collect();

        Ok(matches)
    }

    async fn fetch(&self, external_id: &str) -> Result<BookMetadata, MetadataError> {
        let url = format!(
            "https://www.googleapis.com/books/v1/volumes/{}",
            urlencoding::encode(external_id)
        );

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .map_err(|error| MetadataError::Http(error.to_string()))?;

        let body = response
            .text()
            .await
            .map_err(|error| MetadataError::Http(error.to_string()))?;

        let item: GoogleBooksItem =
            serde_json::from_str(&body).map_err(|error| MetadataError::Parse(error.to_string()))?;

        let volume_info = item
            .volume_info
            .ok_or_else(|| MetadataError::Parse("missing volumeInfo".to_string()))?;

        let cover_url = volume_info
            .image_links
            .and_then(|links| links.thumbnail.or(links.small_thumbnail))
            .map(|url| url.replace("http://", "https://"));

        let isbn = volume_info.industry_identifiers.and_then(|identifiers| {
            identifiers
                .iter()
                .find(|identifier| identifier.identifier_type == "ISBN_13")
                .or_else(|| {
                    identifiers
                        .iter()
                        .find(|identifier| identifier.identifier_type == "ISBN_10")
                })
                .map(|identifier| identifier.identifier.clone())
        });

        Ok(BookMetadata {
            title: volume_info.title,
            authors: volume_info.authors.unwrap_or_default(),
            description: volume_info.description,
            cover_url,
            isbn,
            publisher: volume_info.publisher,
            publish_date: volume_info.published_date,
            page_count: volume_info.page_count,
            categories: volume_info.categories.unwrap_or_default(),
        })
    }
}

// ---------------------------------------------------------------------------
// Google Books API response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GoogleBooksSearchResponse {
    items: Option<Vec<GoogleBooksItem>>,
}

#[derive(Deserialize)]
struct GoogleBooksItem {
    id: Option<String>,
    #[serde(rename = "volumeInfo")]
    volume_info: Option<GoogleBooksVolumeInfo>,
}

#[derive(Deserialize)]
struct GoogleBooksVolumeInfo {
    title: Option<String>,
    authors: Option<Vec<String>>,
    description: Option<String>,
    publisher: Option<String>,
    #[serde(rename = "publishedDate")]
    published_date: Option<String>,
    #[serde(rename = "pageCount")]
    page_count: Option<i32>,
    categories: Option<Vec<String>>,
    #[serde(rename = "imageLinks")]
    image_links: Option<GoogleBooksImageLinks>,
    #[serde(rename = "industryIdentifiers")]
    industry_identifiers: Option<Vec<GoogleBooksIdentifier>>,
}

#[derive(Deserialize)]
struct GoogleBooksImageLinks {
    thumbnail: Option<String>,
    #[serde(rename = "smallThumbnail")]
    small_thumbnail: Option<String>,
}

#[derive(Deserialize)]
struct GoogleBooksIdentifier {
    #[serde(rename = "type")]
    identifier_type: String,
    identifier: String,
}
