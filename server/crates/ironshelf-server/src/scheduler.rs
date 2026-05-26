//! Background scheduled tasks that run alongside the server.
//!
//! Each task is spawned as a separate tokio task with its own interval.
//! - Library rescan (FolderSource): every 30 minutes
//! - Session cleanup: every hour
//! - Metadata auto-enrich: every 6 hours

use std::time::Duration;

use crate::state::{AppState, LibrarySource};
use ironshelf_core::search_index::BookIndexEntry;

/// Start all background scheduled tasks. Call once after server setup.
pub fn start(application_state: AppState) {
    tracing::info!("starting background scheduler");

    tokio::spawn(library_rescan_task(application_state.clone()));
    tokio::spawn(session_cleanup_task(application_state.clone()));
    tokio::spawn(metadata_auto_enrich_task(application_state));
}

/// Every 30 minutes: rescan FolderSource libraries for new files.
/// If new books are found, create a `new_book` notification for all users.
async fn library_rescan_task(application_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(30 * 60));
    // Skip the immediate first tick so we don't rescan at startup.
    interval.tick().await;

    loop {
        interval.tick().await;
        tracing::info!("scheduler: running library rescan");

        let libraries = application_state.libraries.read().await;
        let mut total_new_books: usize = 0;

        for library in libraries.iter() {
            if let LibrarySource::Folder(ref folder_source) = library.source {
                // Count books before rescan.
                let books_before = {
                    let source = folder_source.read().await;
                    source.all_books().len()
                };

                // Perform rescan.
                {
                    let mut source = folder_source.write().await;
                    if let Err(scan_error) = source.scan().await {
                        tracing::error!(
                            "scheduler: rescan failed for library '{}': {scan_error}",
                            library.name
                        );
                        continue;
                    }
                }

                // Count books after rescan.
                let books_after = {
                    let source = folder_source.read().await;
                    source.all_books().len()
                };

                let newly_added = books_after.saturating_sub(books_before);
                if newly_added > 0 {
                    total_new_books += newly_added;
                    tracing::info!(
                        "scheduler: library '{}' found {} new book(s)",
                        library.name,
                        newly_added
                    );
                }
            }
        }
        drop(libraries);

        // If new books were found, re-index them in the search index.
        if total_new_books > 0 {
            if let Some(ref search_index) = application_state.search_index {
                tracing::info!("scheduler: updating search index after rescan");
                let libraries = application_state.libraries.read().await;
                let mut entries: Vec<BookIndexEntry> = Vec::new();

                for library in libraries.iter() {
                    let all_books = library.source.all_books().await.unwrap_or_default();
                    let authors = library.source.authors().await.unwrap_or_default();
                    let author_name_map: std::collections::HashMap<i64, String> = authors
                        .into_iter()
                        .map(|author| (author.id, author.name))
                        .collect();

                    for book in all_books {
                        let author_names: Vec<String> = book
                            .author_ids
                            .iter()
                            .filter_map(|author_id| author_name_map.get(author_id).cloned())
                            .collect();

                        entries.push(BookIndexEntry {
                            book_id: book.id,
                            title: book.title,
                            author_names: author_names.join(", "),
                            series_name: None,
                            tags: book.tags.join(", "),
                            description: book.description,
                            library_id: library.id.clone(),
                        });
                    }
                }
                drop(libraries);

                let index_guard = search_index.read().await;
                match index_guard.rebuild(entries) {
                    Ok(count) => {
                        tracing::info!("scheduler: search index rebuilt with {count} book(s)");
                    }
                    Err(index_error) => {
                        tracing::error!("scheduler: failed to rebuild search index: {index_error}");
                    }
                }
            }
        }

        // If new books were found, notify all users.
        if total_new_books > 0 {
            let notification_title = "New books available";
            let notification_message = format!(
                "{total_new_books} new book(s) were discovered during library rescan."
            );

            match application_state.ironshelf_db.get_all_user_ids().await {
                Ok(user_ids) => {
                    for user_id in &user_ids {
                        if let Err(notification_error) = application_state
                            .ironshelf_db
                            .create_notification(
                                user_id,
                                notification_title,
                                &notification_message,
                                "new_book",
                                None,
                            )
                            .await
                        {
                            tracing::error!(
                                "scheduler: failed to create notification for user {user_id}: {notification_error}"
                            );
                        }
                    }
                    tracing::info!(
                        "scheduler: notified {} user(s) about {total_new_books} new book(s)",
                        user_ids.len()
                    );
                }
                Err(database_error) => {
                    tracing::error!("scheduler: failed to fetch user IDs for notifications: {database_error}");
                }
            }
        } else {
            tracing::info!("scheduler: library rescan complete, no new books found");
        }
    }
}

