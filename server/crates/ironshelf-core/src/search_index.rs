//! Full-text search index powered by tantivy.
//!
//! Indexes book metadata (title, authors, series, tags, description) for fast
//! relevance-ranked queries. The index lives on disk next to the Ironshelf DB.

use std::path::Path;

use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::QueryParser;
use tantivy::schema::{
    Field, Schema, Value, STORED, STRING, TEXT,
};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument};

/// A single search hit returned by the index.
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// The book's integer ID (as stored in library source).
    pub book_id: i64,
    /// Book title (stored verbatim for display).
    pub title: String,
    /// Comma-separated author names.
    pub author_names: String,
    /// Library ID that owns this book.
    pub library_id: String,
    /// Tantivy relevance score.
    pub score: f32,
    /// Short highlighted snippet from the matching field (best-effort).
    pub snippet: Option<String>,
}

/// Field handles for quick access without name lookups.
#[derive(Debug, Clone)]
struct IndexFields {
    book_id: Field,
    title: Field,
    author_names: Field,
    series_name: Field,
    tags: Field,
    description: Field,
    library_id: Field,
}

/// Wraps a tantivy index for Ironshelf book search.
pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    fields: IndexFields,
    schema: Schema,
}

impl SearchIndex {
    /// Open (or create) the search index at the given directory path.
    ///
    /// If the directory does not exist it will be created. If an existing index
    /// is present it will be opened; otherwise a fresh empty index is created.
    pub fn open(index_path: &Path) -> Result<Self, SearchIndexError> {
        std::fs::create_dir_all(index_path).map_err(|io_error| {
            SearchIndexError::Io(format!(
                "failed to create index directory {}: {io_error}",
                index_path.display()
            ))
        })?;

        let schema = Self::build_schema();
        let directory = MmapDirectory::open(index_path).map_err(|tantivy_error| {
            SearchIndexError::Tantivy(format!("failed to open mmap directory: {tantivy_error}"))
        })?;

        let index = Index::open_or_create(directory, schema.clone()).map_err(|tantivy_error| {
            SearchIndexError::Tantivy(format!("failed to open or create index: {tantivy_error}"))
        })?;

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|tantivy_error| {
                SearchIndexError::Tantivy(format!("failed to create reader: {tantivy_error}"))
            })?;

        let fields = IndexFields {
            book_id: schema.get_field("book_id").unwrap(),
            title: schema.get_field("title").unwrap(),
            author_names: schema.get_field("author_names").unwrap(),
            series_name: schema.get_field("series_name").unwrap(),
            tags: schema.get_field("tags").unwrap(),
            description: schema.get_field("description").unwrap(),
            library_id: schema.get_field("library_id").unwrap(),
        };

