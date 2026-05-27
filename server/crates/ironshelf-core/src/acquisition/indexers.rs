//! Torznab / Newznab / RSS indexer clients.
//!
//! Torznab is the standard protocol spoken by Prowlarr, Jackett, and most
//! book indexers. It returns RSS/XML with torznab namespace attributes for
//! seeders, size, download URL, etc.

use crate::db::StoredIndexer;
use super::{AcquisitionError, SearchResult};
use quick_xml::events::Event;
use quick_xml::Reader;

/// Search an indexer for books matching the given query and optional author.
///
/// For Torznab/Newznab indexers, sends:
///   GET {url}/api?apikey={key}&t=book&q={query}&author={author}
///
/// For RSS indexers, fetches the feed URL and filters entries by title match.
pub async fn search_indexer(
    http_client: &reqwest::Client,
    indexer: &StoredIndexer,
    query: &str,
    author: Option<&str>,
) -> Result<Vec<SearchResult>, AcquisitionError> {
    match indexer.indexer_type.as_str() {
        "torznab" | "newznab" => search_torznab(http_client, indexer, query, author).await,
        "rss" => search_rss(http_client, indexer, query).await,
        other => Err(AcquisitionError::ClientError(format!(
            "unsupported indexer type: {other}"
        ))),
    }
}