/// Every hour: delete expired sessions from the database.
async fn session_cleanup_task(application_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60 * 60));
    // Skip the immediate first tick.
    interval.tick().await;

    loop {
        interval.tick().await;
        tracing::info!("scheduler: running session cleanup");

        match application_state.ironshelf_db.delete_expired_sessions().await {
            Ok(deleted_count) => {
                if deleted_count > 0 {
                    tracing::info!("scheduler: cleaned up {deleted_count} expired session(s)");
                } else {
                    tracing::info!("scheduler: no expired sessions to clean up");
                }
            }
            Err(database_error) => {
                tracing::error!("scheduler: session cleanup failed: {database_error}");
            }
        }
    }
}

/// Every 6 hours: find books without descriptions and attempt metadata enrichment.
/// Limits to 10 books per run to avoid API abuse.
async fn metadata_auto_enrich_task(application_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(6 * 60 * 60));
    // Skip the immediate first tick.
    interval.tick().await;

    loop {
        interval.tick().await;
        tracing::info!("scheduler: running metadata auto-enrich");

        let libraries = application_state.libraries.read().await;
        let mut books_without_description: Vec<(String, String, i64)> = Vec::new(); // (library_id, book_title, book_id)

        for library in libraries.iter() {
            match library.source.all_books().await {
                Ok(all_books) => {
                    for book in all_books {
                        if book.description.is_none() && books_without_description.len() < 10 {
                            books_without_description.push((
                                library.id.clone(),
                                book.title.clone(),
                                book.id,
                            ));
                        }
                    }
                }
                Err(source_error) => {
                    tracing::error!(
                        "scheduler: failed to list books for library '{}': {source_error}",
                        library.name
                    );
                }
            }

            if books_without_description.len() >= 10 {
                break;
            }
        }
        drop(libraries);

        if books_without_description.is_empty() {
            tracing::info!("scheduler: metadata auto-enrich complete, all books have descriptions");
            continue;
        }

        tracing::info!(
            "scheduler: found {} book(s) without descriptions (capped at 10)",
            books_without_description.len()
        );

        // Check if metadata cache already exists for these books. If not, log them
        // as candidates. Actual enrichment would call external metadata providers,
        // which is implemented in the metadata route handlers. Here we record a
        // system notification so the owner knows which books need attention.
        let mut candidates: Vec<String> = Vec::new();
        for (_, book_title, book_id) in &books_without_description {
            let book_id_string = book_id.to_string();
            match application_state
                .ironshelf_db
                .get_all_metadata_cache(&book_id_string)
                .await
            {
                Ok(cached_entries) if !cached_entries.is_empty() => {
                    // Already has cached metadata — skip, the user can apply it manually.
                }
                _ => {
                    candidates.push(book_title.clone());
                }
            }
        }

        if candidates.is_empty() {
            tracing::info!("scheduler: all candidate books already have cached metadata");
            continue;
        }

        // Notify all users that books need metadata enrichment.
        let truncated_list = if candidates.len() > 5 {
            let first_five: Vec<&str> = candidates.iter().take(5).map(|title| title.as_str()).collect();
            format!("{} and {} more", first_five.join(", "), candidates.len() - 5)
        } else {
            candidates.join(", ")
        };

        let notification_title = "Books need metadata";
        let notification_message = format!(
            "{} book(s) are missing descriptions: {}. Use metadata search to enrich them.",
            candidates.len(),
            truncated_list
        );

        match application_state.ironshelf_db.get_all_user_ids().await {
            Ok(user_ids) => {
                for user_id in &user_ids {
                    if let Err(notification_error) = application_state
                        .ironshelf_db
                        .create_notification(
                            user_id,
                            notification_title,
                            &notification_message,
                            "metadata_enriched",
                            None,
                        )
                        .await
                    {
                        tracing::error!(
                            "scheduler: failed to create enrichment notification for user {user_id}: {notification_error}"
                        );
                    }
                }
            }
            Err(database_error) => {
                tracing::error!("scheduler: failed to fetch user IDs for enrichment notifications: {database_error}");
            }
        }

        tracing::info!(
            "scheduler: metadata auto-enrich identified {} book(s) needing metadata",
            candidates.len()
        );
    }
}
