//! Open Library API provider.
//!
//! Uses the public Open Library Search API (no key required).
//! Endpoint: `https://openlibrary.org/search.json`

use reqwest::Client;
use serde::Deserialize;

use super::{BookMetadata, MetadataError, MetadataMatch, MetadataProvider, compute_confidence};

/// Open Library metadata provider.
pub struct OpenLibraryProvider {
    http_client: Client,
}

impl OpenLibraryProvider {
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

impl MetadataProvider for OpenLibraryProvider {
    fn name(&self) -> &str {
        "open_library"
    }

    async fn search(
        &self,
        title: &str,
        author: Option<&str>,
    ) -> Result<Vec<MetadataMatch>, MetadataError> {
        let mut url = format!(
            "https://openlibrary.org/search.json?title={}&limit=5",
            urlencoding::encode(title)
        );
        if let Some(author_name) = author {
            url.push_str(&format!("&author={}", urlencoding::encode(author_name)));
        }

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

        let search_response: OpenLibrarySearchResponse =
            serde_json::from_str(&body).map_err(|error| MetadataError::Parse(error.to_string()))?;

        if search_response.docs.is_empty() {
            return Ok(vec![]);
        }

        let matches = search_response
            .docs
            .into_iter()
            .filter_map(|document| {
                let result_title = document.title.clone()?;
                let result_authors = document.author_name.clone().unwrap_or_default();

                let confidence =
                    compute_confidence(title, author, &result_title, &result_authors);

                let cover_url = document
                    .cover_i
                    .map(|cover_id| format!("https://covers.openlibrary.org/b/id/{}-L.jpg", cover_id));

                let isbn = document
                    .isbn
                    .as_ref()
                    .and_then(|isbn_list| {
                        // Prefer ISBN-13 (13 digits) over ISBN-10 (10 digits).
                        isbn_list
                            .iter()
                            .find(|isbn_value| isbn_value.len() == 13)
                            .or_else(|| isbn_list.first())
                            .cloned()
                    });

                let external_id = document.key.clone()?;

                Some(MetadataMatch {
                    provider_name: "open_library".to_string(),
                    external_id,
                    confidence,
                    metadata: BookMetadata {
                        title: Some(result_title),
                        authors: result_authors,
                        description: None, // Search API doesn't return descriptions.
                        cover_url,
                        isbn,
                        publisher: document
                            .publisher
                            .as_ref()
                            .and_then(|publishers| publishers.first().cloned()),
                        publish_date: document.first_publish_year.map(|year| year.to_string()),
                        page_count: document.number_of_pages_median,
                        categories: document.subject.unwrap_or_default(),
                    },
                })
            })
            .collect();

        Ok(matches)
    }

    async fn fetch(&self, external_id: &str) -> Result<BookMetadata, MetadataError> {
        // Open Library works endpoint: /works/OL12345W.json
        let url = format!("https://openlibrary.org{}.json", external_id);

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

        let work: OpenLibraryWork =
            serde_json::from_str(&body).map_err(|error| MetadataError::Parse(error.to_string()))?;

        let description = match work.description {
            Some(OpenLibraryDescription::Text(text)) => Some(text),
            Some(OpenLibraryDescription::Object { value }) => Some(value),
            None => None,
        };

        let cover_url = work
            .covers
            .as_ref()
            .and_then(|covers| covers.first())
            .map(|cover_id| format!("https://covers.openlibrary.org/b/id/{}-L.jpg", cover_id));

        Ok(BookMetadata {
            title: Some(work.title),
            authors: vec![], // Work endpoint doesn't inline authors; caller merges from search.
            description,
            cover_url,
            isbn: None,
            publisher: None,
            publish_date: None,
            page_count: None,
            categories: work.subjects.unwrap_or_default(),
        })
    }
}

// ---------------------------------------------------------------------------
// Open Library API response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct OpenLibrarySearchResponse {
    #[serde(default)]
    docs: Vec<OpenLibraryDocument>,
}

#[derive(Deserialize)]
struct OpenLibraryDocument {
    key: Option<String>,
    title: Option<String>,
    author_name: Option<Vec<String>>,
    cover_i: Option<i64>,
    isbn: Option<Vec<String>>,
    publisher: Option<Vec<String>>,
    first_publish_year: Option<i32>,
    number_of_pages_median: Option<i32>,
    subject: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct OpenLibraryWork {
    title: String,
    description: Option<OpenLibraryDescription>,
    covers: Option<Vec<i64>>,
    subjects: Option<Vec<String>>,
}

/// Open Library description can be a plain string or `{ "type": ..., "value": "..." }`.
#[derive(Deserialize)]
#[serde(untagged)]
enum OpenLibraryDescription {
    Text(String),
    Object { value: String },
}
