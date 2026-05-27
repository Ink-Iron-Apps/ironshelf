//! Search orchestration — query all indexers, merge/deduplicate results, score matches.

use crate::db::{StoredIndexer, StoredWantedItem};
use super::indexers::search_indexer;
use super::{AcquisitionError, SearchResult};

/// Search all enabled indexers for the given query and optional author.
/// Results are merged, deduplicated by download URL, and sorted by seeders descending.
pub async fn search_all_indexers(
    http_client: &reqwest::Client,
    indexers: &[StoredIndexer],
    query: &str,
    author: Option<&str>,
) -> Vec<SearchResult> {
    let enabled_indexers: Vec<&StoredIndexer> = indexers
        .iter()
        .filter(|indexer| indexer.is_enabled)
        .collect();

    if enabled_indexers.is_empty() {
        tracing::warn!("no enabled indexers configured for search");
        return Vec::new();
    }

    let mut all_results: Vec<SearchResult> = Vec::new();

    for indexer in &enabled_indexers {
        match search_indexer(http_client, indexer, query, author).await {
            Ok(results) => {
                tracing::info!(
                    "indexer '{}' returned {} result(s) for query '{}'",
                    indexer.name,
                    results.len(),
                    query
                );
                all_results.extend(results);
            }
            Err(search_error) => {
                tracing::error!(
                    "indexer '{}' search failed for query '{}': {search_error}",
                    indexer.name,
                    query
                );
            }
        }
    }

    deduplicate_and_sort(&mut all_results);
    all_results
}

/// Score how well a search result matches a wanted item.
/// Returns a confidence value between 0.0 (no match) and 1.0 (perfect match).
pub fn match_wanted_item(wanted_item: &StoredWantedItem, result: &SearchResult) -> f64 {
    let mut score: f64 = 0.0;

    // Title similarity (dominant factor).
    let title_similarity = normalized_similarity(&wanted_item.title, &result.title);
    score += title_similarity * 0.5;

    // Author match (if both present).
    if let (Some(ref wanted_author), Some(ref result_author)) =
        (&wanted_item.author_name, &result.author_guess)
    {
        let author_similarity = normalized_similarity(wanted_author, result_author);
        score += author_similarity * 0.25;
    } else if wanted_item.author_name.is_some() {
        // Wanted has an author but result does not — slight penalty.
        // Check if the author name appears in the result title.
        if let Some(ref wanted_author) = wanted_item.author_name {
            if result
                .title
                .to_lowercase()
                .contains(&wanted_author.to_lowercase())
            {
                score += 0.15;
            }
        }
    }

    // Format preference bonus.
    if let Some(ref preferred_format) = wanted_item.preferred_format {
        let format_lower = preferred_format.to_lowercase();
        if result.title.to_lowercase().contains(&format_lower) {
            score += 0.1;
        }
    }

    // Seeder bonus (more seeders = more likely healthy).
    if let Some(seeders) = result.seeders {
        if seeders > 10 {
            score += 0.05;
        } else if seeders > 0 {
            score += 0.02;
        }
    }

    // Size reasonableness for ebooks (0.1 MB - 500 MB).
    if let Some(size_bytes) = result.size_bytes {
        let size_megabytes = size_bytes as f64 / (1024.0 * 1024.0);
        if (0.1..=500.0).contains(&size_megabytes) {
            score += 0.05;
        } else if size_megabytes > 500.0 {
            // Suspiciously large for a single ebook — likely a collection.
            score -= 0.1;
        }
    }

    // Quality profile matching.
    if let Some(ref quality_profile) = wanted_item.quality_profile {
        match quality_profile.as_str() {
            "epub_only" => {
                let title_lower = result.title.to_lowercase();
                if title_lower.contains("epub") {
                    score += 0.05;
                } else if title_lower.contains("pdf") || title_lower.contains("mobi") {
                    score -= 0.2; // Wrong format.
                }
            }
            "high_quality" => {
                // Prefer results with more seeders and reasonable size.
                if result.seeders.unwrap_or(0) > 5 {
                    score += 0.05;
                }
            }
            _ => {} // "any" — no adjustment.
        }
    }

    score.clamp(0.0, 1.0)
}

/// Automated search for all active wanted items across all indexers.
/// Returns pairs of (wanted_item, best_matching_result) where confidence exceeds
/// the given threshold.
pub async fn auto_search_wanted(
    http_client: &reqwest::Client,
    indexers: &[StoredIndexer],
    wanted_items: &[StoredWantedItem],
    confidence_threshold: f64,
) -> Vec<(StoredWantedItem, SearchResult)> {
    let mut matches: Vec<(StoredWantedItem, SearchResult)> = Vec::new();

    for wanted_item in wanted_items {
        if !wanted_item.is_active || wanted_item.is_fulfilled {
            continue;
        }

        let results = search_all_indexers(
            http_client,
            indexers,
            &wanted_item.title,
            wanted_item.author_name.as_deref(),
        )
        .await;

        // Find the best match above threshold.
        let mut best_result: Option<(f64, &SearchResult)> = None;

        for result in &results {
            let confidence = match_wanted_item(wanted_item, result);
            if confidence >= confidence_threshold {
                if best_result.is_none() || confidence > best_result.unwrap().0 {
                    best_result = Some((confidence, result));
                }
            }
        }

        if let Some((_confidence, result)) = best_result {
            matches.push((wanted_item.clone(), result.clone()));
        }
    }

    matches
}

/// Deduplicate results by download URL and sort by seeders descending.
fn deduplicate_and_sort(results: &mut Vec<SearchResult>) {
    // Remove duplicates by download_url.
    let mut seen_urls: std::collections::HashSet<String> = std::collections::HashSet::new();
    results.retain(|result| seen_urls.insert(result.download_url.clone()));

    // Sort: seeders descending (None treated as 0).
    results.sort_by(|first, second| {
        let first_seeders = first.seeders.unwrap_or(0);
        let second_seeders = second.seeders.unwrap_or(0);
        second_seeders.cmp(&first_seeders)
    });
}

/// Normalized string similarity (case-insensitive).
/// Uses a simple token overlap ratio: |intersection| / max(|a|, |b|).
fn normalized_similarity(first: &str, second: &str) -> f64 {
    let first_tokens: std::collections::HashSet<String> = first
        .to_lowercase()
        .split_whitespace()
        .map(|token| token.trim_matches(|character: char| !character.is_alphanumeric()).to_string())
        .filter(|token| !token.is_empty())
        .collect();

    let second_tokens: std::collections::HashSet<String> = second
        .to_lowercase()
        .split_whitespace()
        .map(|token| token.trim_matches(|character: char| !character.is_alphanumeric()).to_string())
        .filter(|token| !token.is_empty())
        .collect();

    if first_tokens.is_empty() || second_tokens.is_empty() {
        return 0.0;
    }

    let intersection_count = first_tokens.intersection(&second_tokens).count();
    let max_count = first_tokens.len().max(second_tokens.len());

    intersection_count as f64 / max_count as f64
}
