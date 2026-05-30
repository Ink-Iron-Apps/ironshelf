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
    tokio::spawn(metadata_auto_enrich_task(application_state.clone()));
    tokio::spawn(acquisition_wanted_search_task(application_state.clone()));
    tokio::spawn(acquisition_download_monitor_task(application_state.clone()));
    tokio::spawn(acquisition_stale_cleanup_task(application_state.clone()));
    tokio::spawn(upnp_refresh_task(application_state.clone()));
    tokio::spawn(tunnel_health_check_task(application_state));
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

        // Collect folder sources we need to rescan, then drop the libraries
        // read lock so we don't block library mutations during the scan.
        let folder_sources: Vec<(String, std::sync::Arc<tokio::sync::RwLock<ironshelf_core::scan::FolderSource>>)> = {
            let libraries = application_state.libraries.read().await;
            libraries
                .iter()
                .filter_map(|library| {
                    if let LibrarySource::Folder(ref folder_source) = library.source {
                        Some((library.name.clone(), std::sync::Arc::clone(folder_source)))
                    } else {
                        None
                    }
                })
                .collect()
        };

        let mut total_new_books: usize = 0;

        for (library_name, folder_source) in &folder_sources {
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
                        library_name
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
                    library_name,
                    newly_added
                );
            }
        }

        // If new books were found, re-index them in the search index.
        if total_new_books > 0 {
            if let Some(ref search_index) = application_state.search_index {
                tracing::info!("scheduler: updating search index after rescan");
                let libraries = application_state.libraries.read().await;
                let mut entries: Vec<BookIndexEntry> = Vec::new();

                const PAGINATION_BATCH_SIZE: i64 = 500;

                for library in libraries.iter() {
                    let authors = library.source.authors().await.unwrap_or_default();
                    let author_name_map: std::collections::HashMap<i64, String> = authors
                        .into_iter()
                        .map(|author| (author.id, author.name))
                        .collect();

                    // Use paginated iteration to avoid loading all books into memory at once.
                    let mut page_offset: i64 = 0;
                    loop {
                        let page_books = library
                            .source
                            .books_paginated(page_offset, PAGINATION_BATCH_SIZE)
                            .await
                            .unwrap_or_default();

                        if page_books.is_empty() {
                            break;
                        }

                        let page_length = page_books.len() as i64;

                        for book in page_books {
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

                        if page_length < PAGINATION_BATCH_SIZE {
                            break;
                        }
                        page_offset += PAGINATION_BATCH_SIZE;
                    }
                }
                drop(libraries);

                let index_guard = search_index.write().await;
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
                                Some("/#/libraries"),
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
            let first_five: Vec<&str> = candidates.iter().take(5).map(|title| &**title).collect();
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
        let notification_link = Some("/#/books/missing-metadata");

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
                            notification_link.map(|s| s.to_string()).as_deref(),
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

/// Every 30 minutes: renew the UPnP port mapping lease.
/// If the mapping was lost (router reboot, DHCP change), attempts a full
/// re-discovery and re-establishment.
async fn upnp_refresh_task(application_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(30 * 60));
    // Skip the immediate first tick.
    interval.tick().await;

    loop {
        interval.tick().await;

        let is_enabled = {
            let upnp_manager = application_state.upnp_manager.read().await;
            upnp_manager.get_status().is_enabled
        };

        if !is_enabled {
            continue;
        }

        tracing::debug!("scheduler: refreshing UPnP port mapping");

        let mut upnp_manager = application_state.upnp_manager.write().await;
        upnp_manager.refresh().await;

        let status = upnp_manager.get_status();
        if status.is_active {
            tracing::debug!(
                "scheduler: UPnP mapping active — {}",
                status.public_url.as_deref().unwrap_or("unknown")
            );
        } else {
            tracing::warn!(
                "scheduler: UPnP mapping inactive — {}",
                status.last_error.as_deref().unwrap_or("unknown error")
            );
        }
    }
}

/// Every 5 minutes: verify the Cloudflare tunnel child process is still alive.
/// If it died, attempt to respawn it. If the URL changed after respawn,
/// update the cloud config so routing stays current.
async fn tunnel_health_check_task(application_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(5 * 60));
    // Skip the immediate first tick.
    interval.tick().await;

    loop {
        interval.tick().await;

        let (was_active, is_healthy) = {
            let mut tunnel_manager = application_state.tunnel_manager.write().await;
            let was_active = tunnel_manager.get_status().is_active;
            let is_healthy = tunnel_manager.check_health();
            (was_active, is_healthy)
        };

        if !was_active {
            // Tunnel was never started or was explicitly stopped — skip.
            continue;
        }

        if is_healthy {
            tracing::debug!("scheduler: Cloudflare tunnel health check passed");
            continue;
        }

        // Tunnel was active but child process died — respawn.
        tracing::warn!("scheduler: Cloudflare tunnel died, attempting respawn");

        let mut tunnel_manager = application_state.tunnel_manager.write().await;
        match tunnel_manager.start().await {
            Ok(new_public_url) => {
                tracing::info!(
                    "scheduler: Cloudflare tunnel respawned: {new_public_url}"
                );
                drop(tunnel_manager);

                // Update cloud config with the new URL.
                crate::update_cloud_server_url(&application_state, &new_public_url).await;
            }
            Err(respawn_error) => {
                tracing::error!(
                    "scheduler: failed to respawn Cloudflare tunnel: {respawn_error}"
                );
            }
        }
    }
}

// =========================================================================
// Acquisition engine scheduled tasks
// =========================================================================

/// Every 60 minutes: search indexers for unfulfilled wanted items.
/// Auto-grabs results with confidence > 0.9.
async fn acquisition_wanted_search_task(application_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60 * 60));
    // Skip the immediate first tick.
    interval.tick().await;

    loop {
        interval.tick().await;
        tracing::info!("scheduler: running acquisition wanted item search");

        let wanted_items = match application_state
            .ironshelf_db
            .list_all_active_wanted_items()
            .await
        {
            Ok(items) => items,
            Err(database_error) => {
                tracing::error!(
                    "scheduler: failed to list wanted items: {database_error}"
                );
                continue;
            }
        };

        if wanted_items.is_empty() {
            tracing::info!("scheduler: no active wanted items to search");
            continue;
        }

        let indexers = match application_state
            .ironshelf_db
            .list_enabled_indexers()
            .await
        {
            Ok(indexer_list) => indexer_list,
            Err(database_error) => {
                tracing::error!(
                    "scheduler: failed to list indexers: {database_error}"
                );
                continue;
            }
        };

        if indexers.is_empty() {
            tracing::info!("scheduler: no enabled indexers for wanted item search");
            continue;
        }

        let high_confidence_matches =
            ironshelf_core::acquisition::search::auto_search_wanted(
                &application_state.http_client,
                &indexers,
                &wanted_items,
                0.9,
            )
            .await;

        tracing::info!(
            "scheduler: found {} high-confidence match(es) for wanted items",
            high_confidence_matches.len()
        );

        for (wanted_item, search_result) in &high_confidence_matches {
            // Find a download client.
            let download_client = match application_state
                .ironshelf_db
                .get_default_download_client()
                .await
            {
                Ok(Some(client)) => client,
                _ => {
                    tracing::warn!(
                        "scheduler: no download client available, skipping auto-grab for '{}'",
                        wanted_item.title
                    );
                    continue;
                }
            };

            // Create download record.
            let download_id = match application_state
                .ironshelf_db
                .create_download(&ironshelf_core::db::CreateDownloadParams {
                    wanted_item_id: Some(&wanted_item.id),
                    indexer_id: None,
                    download_client_id: Some(&download_client.id),
                    title: &search_result.title,
                    download_url: &search_result.download_url,
                    magnet_url: search_result.magnet_url.as_deref(),
                    torrent_hash: search_result.info_hash.as_deref(),
                    size_bytes: search_result.size_bytes,
                    target_library_id: None,
                })
                .await
            {
                Ok(id) => id,
                Err(database_error) => {
                    tracing::error!(
                        "scheduler: failed to create download for '{}': {database_error}",
                        search_result.title
                    );
                    continue;
                }
            };

            // Send to download client.
            match ironshelf_core::acquisition::download_clients::add_download(
                &application_state.http_client,
                &download_client,
                &search_result.download_url,
                search_result.magnet_url.as_deref(),
            )
            .await
            {
                Ok(_external_identifier) => {
                    let _ = application_state
                        .ironshelf_db
                        .update_download_status(&download_id, "downloading", 0.0, None)
                        .await;

                    tracing::info!(
                        "scheduler: auto-grabbed '{}' for wanted item '{}'",
                        search_result.title,
                        wanted_item.title
                    );
                }
                Err(client_error) => {
                    let _ = application_state
                        .ironshelf_db
                        .update_download_status(
                            &download_id,
                            "failed",
                            0.0,
                            Some(&client_error.to_string()),
                        )
                        .await;

                    tracing::error!(
                        "scheduler: auto-grab failed for '{}': {client_error}",
                        search_result.title
                    );
                }
            }

            // Update last_searched_at on the wanted item.
            let _ = application_state
                .ironshelf_db
                .touch_wanted_item_searched(&wanted_item.id)
                .await;
        }

        // Update last_searched_at on all indexers that were queried.
        for indexer in &indexers {
            let _ = application_state
                .ironshelf_db
                .touch_indexer_searched(&indexer.id)
                .await;
        }
    }
}