/// Search a Torznab-compatible indexer.
async fn search_torznab(
    http_client: &reqwest::Client,
    indexer: &StoredIndexer,
    query: &str,
    author: Option<&str>,
) -> Result<Vec<SearchResult>, AcquisitionError> {
    let base_url = indexer.url.trim_end_matches('/');

    let mut request_url = format!(
        "{base_url}/api?t=book&q={}",
        urlencoding::encode(query)
    );

    if let Some(api_key) = &indexer.api_key {
        request_url.push_str(&format!("&apikey={api_key}"));
    }

    if let Some(author_name) = author {
        request_url.push_str(&format!("&author={}", urlencoding::encode(author_name)));
    }

    if let Some(ref categories) = indexer.categories {
        if !categories.is_empty() {
            request_url.push_str(&format!("&cat={categories}"));
        }
    }

    let response = http_client
        .get(&request_url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await?;

    let response_body = response.text().await?;

    parse_torznab_response(&response_body, &indexer.name)
}

/// Search an RSS feed by fetching all entries and filtering by title.
async fn search_rss(
    http_client: &reqwest::Client,
    indexer: &StoredIndexer,
    query: &str,
) -> Result<Vec<SearchResult>, AcquisitionError> {
    let response = http_client
        .get(&indexer.url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await?;

    let response_body = response.text().await?;

    let all_results = parse_torznab_response(&response_body, &indexer.name)?;

    // Filter by title containing query (case-insensitive).
    let query_lower = query.to_lowercase();
    let filtered_results: Vec<SearchResult> = all_results
        .into_iter()
        .filter(|result| result.title.to_lowercase().contains(&query_lower))
        .collect();

    Ok(filtered_results)
}

/// Parse a Torznab/RSS XML response into SearchResult entries.
///
/// Torznab feeds are standard RSS 2.0 with additional `<torznab:attr>` elements
/// inside each `<item>`. We extract:
/// - `<title>` — result title
/// - `<link>` or `<enclosure url="">` — download URL
/// - `<pubDate>` — publication date
/// - `<torznab:attr name="seeders" value="...">` — seeders count
/// - `<torznab:attr name="leechers" value="...">` — leechers count
/// - `<torznab:attr name="size" value="...">` — size in bytes
/// - `<torznab:attr name="magneturl" value="...">` — magnet link
/// - `<torznab:attr name="infohash" value="...">` — torrent info hash
/// - `<category>` — category string
fn parse_torznab_response(
    xml_body: &str,
    indexer_name: &str,
) -> Result<Vec<SearchResult>, AcquisitionError> {
    let mut reader = Reader::from_str(xml_body);
    reader.config_mut().trim_text(true);

    let mut results: Vec<SearchResult> = Vec::new();

    // Parsing state for current <item>.
    let mut inside_item = false;
    let mut current_title = String::new();
    let mut current_link = String::new();
    let mut current_published_at: Option<String> = None;
    let mut current_category: Option<String> = None;
    let mut current_seeders: Option<i32> = None;
    let mut current_leechers: Option<i32> = None;
    let mut current_size_bytes: Option<i64> = None;
    let mut current_magnet_url: Option<String> = None;
    let mut current_info_hash: Option<String> = None;
    let mut current_tag: String = String::new();

    let mut text_buffer = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref event)) => {
                let tag_name = String::from_utf8_lossy(event.name().as_ref()).to_string();

                if tag_name == "item" {
                    inside_item = true;
                    current_title.clear();
                    current_link.clear();
                    current_published_at = None;
                    current_category = None;
                    current_seeders = None;
                    current_leechers = None;
                    current_size_bytes = None;
                    current_magnet_url = None;
                    current_info_hash = None;
                }

                if inside_item {
                    current_tag = tag_name;
                    text_buffer.clear();
                }
            }
            Ok(Event::Empty(ref event)) => {
                if !inside_item {
                    continue;
                }

                let tag_name = String::from_utf8_lossy(event.name().as_ref()).to_string();

                // Handle <enclosure url="..." length="..." />
                if tag_name == "enclosure" {
                    for attribute in event.attributes().flatten() {
                        let attribute_key =
                            String::from_utf8_lossy(attribute.key.as_ref()).to_string();
                        let attribute_value =
                            String::from_utf8_lossy(&attribute.value).to_string();

                        if attribute_key == "url" && current_link.is_empty() {
                            current_link = attribute_value;
                        } else if attribute_key == "length" && current_size_bytes.is_none() {
                            current_size_bytes = attribute_value.parse().ok();
                        }
                    }
                }

                // Handle <torznab:attr name="..." value="..." /> and
                // <newznab:attr name="..." value="..." />
                if tag_name.ends_with(":attr")
                    || tag_name == "torznab:attr"
                    || tag_name == "newznab:attr"
                {
                    let mut attribute_name = String::new();
                    let mut attribute_value = String::new();

                    for attribute in event.attributes().flatten() {
                        let key =
                            String::from_utf8_lossy(attribute.key.as_ref()).to_string();
                        let value =
                            String::from_utf8_lossy(&attribute.value).to_string();

                        if key == "name" {
                            attribute_name = value;
                        } else if key == "value" {
                            attribute_value = value;
                        }
                    }

                    match attribute_name.as_str() {
                        "seeders" => {
                            current_seeders = attribute_value.parse().ok();
                        }
                        "leechers" | "peers" => {
                            current_leechers = attribute_value.parse().ok();
                        }
                        "size" => {
                            current_size_bytes = attribute_value.parse().ok();
                        }
                        "magneturl" => {
                            current_magnet_url = Some(attribute_value);
                        }
                        "infohash" => {
                            current_info_hash = Some(attribute_value);
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::Text(ref event)) if inside_item => {
                text_buffer.push_str(&event.unescape().unwrap_or_default());
            }
            Ok(Event::Text(_)) => {}

            Ok(Event::End(ref event)) => {
                let tag_name = String::from_utf8_lossy(event.name().as_ref()).to_string();

                if tag_name == "item" && inside_item {
                    // Finished parsing one item — emit result if we have a title and URL.
                    if !current_title.is_empty() && !current_link.is_empty() {
                        results.push(SearchResult {
                            title: current_title.clone(),
                            author_guess: guess_author_from_title(&current_title),
                            size_bytes: current_size_bytes,
                            download_url: current_link.clone(),
                            magnet_url: current_magnet_url.clone(),
                            info_hash: current_info_hash.clone(),
                            seeders: current_seeders,
                            leechers: current_leechers,
                            category: current_category.clone(),
                            indexer_name: indexer_name.to_string(),
                            published_at: current_published_at.clone(),
                        });
                    }
                    inside_item = false;
                } else if inside_item {
                    match current_tag.as_str() {
                        "title" => current_title = text_buffer.clone(),
                        "link" if current_link.is_empty() => {
                            current_link = text_buffer.clone();
                        }
                        "pubDate" => current_published_at = Some(text_buffer.clone()),
                        "category" => current_category = Some(text_buffer.clone()),
                        _ => {}
                    }
                    text_buffer.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(parse_error) => {
                return Err(AcquisitionError::XmlParse(format!(
                    "failed to parse Torznab XML: {parse_error}"
                )));
            }
            _ => {}
        }
    }

    Ok(results)
}

/// Attempt to guess the author name from a torrent title.
///
/// Many book torrents follow patterns like:
/// - "Author Name - Book Title (EPUB)"
/// - "Author Name - Series Name #1 - Book Title"
/// - "Book Title by Author Name"
fn guess_author_from_title(title: &str) -> Option<String> {
    // Pattern: "Author - Title"
    if let Some(dash_position) = title.find(" - ") {
        let candidate = title[..dash_position].trim();
        // Only accept if it looks like a name (contains space, not too long).
        if candidate.contains(' ') && candidate.len() < 60 {
            return Some(candidate.to_string());
        }
    }

    // Pattern: "Title by Author"
    if let Some(by_position) = title.to_lowercase().find(" by ") {
        let after_by = &title[by_position + 4..];
        // Take up to the next delimiter or end.
        let author_candidate = after_by
            .split(&['-', '(', '[', ','][..])
            .next()
            .unwrap_or(after_by)
            .trim();

        if !author_candidate.is_empty() && author_candidate.len() < 60 {
            return Some(author_candidate.to_string());
        }
    }

    None
}

/// Test connectivity of an indexer by performing a minimal search.
/// Returns Ok(()) if the indexer responds with valid XML, or an error description.
pub async fn test_indexer_connection(
    http_client: &reqwest::Client,
    indexer: &StoredIndexer,
) -> Result<(), AcquisitionError> {
    let results = search_indexer(http_client, indexer, "test", None).await?;
    tracing::info!(
        "indexer '{}' test returned {} result(s)",
        indexer.name,
        results.len()
    );
    Ok(())
}
