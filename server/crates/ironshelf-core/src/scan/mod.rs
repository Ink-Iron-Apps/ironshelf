//! Folder scanner + embedded EPUB OPF parser for non-Calibre libraries.
//! Walks directories, reads epub metadata (dc:creator, calibre:series, etc).

use crate::model::{Author, Book, Format, Series};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;
use tokio::fs;
use tracing;

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("path not found: {0}")]
    PathNotFound(String),
}

/// Scanned book metadata from an epub OPF.
#[derive(Debug, Clone)]
struct ScannedBook {
    rel_path: String,
    title: String,
    authors: Vec<String>,
    series_name: Option<String>,
    series_index: Option<f64>,
    tags: Vec<String>,
    language: Option<String>,
    description: Option<String>,
    file_size: u64,
    format: String,
}

/// A non-Calibre library source that scans directories for ebook files.
#[derive(Clone)]
pub struct FolderSource {
    library_path: PathBuf,
    /// Cached scan results. Re-populated on scan().
    books: Vec<ScannedBook>,
}

impl FolderSource {
    /// Open a folder-based library. Scans immediately.
    pub async fn open(library_path: impl AsRef<Path>) -> Result<Self, ScanError> {
        let library_path = library_path.as_ref().to_path_buf();
        if !library_path.exists() {
            return Err(ScanError::PathNotFound(library_path.display().to_string()));
        }

        let mut source = Self {
            library_path,
            books: Vec::new(),
        };
        source.scan().await?;
        Ok(source)
    }

    /// Rescan the directory tree.
    pub async fn scan(&mut self) -> Result<(), ScanError> {
        let mut books = Vec::new();
        self.walk_directory(&self.library_path.clone(), &mut books).await?;
        tracing::info!("folder scan complete: {} books found", books.len());
        self.books = books;
        Ok(())
    }