        Ok(Self {
            index,
            reader,
            fields,
            schema,
        })
    }

    /// Build the tantivy schema for book documents.
    fn build_schema() -> Schema {
        let mut schema_builder = Schema::builder();

        // Stored as string for exact retrieval — not tokenized.
        schema_builder.add_text_field("book_id", STRING | STORED);
        // Full-text searchable AND stored for display.
        schema_builder.add_text_field("title", TEXT | STORED);
        schema_builder.add_text_field("author_names", TEXT | STORED);
        // Full-text searchable but not stored (we don't display series from search result).
        schema_builder.add_text_field("series_name", TEXT);
        schema_builder.add_text_field("tags", TEXT);
        schema_builder.add_text_field("description", TEXT);
        // Stored for filtering, not tokenized.
        schema_builder.add_text_field("library_id", STRING | STORED);

        schema_builder.build()
    }

    /// Index a single book (add or update). Removes any existing document with
    /// the same book_id + library_id before inserting.
    pub fn index_book(
        &self,
        book_id: i64,
        title: &str,
        authors: &str,
        series: Option<&str>,
        tags: &str,
        description: Option<&str>,
        library_id: &str,
    ) -> Result<(), SearchIndexError> {
        let mut writer = self.create_writer()?;

        // Delete existing document for this book (by composite key).
        let book_id_string = book_id.to_string();
        let book_id_term =
            tantivy::Term::from_field_text(self.fields.book_id, &book_id_string);
        writer.delete_term(book_id_term);

        writer.add_document(doc!(
            self.fields.book_id => book_id_string,
            self.fields.title => title,
            self.fields.author_names => authors,
            self.fields.series_name => series.unwrap_or(""),
            self.fields.tags => tags,
            self.fields.description => description.unwrap_or(""),
            self.fields.library_id => library_id,
        )).map_err(|tantivy_error| {
            SearchIndexError::Tantivy(format!("failed to add document: {tantivy_error}"))
        })?;

        writer.commit().map_err(|tantivy_error| {
            SearchIndexError::Tantivy(format!("failed to commit: {tantivy_error}"))
        })?;

        Ok(())
    }

    /// Remove a book from the index by its ID.
    pub fn remove_book(&self, book_id: i64) -> Result<(), SearchIndexError> {
        let mut writer = self.create_writer()?;
        let book_id_string = book_id.to_string();
        let book_id_term =
            tantivy::Term::from_field_text(self.fields.book_id, &book_id_string);
        writer.delete_term(book_id_term);
        writer.commit().map_err(|tantivy_error| {
            SearchIndexError::Tantivy(format!("failed to commit delete: {tantivy_error}"))
        })?;
        Ok(())
    }

    /// Execute a full-text search query against the index.
    ///
    /// Searches across title, author_names, series_name, tags, and description
    /// with tantivy's default BM25 ranking.
    pub fn search(
        &self,
        query_text: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<SearchResult>, SearchIndexError> {
        let searcher = self.reader.searcher();

        let query_parser = QueryParser::for_index(
            &self.index,
            vec![
                self.fields.title,
                self.fields.author_names,
                self.fields.series_name,
                self.fields.tags,
                self.fields.description,
            ],
        );

        let query = query_parser
            .parse_query(query_text)
            .map_err(|parse_error| {
                SearchIndexError::Query(format!("failed to parse query: {parse_error}"))
            })?;

        let top_docs = searcher
            .search(&query, &TopDocs::with_limit(limit + offset))
            .map_err(|search_error| {
                SearchIndexError::Tantivy(format!("search failed: {search_error}"))
            })?;

        let mut results: Vec<SearchResult> = Vec::new();

        for (index, (score, doc_address)) in top_docs.into_iter().enumerate() {
            if index < offset {
                continue;
            }

            let retrieved_doc: TantivyDocument = searcher.doc(doc_address).map_err(|doc_error| {
                SearchIndexError::Tantivy(format!("failed to retrieve doc: {doc_error}"))
            })?;

            let book_id_value = retrieved_doc
                .get_first(self.fields.book_id)
                .and_then(|value| value.as_str())
                .unwrap_or("0");
            let book_id: i64 = book_id_value.parse().unwrap_or(0);

            let title = retrieved_doc
                .get_first(self.fields.title)
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();

            let author_names = retrieved_doc
                .get_first(self.fields.author_names)
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();

            let library_id = retrieved_doc
                .get_first(self.fields.library_id)
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();

            results.push(SearchResult {
                book_id,
                title,
                author_names,
                library_id,
                score,
                snippet: None, // Snippet generation deferred to future enhancement.
            });
        }

        Ok(results)
    }

    /// Clear the entire index and reindex all provided books in a single batch.
    pub fn rebuild(&self, books: Vec<BookIndexEntry>) -> Result<usize, SearchIndexError> {
        let mut writer = self.create_writer()?;

        // Delete everything.
        writer.delete_all_documents().map_err(|tantivy_error| {
            SearchIndexError::Tantivy(format!("failed to delete all documents: {tantivy_error}"))
        })?;

        let book_count = books.len();

        for entry in books {
            let book_id_string = entry.book_id.to_string();
            writer.add_document(doc!(
                self.fields.book_id => book_id_string,
                self.fields.title => entry.title.as_str(),
                self.fields.author_names => entry.author_names.as_str(),
                self.fields.series_name => entry.series_name.unwrap_or_default(),
                self.fields.tags => entry.tags.as_str(),
                self.fields.description => entry.description.unwrap_or_default(),
                self.fields.library_id => entry.library_id.as_str(),
            )).map_err(|tantivy_error| {
                SearchIndexError::Tantivy(format!("failed to add document during rebuild: {tantivy_error}"))
            })?;
        }

        writer.commit().map_err(|tantivy_error| {
            SearchIndexError::Tantivy(format!("failed to commit rebuild: {tantivy_error}"))
        })?;

        Ok(book_count)
    }

    /// Create a writer with a reasonable memory budget (50 MB).
    fn create_writer(&self) -> Result<IndexWriter, SearchIndexError> {
        self.index
            .writer(50_000_000)
            .map_err(|tantivy_error| {
                SearchIndexError::Tantivy(format!("failed to create writer: {tantivy_error}"))
            })
    }

    /// Get the schema (for diagnostics/testing).
    pub fn schema(&self) -> &Schema {
        &self.schema
    }
}

/// Entry for batch indexing during a rebuild operation.
#[derive(Debug, Clone)]
pub struct BookIndexEntry {
    pub book_id: i64,
    pub title: String,
    pub author_names: String,
    pub series_name: Option<String>,
    pub tags: String,
    pub description: Option<String>,
    pub library_id: String,
}

/// Errors that can occur during search index operations.
#[derive(Debug, thiserror::Error)]
pub enum SearchIndexError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("tantivy error: {0}")]
    Tantivy(String),
    #[error("query parse error: {0}")]
    Query(String),
}
