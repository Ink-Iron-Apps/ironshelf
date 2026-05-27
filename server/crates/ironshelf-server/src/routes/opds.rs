//! OPDS Catalog Feed routes.
//!
//! Serves Atom/OPDS feeds for ebook readers (KOReader, Moon+ Reader, FBReader).
//! These routes use Bearer auth only (OPDS readers send Authorization header).

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use serde::Deserialize;

use crate::state::AppState;

const OPDS_CONTENT_TYPE: &str = "application/atom+xml;profile=opds-catalog;charset=utf-8";
const OPDS_ACQUISITION_TYPE: &str = "application/atom+xml;profile=opds-catalog;kind=acquisition";
const OPDS_NAVIGATION_TYPE: &str = "application/atom+xml;profile=opds-catalog;kind=navigation";

/// Wrapper to return OPDS XML with correct content-type.
struct OpdsResponse(String);

impl IntoResponse for OpdsResponse {
    fn into_response(self) -> Response {
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, OPDS_CONTENT_TYPE)],
            self.0,
        )
            .into_response()
    }
}

/// XML-escape a string for safe embedding in XML content.
fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Build the Atom feed header.
fn feed_header(title: &str, feed_id: &str, self_href: &str) -> String {
    let updated = Utc::now().to_rfc3339();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:dc="http://purl.org/dc/terms/">
  <id>{feed_id}</id>
  <title>{title}</title>
  <updated>{updated}</updated>
  <link rel="self" href="{self_href}" type="{OPDS_CONTENT_TYPE}"/>
  <link rel="start" href="/opds" type="{OPDS_CONTENT_TYPE}"/>
  <link rel="search" href="/opds/search?q={{searchTerms}}" type="{OPDS_CONTENT_TYPE}"/>
"#,
        feed_id = xml_escape(feed_id),
        title = xml_escape(title),
        self_href = xml_escape(self_href),
        updated = updated,
    )
}

/// Build a navigation entry (links to a sub-feed).
fn navigation_entry(title: &str, entry_id: &str, href: &str, content: &str) -> String {
    let updated = Utc::now().to_rfc3339();
    format!(
        r#"  <entry>
    <title>{title}</title>
    <id>{entry_id}</id>
    <updated>{updated}</updated>
    <content type="text">{content}</content>
    <link rel="subsection" href="{href}" type="{OPDS_NAVIGATION_TYPE}"/>
  </entry>
"#,
        title = xml_escape(title),
        entry_id = xml_escape(entry_id),
        href = xml_escape(href),
        content = xml_escape(content),
        updated = updated,
    )
}

/// Build an acquisition entry for a book.
fn book_entry(
    book_id: i64,
    title: &str,
    description: Option<&str>,
    has_cover: bool,
    formats: &[(String, String)], // (kind, mime_type)
) -> String {
    let updated = Utc::now().to_rfc3339();
    let entry_id = format!("urn:ironshelf:book:{book_id}");

    let mut entry = format!(
        r#"  <entry>
    <title>{title}</title>
    <id>{entry_id}</id>
    <updated>{updated}</updated>
"#,
        title = xml_escape(title),
        entry_id = xml_escape(&entry_id),
        updated = updated,
    );

    if let Some(description_text) = description {
        entry.push_str(&format!(
            "    <content type=\"text\">{}</content>\n",
            xml_escape(description_text)
        ));
    }

    // Cover image link
    if has_cover {
        entry.push_str(&format!(
            "    <link rel=\"http://opds-spec.org/image\" href=\"/api/v1/books/{book_id}/cover\" type=\"image/jpeg\"/>\n"
        ));
        entry.push_str(&format!(
            "    <link rel=\"http://opds-spec.org/image/thumbnail\" href=\"/api/v1/books/{book_id}/cover\" type=\"image/jpeg\"/>\n"
        ));
    }

    // Acquisition links for each format
    for (format_kind, mime_type) in formats {
        entry.push_str(&format!(
            "    <link rel=\"http://opds-spec.org/acquisition\" href=\"/api/v1/books/{book_id}/file?format={format_kind}\" type=\"{mime_type}\"/>\n",
            format_kind = xml_escape(format_kind),
            mime_type = xml_escape(mime_type),
        ));
    }

    entry.push_str("  </entry>\n");
    entry
}

/// Map a format kind string to a MIME type.
fn format_to_mime(format_kind: &str) -> &'static str {
    match format_kind.to_uppercase().as_str() {
        "EPUB" => "application/epub+zip",
        "PDF" => "application/pdf",
        "MOBI" => "application/x-mobipocket-ebook",
        "AZW3" | "AZW" => "application/x-mobi8-ebook",
        "CBZ" => "application/x-cbz",
        "CBR" => "application/x-cbr",
        "FB2" => "application/x-fictionbook+xml",
        "TXT" => "text/plain",
        "RTF" => "application/rtf",
        "DJVU" => "image/vnd.djvu",
        _ => "application/octet-stream",
    }
}