    /// Walk directory recursively, collecting ebook files.
    fn walk_directory<'a>(
        &'a self,
        dir: &'a Path,
        books: &'a mut Vec<ScannedBook>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), ScanError>> + Send + 'a>> {
        Box::pin(async move {
            let mut entries = fs::read_dir(dir).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if path.is_dir() {
                    self.walk_directory(&path, books).await?;
                } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let format = ext.to_uppercase();
                    match format.as_str() {
                        "EPUB" | "PDF" | "CBZ" | "MOBI" => {
                            let metadata = entry.metadata().await?;
                            let rel_path = path
                                .strip_prefix(&self.library_path)
                                .unwrap_or(&path)
                                .to_string_lossy()
                                .to_string();

                            let scanned = if format == "EPUB" {
                                self.parse_epub_metadata(&path, &rel_path, metadata.len()).await
                            } else {
                                // Non-epub: derive from filename/path
                                self.metadata_from_path(&path, &rel_path, &format, metadata.len())
                            };

                            books.push(scanned);
                        }
                        _ => {}
                    }
                }
            }
            Ok(())
        })
    }

    /// Parse epub OPF metadata.
    async fn parse_epub_metadata(
        &self,
        path: &Path,
        rel_path: &str,
        file_size: u64,
    ) -> ScannedBook {
        // Read epub as zip, extract container.xml → find OPF → parse DC metadata
        match Self::read_epub_opf(path).await {
            Ok(opf) => opf_to_scanned_book(opf, rel_path, file_size),
            Err(_) => {
                // Fallback to path-based metadata
                self.metadata_from_path(path, rel_path, "EPUB", file_size)
            }
        }
    }

    /// Read OPF content from an epub zip file.
    async fn read_epub_opf(path: &Path) -> Result<String, ScanError> {
        use std::io::Read;

        let path = path.to_path_buf();
        tokio::task::spawn_blocking(move || {
            let file = std::fs::File::open(&path)?;
            let mut archive = zip::ZipArchive::new(file)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

            // Find OPF path from META-INF/container.xml
            let opf_path = {
                let mut container = archive
                    .by_name("META-INF/container.xml")
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
                let mut content = String::new();
                container.read_to_string(&mut content)?;
                extract_opf_path(&content).unwrap_or_else(|| "content.opf".to_string())
            };

            // Read OPF
            let mut opf_file = archive
                .by_name(&opf_path)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
            let mut opf_content = String::new();
            opf_file.read_to_string(&mut opf_content)?;
            Ok(opf_content)
        })
        .await
        .map_err(|e| ScanError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
    }

    /// Derive metadata from file path when epub parsing unavailable.
    fn metadata_from_path(
        &self,
        path: &Path,
        rel_path: &str,
        format: &str,
        file_size: u64,
    ) -> ScannedBook {
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();

        // Try "Author - Title" or "Title" pattern
        let (authors, title) = if let Some((author, title)) = stem.split_once(" - ") {
            (vec![author.trim().to_string()], title.trim().to_string())
        } else {
            // Try parent dir as author
            let author = path
                .parent()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string());
            (vec![author], stem.to_string())
        };

        ScannedBook {
            rel_path: rel_path.to_string(),
            title,
            authors,
            series_name: None,
            series_index: None,
            tags: Vec::new(),
            language: None,
            description: None,
            file_size,
            format: format.to_string(),
        }
    }

    // --- Public query methods (same interface as CalibreSource) ---

    pub fn authors(&self) -> Vec<Author> {
        let mut author_map: HashMap<String, (i64, Vec<i64>)> = HashMap::new();
        let mut author_id_counter: i64 = 1;

        for (book_idx, book) in self.books.iter().enumerate() {
            for author_name in &book.authors {
                let entry = author_map
                    .entry(author_name.clone())
                    .or_insert_with(|| {
                        let id = author_id_counter;
                        author_id_counter += 1;
                        (id, Vec::new())
                    });
                entry.1.push(book_idx as i64);
            }
        }

        let mut authors: Vec<Author> = author_map
            .into_iter()
            .map(|(name, (id, book_indices))| {
                let series_count = book_indices
                    .iter()
                    .filter_map(|&idx| self.books.get(idx as usize)?.series_name.as_ref())
                    .collect::<std::collections::HashSet<_>>()
                    .len() as i64;

                Author {
                    id,
                    name: name.clone(),
                    sort_name: sort_name(&name),
                    book_count: book_indices.len() as i64,
                    series_count,
                }
            })
            .collect();

        authors.sort_by(|a, b| a.sort_name.cmp(&b.sort_name));
        authors
    }

    pub fn series_by_author(&self, author_id: i64) -> Vec<Series> {
        let authors = self.authors();
        let author = match authors.iter().find(|a| a.id == author_id) {
            Some(a) => a,
            None => return Vec::new(),
        };

        let mut series_map: HashMap<String, (i64, i64)> = HashMap::new();
        let mut series_id_counter: i64 = 1;

        for book in &self.books {
            if !book.authors.contains(&author.name) {
                continue;
            }
            if let Some(ref series_name) = book.series_name {
                let entry = series_map
                    .entry(series_name.clone())
                    .or_insert_with(|| {
                        let id = series_id_counter;
                        series_id_counter += 1;
                        (id, 0)
                    });
                entry.1 += 1;
            }
        }

        let mut series: Vec<Series> = series_map
            .into_iter()
            .map(|(name, (id, book_count))| Series {
                id,
                name: name.clone(),
                sort_name: name,
                book_count,
            })
            .collect();

        series.sort_by(|a, b| a.sort_name.cmp(&b.sort_name));
        series
    }

    pub fn books_in_series(&self, series_name: &str) -> Vec<Book> {
        let mut books: Vec<Book> = self
            .books
            .iter()
            .enumerate()
            .filter(|(_, b)| b.series_name.as_deref() == Some(series_name))
            .map(|(idx, b)| self.scanned_to_book(b, idx as i64))
            .collect();

        books.sort_by(|a, b| {
            a.series_index
                .partial_cmp(&b.series_index)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        books
    }

    pub fn standalone_books(&self, author_name: &str) -> Vec<Book> {
        self.books
            .iter()
            .enumerate()
            .filter(|(_, b)| b.authors.contains(&author_name.to_string()) && b.series_name.is_none())
            .map(|(idx, b)| self.scanned_to_book(b, idx as i64))
            .collect()
    }

    /// All unique genres/tags across scanned books with book counts.
    pub fn genres(&self) -> Vec<(String, i64)> {
        let mut genre_counts: HashMap<String, i64> = HashMap::new();
        for book in &self.books {
            for tag in &book.tags {
                *genre_counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
        let mut genres: Vec<(String, i64)> = genre_counts.into_iter().collect();
        genres.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
        genres
    }

    /// Books that have a specific tag/genre (case-insensitive match).
    pub fn books_by_genre(&self, genre_name: &str) -> Vec<Book> {
        let genre_lower = genre_name.to_lowercase();
        self.books
            .iter()
            .enumerate()
            .filter(|(_, b)| b.tags.iter().any(|tag| tag.to_lowercase() == genre_lower))
            .map(|(idx, b)| self.scanned_to_book(b, idx as i64))
            .collect()
    }

    pub fn all_books(&self) -> Vec<Book> {
        self.books
            .iter()
            .enumerate()
            .map(|(idx, b)| self.scanned_to_book(b, idx as i64))
            .collect()
    }

    pub fn book(&self, book_id: i64) -> Option<Book> {
        // SAFETY: Reject negative IDs — `as usize` on a negative i64 wraps to a huge value.
        let index: usize = book_id.try_into().ok()?;
        self.books
            .get(index)
            .map(|b| self.scanned_to_book(b, book_id))
    }

    pub fn cover_path(&self, _book_path: &str) -> Option<PathBuf> {
        // Folder source: cover is embedded in epub (not a separate file)
        None
    }

    pub fn format_path(&self, rel_path: &str) -> PathBuf {
        self.library_path.join(rel_path)
    }

    fn scanned_to_book(&self, scanned: &ScannedBook, index: i64) -> Book {
        Book {
            id: index,
            title: scanned.title.clone(),
            sort_title: scanned.title.clone(),
            author_ids: vec![], // Resolved by caller if needed
            series_id: None,    // FolderSource uses name-based series
            series_index: scanned.series_index,
            formats: vec![Format {
                kind: scanned.format.clone(),
                file_name: scanned.rel_path.clone(),
                size: Some(scanned.file_size),
            }],
            has_cover: false,
            path: scanned.rel_path.clone(),
            pubdate: None,
            added_at: None,
            rating: None,
            tags: scanned.tags.clone(),
            languages: scanned
                .language
                .as_ref()
                .map(|l| vec![l.clone()])
                .unwrap_or_default(),
            identifiers: HashMap::new(),
            description: scanned.description.clone(),
            custom: HashMap::new(),
        }
    }
}

// --- OPF parsing helpers ---

/// Extract rootfile path from container.xml.
fn extract_opf_path(container_xml: &str) -> Option<String> {
    // Simple XML extraction: find full-path attribute in rootfile element
    container_xml
        .find("full-path=\"")
        .map(|start| {
            let after = &container_xml[start + 11..];
            let end = after.find('"').unwrap_or(after.len());
            after[..end].to_string()
        })
}

/// Parse OPF XML into a ScannedBook.
fn opf_to_scanned_book(opf: String, rel_path: &str, file_size: u64) -> ScannedBook {
    let title = extract_dc_element(&opf, "title").unwrap_or_else(|| "Unknown".to_string());
    let authors = extract_dc_elements(&opf, "creator");
    let description = extract_dc_element(&opf, "description");
    let language = extract_dc_element(&opf, "language");
    let tags = extract_dc_elements(&opf, "subject");

    // Calibre series metadata (stored as <meta name="calibre:series" content="...">)
    let series_name = extract_meta(&opf, "calibre:series");
    let series_index = extract_meta(&opf, "calibre:series_index")
        .and_then(|s| s.parse::<f64>().ok());

    ScannedBook {
        rel_path: rel_path.to_string(),
        title,
        authors: if authors.is_empty() {
            vec!["Unknown".to_string()]
        } else {
            authors
        },
        series_name,
        series_index,
        tags,
        language,
        description,
        file_size,
        format: "EPUB".to_string(),
    }
}

/// Extract a single dc: element value.
fn extract_dc_element(opf: &str, element: &str) -> Option<String> {
    let patterns = [
        format!("<dc:{element}>"),
        format!("<dc:{element} "),
    ];

    for pattern in &patterns {
        if let Some(start) = opf.find(pattern.as_str()) {
            let after_tag = &opf[start..];
            let content_start = after_tag.find('>').map(|i| i + 1)?;
            let close_tag = format!("</dc:{element}>");
            let content_end = after_tag[content_start..].find(&close_tag)?;
            let value = after_tag[content_start..content_start + content_end].trim();
            if !value.is_empty() {
                return Some(html_decode(value));
            }
        }
    }
    None
}

/// Extract all dc: elements with same name.
fn extract_dc_elements(opf: &str, element: &str) -> Vec<String> {
    let mut results = Vec::new();
    let mut search_from = 0;

    let open_patterns = [
        format!("<dc:{element}>"),
        format!("<dc:{element} "),
    ];
    let close_tag = format!("</dc:{element}>");

    loop {
        let found = open_patterns.iter().filter_map(|pattern| {
            opf[search_from..].find(pattern.as_str()).map(|pos| search_from + pos)
        }).min();

        match found {
            Some(start) => {
                let after_tag = &opf[start..];
                if let Some(content_start) = after_tag.find('>').map(|i| i + 1) {
                    if let Some(content_end) = after_tag[content_start..].find(&close_tag) {
                        let value = after_tag[content_start..content_start + content_end].trim();
                        if !value.is_empty() {
                            results.push(html_decode(value));
                        }
                        search_from = start + content_start + content_end + close_tag.len();
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            None => break,
        }
    }

    results
}

/// Extract <meta name="..." content="..."> value.
fn extract_meta(opf: &str, name: &str) -> Option<String> {
    let pattern = format!("name=\"{name}\"");
    let pos = opf.find(&pattern)?;

    // Find content attribute near this meta element
    let region_start = opf[..pos].rfind('<').unwrap_or(0);
    let region_end = opf[pos..].find("/>").or_else(|| opf[pos..].find('>'))
        .map(|i| pos + i + 2)?;
    let region = &opf[region_start..region_end];

    let content_pos = region.find("content=\"")?;
    let after_content = &region[content_pos + 9..];
    let end = after_content.find('"')?;
    let value = &after_content[..end];
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// Basic HTML entity decode.
fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

/// Generate sort name (last name first for "First Last" patterns).
fn sort_name(name: &str) -> String {
    let parts: Vec<&str> = name.trim().split_whitespace().collect();
    if parts.len() >= 2 {
        format!("{}, {}", parts.last().unwrap(), parts[..parts.len() - 1].join(" "))
    } else {
        name.to_string()
    }
}
