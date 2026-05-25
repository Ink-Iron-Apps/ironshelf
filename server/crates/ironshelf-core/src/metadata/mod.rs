//! Metadata enrichment from external APIs (Google Books, Open Library).
//!
//! When a book lacks description, cover, or tags, providers can search external
//! sources and return ranked matches. The best match (or user-selected match)
//! is applied as an override without mutating the original Calibre/folder data.

use serde::{Deserialize, Serialize};

mod google_books;
mod open_library;

pub use google_books::GoogleBooksProvider;
pub use open_library::OpenLibraryProvider;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/// Metadata fetched from an external provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub isbn: Option<String>,
    pub publisher: Option<String>,
    pub publish_date: Option<String>,
    pub page_count: Option<i32>,
    pub categories: Vec<String>,
}

/// A single search hit from an external provider, scored by confidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataMatch {
    pub provider_name: String,
    pub external_id: String,
    pub confidence: f64,
    pub metadata: BookMetadata,
}

// ---------------------------------------------------------------------------
// Provider trait
// ---------------------------------------------------------------------------

/// Async trait for metadata providers (Google Books, Open Library, etc.).
#[trait_variant::make(Send)]
pub trait MetadataProvider {
    /// Human-readable name of this provider (e.g. "google_books").
    fn name(&self) -> &str;

    /// Search the provider for books matching the given title and/or author.
    /// Returns zero or more matches sorted by descending confidence.
    async fn search(
        &self,
        title: &str,
        author: Option<&str>,
    ) -> Result<Vec<MetadataMatch>, MetadataError>;

    /// Fetch full metadata for a specific external identifier.
    async fn fetch(&self, external_id: &str) -> Result<BookMetadata, MetadataError>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum MetadataError {
    #[error("HTTP request failed: {0}")]
    Http(String),
    #[error("failed to parse provider response: {0}")]
    Parse(String),
    #[error("provider returned no results")]
    NoResults,
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

/// Merge multiple match lists from different providers into a single ranked list.
/// Matches are sorted by descending confidence.
pub fn rank_matches(mut matches: Vec<MetadataMatch>) -> Vec<MetadataMatch> {
    matches.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    matches
}

/// Merge metadata: start with `primary`, fill any `None` / empty fields from `secondary`.
pub fn merge_metadata(primary: &BookMetadata, secondary: &BookMetadata) -> BookMetadata {
    BookMetadata {
        title: primary.title.clone().or_else(|| secondary.title.clone()),
        authors: if primary.authors.is_empty() {
            secondary.authors.clone()
        } else {
            primary.authors.clone()
        },
        description: primary
            .description
            .clone()
            .or_else(|| secondary.description.clone()),
        cover_url: primary
            .cover_url
            .clone()
            .or_else(|| secondary.cover_url.clone()),
        isbn: primary.isbn.clone().or_else(|| secondary.isbn.clone()),
        publisher: primary
            .publisher
            .clone()
            .or_else(|| secondary.publisher.clone()),
        publish_date: primary
            .publish_date
            .clone()
            .or_else(|| secondary.publish_date.clone()),
        page_count: primary.page_count.or(secondary.page_count),
        categories: if primary.categories.is_empty() {
            secondary.categories.clone()
        } else {
            primary.categories.clone()
        },
    }
}

/// Build the best composite metadata from a ranked list of matches.
/// Takes the highest-confidence match as base, then fills gaps from lower matches.
pub fn best_composite(matches: &[MetadataMatch]) -> Option<BookMetadata> {
    let ranked = {
        let mut sorted = matches.to_vec();
        sorted.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        sorted
    };

    let mut composite = ranked.first()?.metadata.clone();
    for candidate in ranked.iter().skip(1) {
        composite = merge_metadata(&composite, &candidate.metadata);
    }
    Some(composite)
}

// ---------------------------------------------------------------------------
// Confidence scoring helper
// ---------------------------------------------------------------------------

/// Compute a simple confidence score (0.0–1.0) based on how closely the result
/// title/author match the query title/author.
pub fn compute_confidence(
    query_title: &str,
    query_author: Option<&str>,
    result_title: &str,
    result_authors: &[String],
) -> f64 {
    let title_score = normalized_similarity(query_title, result_title);

    let author_score = match query_author {
        Some(query_author_name) if !result_authors.is_empty() => result_authors
            .iter()
            .map(|result_author| normalized_similarity(query_author_name, result_author))
            .fold(0.0_f64, f64::max),
        Some(_) => 0.0,
        None => 1.0, // No author constraint, don't penalize.
    };

    // Weight: 60% title, 40% author.
    (title_score * 0.6) + (author_score * 0.4)
}

/// Case-insensitive normalized similarity between two strings.
/// Returns 1.0 for exact match, 0.0 for completely different.
fn normalized_similarity(query: &str, candidate: &str) -> f64 {
    let query_lower = query.to_lowercase();
    let candidate_lower = candidate.to_lowercase();

    if query_lower == candidate_lower {
        return 1.0;
    }

    // Check containment (partial match).
    if candidate_lower.contains(&query_lower) || query_lower.contains(&candidate_lower) {
        let shorter = query_lower.len().min(candidate_lower.len()) as f64;
        let longer = query_lower.len().max(candidate_lower.len()) as f64;
        return shorter / longer;
    }

    // Word overlap ratio.
    let query_words: Vec<&str> = query_lower.split_whitespace().collect();
    let candidate_words: Vec<&str> = candidate_lower.split_whitespace().collect();

    if query_words.is_empty() || candidate_words.is_empty() {
        return 0.0;
    }

    let matching_words = query_words
        .iter()
        .filter(|word| candidate_words.contains(word))
        .count();

    let total_words = query_words.len().max(candidate_words.len()) as f64;
    matching_words as f64 / total_words
}