/// GET /opds — Root navigation feed.
pub async fn root_feed() -> impl IntoResponse {
    let mut xml = feed_header("Ironshelf Catalog", "urn:ironshelf:root", "/opds");

    xml.push_str(&navigation_entry(
        "By Author",
        "urn:ironshelf:authors",
        "/opds/authors",
        "Browse books by author",
    ));

    xml.push_str(&navigation_entry(
        "By Series",
        "urn:ironshelf:series",
        "/opds/series",
        "Browse books by series",
    ));

    xml.push_str(&navigation_entry(
        "Recent Additions",
        "urn:ironshelf:recent",
        "/opds/recent",
        "Recently added books",
    ));

    xml.push_str("</feed>\n");
    OpdsResponse(xml)
}

/// GET /opds/series — List all series as navigation entries.
pub async fn series_list_feed(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, StatusCode> {
    let libraries = state.libraries.read().await;
    let mut all_series: Vec<ironshelf_core::model::Series> = Vec::new();

    for library in libraries.iter() {
        // Gather series from all authors in this library
        let authors = library.source.authors().await.unwrap_or_default();
        for author in &authors {
            let series = library
                .source
                .series_by_author(author.id)
                .await
                .unwrap_or_default();
            for series_entry in series {
                if !all_series.iter().any(|s| s.id == series_entry.id) {
                    all_series.push(series_entry);
                }
            }
        }
    }

    all_series.sort_by(|a, b| a.sort_name.cmp(&b.sort_name));

    let mut xml = feed_header("Series", "urn:ironshelf:series", "/opds/series");

    for series in &all_series {
        let href = format!("/opds/series/{}", series.id);
        let content = format!("{} books", series.book_count);
        xml.push_str(&navigation_entry(
            &series.name,
            &format!("urn:ironshelf:series:{}", series.id),
            &href,
            &content,
        ));
    }

    xml.push_str("</feed>\n");
    Ok(OpdsResponse(xml))
}

/// GET /opds/authors — List all authors as navigation entries.
pub async fn authors_feed(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, StatusCode> {
    let libraries = state.libraries.read().await;
    let mut all_authors = Vec::new();

    for library in libraries.iter() {
        let authors = library.source.authors().await.unwrap_or_default();
        for author in authors {
            // Avoid duplicates by id
            if !all_authors.iter().any(|a: &ironshelf_core::model::Author| a.id == author.id) {
                all_authors.push(author);
            }
        }
    }

    all_authors.sort_by(|a, b| a.sort_name.cmp(&b.sort_name));

    let mut xml = feed_header("Authors", "urn:ironshelf:authors", "/opds/authors");

    for author in &all_authors {
        let href = format!("/opds/authors/{}", author.id);
        let content = format!("{} books", author.book_count);
        xml.push_str(&navigation_entry(
            &author.name,
            &format!("urn:ironshelf:author:{}", author.id),
            &href,
            &content,
        ));
    }

    xml.push_str("</feed>\n");
    Ok(OpdsResponse(xml))
}

/// GET /opds/authors/:id — Series by author + standalone books as acquisition entries.
pub async fn author_feed(
    State(state): State<AppState>,
    Path(author_id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    let libraries = state.libraries.read().await;

    let mut author_name = String::from("Unknown Author");
    let mut series_list = Vec::new();
    let mut standalone_books = Vec::new();

    for library in libraries.iter() {
        let authors = library.source.authors().await.unwrap_or_default();
        if let Some(author) = authors.iter().find(|a| a.id == author_id) {
            author_name = author.name.clone();

            let series = library
                .source
                .series_by_author(author_id)
                .await
                .unwrap_or_default();
            series_list.extend(series);

            let standalone = library
                .source
                .standalone_books(author_id)
                .await
                .unwrap_or_default();
            standalone_books.extend(standalone);
            break;
        }
    }

    let feed_title = format!("Books by {}", author_name);
    let self_href = format!("/opds/authors/{}", author_id);
    let mut xml = feed_header(
        &feed_title,
        &format!("urn:ironshelf:author:{}", author_id),
        &self_href,
    );

    // Series as navigation entries
    for series in &series_list {
        let href = format!("/opds/series/{}", series.id);
        let content = format!("{} books in series", series.book_count);
        xml.push_str(&navigation_entry(
            &series.name,
            &format!("urn:ironshelf:series:{}", series.id),
            &href,
            &content,
        ));
    }

    // Standalone books as acquisition entries
    for book in &standalone_books {
        let formats: Vec<(String, String)> = book
            .formats
            .iter()
            .map(|format| (format.kind.clone(), format_to_mime(&format.kind).to_string()))
            .collect();

        xml.push_str(&book_entry(
            book.id,
            &book.title,
            book.description.as_deref(),
            book.has_cover,
            &formats,
        ));
    }

    xml.push_str("</feed>\n");
    Ok(OpdsResponse(xml))
}

/// GET /opds/series/:id — Books in a series as acquisition entries.
pub async fn series_feed(
    State(state): State<AppState>,
    Path(series_id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    let libraries = state.libraries.read().await;

    let mut series_name = String::from("Unknown Series");
    let mut books = Vec::new();

    for library in libraries.iter() {
        if let Ok(Some(series)) = library.source.series(series_id).await {
            series_name = series.name.clone();
            books = library
                .source
                .books_in_series(series_id)
                .await
                .unwrap_or_default();
            break;
        }
    }

    // Sort by series_index
    books.sort_by(|a, b| {
        a.series_index
            .unwrap_or(0.0)
            .partial_cmp(&b.series_index.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let self_href = format!("/opds/series/{}", series_id);
    let mut xml = feed_header(
        &series_name,
        &format!("urn:ironshelf:series:{}", series_id),
        &self_href,
    );

    for book in &books {
        let formats: Vec<(String, String)> = book
            .formats
            .iter()
            .map(|format| (format.kind.clone(), format_to_mime(&format.kind).to_string()))
            .collect();

        // Include series index in the title for clarity
        let display_title = match book.series_index {
            Some(index) => format!("#{} — {}", index, book.title),
            None => book.title.clone(),
        };

        xml.push_str(&book_entry(
            book.id,
            &display_title,
            book.description.as_deref(),
            book.has_cover,
            &formats,
        ));
    }

    xml.push_str("</feed>\n");
    Ok(OpdsResponse(xml))
}

/// GET /opds/recent — Recently added books (last 50).
pub async fn recent_feed(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, StatusCode> {
    let libraries = state.libraries.read().await;
    let mut all_books = Vec::new();

    for library in libraries.iter() {
        let books = library.source.all_books().await.unwrap_or_default();
        all_books.extend(books);
    }

    // Sort by added_at descending (most recent first)
    all_books.sort_by(|a, b| {
        b.added_at
            .unwrap_or_default()
            .cmp(&a.added_at.unwrap_or_default())
    });

    // Take only the 50 most recent
    all_books.truncate(50);

    let mut xml = feed_header("Recent Additions", "urn:ironshelf:recent", "/opds/recent");

    for book in &all_books {
        let formats: Vec<(String, String)> = book
            .formats
            .iter()
            .map(|format| (format.kind.clone(), format_to_mime(&format.kind).to_string()))
            .collect();

        xml.push_str(&book_entry(
            book.id,
            &book.title,
            book.description.as_deref(),
            book.has_cover,
            &formats,
        ));
    }

    xml.push_str("</feed>\n");
    Ok(OpdsResponse(xml))
}

/// Query parameters for OPDS search.
#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
}

/// GET /opds/search?q= — Search books by title.
pub async fn search_feed(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let trimmed_query = query.q.trim();
    if trimmed_query.is_empty() {
        // Return an empty feed for blank queries instead of matching everything.
        let mut xml = feed_header("Search Results", "urn:ironshelf:search:empty", "/opds/search");
        xml.push_str("</feed>\n");
        return Ok(OpdsResponse(xml));
    }

    let search_term = trimmed_query.to_lowercase();
    let libraries = state.libraries.read().await;
    let mut matching_books = Vec::new();

    for library in libraries.iter() {
        let books = library.source.all_books().await.unwrap_or_default();
        for book in books {
            if book.title.to_lowercase().contains(&search_term) {
                matching_books.push(book);
            }
        }
    }

    // Sort by relevance (exact prefix match first, then alphabetical)
    matching_books.sort_by(|a, b| {
        let a_starts = a.title.to_lowercase().starts_with(&search_term);
        let b_starts = b.title.to_lowercase().starts_with(&search_term);
        match (a_starts, b_starts) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.title.cmp(&b.title),
        }
    });

    // Limit results
    matching_books.truncate(100);

    let feed_title = format!("Search: {}", query.q);
    let url_encoded_query = urlencoding::encode(&query.q);
    let self_href = format!("/opds/search?q={}", url_encoded_query);
    let mut xml = feed_header(
        &feed_title,
        &format!("urn:ironshelf:search:{}", xml_escape(&query.q)),
        &self_href,
    );

    for book in &matching_books {
        let formats: Vec<(String, String)> = book
            .formats
            .iter()
            .map(|format| (format.kind.clone(), format_to_mime(&format.kind).to_string()))
            .collect();

        xml.push_str(&book_entry(
            book.id,
            &book.title,
            book.description.as_deref(),
            book.has_cover,
            &formats,
        ));
    }

    xml.push_str("</feed>\n");
    Ok(OpdsResponse(xml))
}