/// Every 30 seconds: check download client status for active downloads,
/// update progress in DB, trigger import on completion.
async fn acquisition_download_monitor_task(application_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    // Skip the immediate first tick.
    interval.tick().await;

    loop {
        interval.tick().await;

        let active_downloads = match application_state
            .ironshelf_db
            .list_active_downloads()
            .await
        {
            Ok(downloads) => downloads,
            Err(database_error) => {
                tracing::error!(
                    "scheduler: failed to list active downloads: {database_error}"
                );
                continue;
            }
        };

        if active_downloads.is_empty() {
            continue;
        }

        for download in &active_downloads {
            // Skip downloads without a client or hash.
            let client_id = match &download.download_client_id {
                Some(id) => id.clone(),
                None => continue,
            };

            let torrent_hash = match &download.torrent_hash {
                Some(hash) => hash.clone(),
                None => {
                    // For direct downloads, the torrent_hash is the file path.
                    // Direct downloads complete immediately, so check if file exists.
                    if let Some(ref file_path) = download.file_path {
                        if std::path::Path::new(file_path).exists() {
                            let _ = application_state
                                .ironshelf_db
                                .update_download_status(
                                    &download.id,
                                    "completed",
                                    100.0,
                                    None,
                                )
                                .await;
                        }
                    }
                    continue;
                }
            };

            let client_config = match application_state
                .ironshelf_db
                .get_download_client(&client_id)
                .await
            {
                Ok(Some(config)) => config,
                _ => continue,
            };

            // Check status from the download client.
            match ironshelf_core::acquisition::download_clients::check_download_status(
                &application_state.http_client,
                &client_config,
                &torrent_hash,
            )
            .await
            {
                Ok(status) => {
                    let new_status = match status.state {
                        ironshelf_core::acquisition::DownloadState::Downloading => "downloading",
                        ironshelf_core::acquisition::DownloadState::Seeding
                        | ironshelf_core::acquisition::DownloadState::Completed => "completed",
                        ironshelf_core::acquisition::DownloadState::Paused => "downloading", // Still in progress.
                        ironshelf_core::acquisition::DownloadState::Failed => "failed",
                        ironshelf_core::acquisition::DownloadState::Unknown => "downloading",
                    };

                    let _ = application_state
                        .ironshelf_db
                        .update_download_status(
                            &download.id,
                            new_status,
                            status.progress_percent,
                            None,
                        )
                        .await;

                    // If completed, try to get the file path.
                    if new_status == "completed" {
                        if let Ok(Some(file_path)) =
                            ironshelf_core::acquisition::download_clients::get_download_file_path(
                                &application_state.http_client,
                                &client_config,
                                &torrent_hash,
                            )
                            .await
                        {
                            let _ = application_state
                                .ironshelf_db
                                .update_download_file_path(&download.id, &file_path)
                                .await;
                        }

                        // If there is a wanted_item_id, mark it as fulfilled.
                        if let Some(ref wanted_item_id) = download.wanted_item_id {
                            let _ = application_state
                                .ironshelf_db
                                .mark_wanted_item_fulfilled(wanted_item_id)
                                .await;
                        }

                        // Notify users about the completed download.
                        if let Ok(user_ids) =
                            application_state.ironshelf_db.get_all_user_ids().await
                        {
                            for user_id in &user_ids {
                                let _ = application_state
                                    .ironshelf_db
                                    .create_notification(
                                        user_id,
                                        "Download completed",
                                        &format!(
                                            "'{}' has finished downloading and is ready for import.",
                                            download.title
                                        ),
                                        "download_completed",
                                        Some("/#/acquisition/downloads"),
                                    )
                                    .await;
                            }
                        }

                        tracing::info!(
                            "scheduler: download completed: '{}'",
                            download.title
                        );
                    }
                }
                Err(status_error) => {
                    tracing::error!(
                        "scheduler: failed to check download status for '{}': {status_error}",
                        download.title
                    );
                }
            }
        }
    }
}

/// Every 6 hours: mark downloads stuck in 'downloading' for >24 hours as failed.
async fn acquisition_stale_cleanup_task(application_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(6 * 60 * 60));
    // Skip the immediate first tick.
    interval.tick().await;

    loop {
        interval.tick().await;
        tracing::info!("scheduler: running stale download cleanup");

        match application_state
            .ironshelf_db
            .mark_stale_downloads_failed(24)
            .await
        {
            Ok(marked_count) => {
                if marked_count > 0 {
                    tracing::info!(
                        "scheduler: marked {marked_count} stale download(s) as failed"
                    );
                } else {
                    tracing::info!("scheduler: no stale downloads to clean up");
                }
            }
            Err(database_error) => {
                tracing::error!(
                    "scheduler: stale download cleanup failed: {database_error}"
                );
            }
        }
    }
}
