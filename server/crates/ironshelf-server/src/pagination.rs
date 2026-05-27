//! Shared pagination, sorting, and search extraction for list endpoints.
//!
//! All list endpoints use `PaginationParams` + `SortParams`. Results wrapped in `Paginated<T>`.
//! TODO: SQL-level pagination for CalibreSource — currently slicing in-memory after full fetch.

use serde::{Deserialize, Serialize};

/// Pagination query parameters extracted from `?page=&per_page=`.
#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    /// Page number (1-indexed). Defaults to 1.
    pub page: Option<u32>,
    /// Items per page. Defaults to 50, max 200.
    pub per_page: Option<u32>,
}

impl PaginationParams {
    pub fn page(&self) -> u32 {
        self.page.unwrap_or(1).max(1)
    }

    pub fn per_page(&self) -> u32 {
        self.per_page.unwrap_or(50).clamp(1, 200)
    }

    /// Calculate the offset for slicing a collection.
    pub fn offset(&self) -> usize {
        ((self.page() - 1) * self.per_page()) as usize
    }
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    Ascending,
    Descending,
}

/// Sort query parameters extracted from `?sort=&dir=`.
#[derive(Debug, Deserialize)]
pub struct SortParams {
    /// Field name to sort by (endpoint-specific).
    pub sort: Option<String>,
    /// Direction: "asc" (default) or "desc".
    pub dir: Option<String>,
}

impl SortParams {
    pub fn direction(&self) -> SortDirection {
        match self.dir.as_deref() {
            Some("desc") => SortDirection::Descending,
            _ => SortDirection::Ascending,
        }
    }

    pub fn field(&self) -> Option<&str> {
        self.sort.as_deref()
    }
}

/// Paginated response wrapper.
#[derive(Debug, Serialize)]
pub struct Paginated<T: Serialize> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: u32,
    pub per_page: u32,
}

impl<T: Serialize> Paginated<T> {
    /// Create a paginated response by slicing a full collection in-memory.
    /// TODO: Replace with SQL-level LIMIT/OFFSET for CalibreSource performance.
    pub fn from_vec(mut items: Vec<T>, pagination: &PaginationParams) -> Self {
        let total = items.len() as i64;
        let offset = pagination.offset();
        let per_page = pagination.per_page();

        let page_items = if offset >= items.len() {
            vec![]
        } else {
            let end = (offset + per_page as usize).min(items.len());
            items.drain(offset..end).collect()
        };

        Self {
            items: page_items,
            total,
            page: pagination.page(),
            per_page,
        }
    }
}
