-- Acquisition engine tables: indexers, download clients, wanted list, downloads.

-- Indexer sources (where to search for books — Torznab, Newznab, RSS, etc.)
CREATE TABLE IF NOT EXISTS indexers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    indexer_type TEXT NOT NULL, -- 'torznab', 'newznab', 'rss', 'custom'
    url TEXT NOT NULL,
    api_key TEXT,
    categories TEXT, -- comma-separated category IDs
    is_enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 50,
    search_interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_searched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Download clients (torrent clients, direct download)
CREATE TABLE IF NOT EXISTS download_clients (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    client_type TEXT NOT NULL, -- 'qbittorrent', 'transmission', 'deluge', 'rtorrent', 'direct'
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT,
    password TEXT,
    use_ssl INTEGER NOT NULL DEFAULT 0,
    download_directory TEXT, -- where client saves files
    category TEXT, -- torrent category/label for ironshelf downloads
    is_enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 50,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Wanted list (books/series/authors to track and auto-acquire)
CREATE TABLE IF NOT EXISTS wanted_items (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL, -- 'book', 'author', 'series'
    title TEXT NOT NULL, -- search term
    author_name TEXT,
    isbn TEXT,
    year TEXT,
    preferred_format TEXT DEFAULT 'EPUB',
    quality_profile TEXT DEFAULT 'any', -- 'any', 'epub_only', 'high_quality'
    is_active INTEGER NOT NULL DEFAULT 1,
    is_fulfilled INTEGER NOT NULL DEFAULT 0,
    fulfilled_at TEXT,
    last_searched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Download queue / history
CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY NOT NULL,
    wanted_item_id TEXT REFERENCES wanted_items(id) ON DELETE SET NULL,
    indexer_id TEXT REFERENCES indexers(id) ON DELETE SET NULL,
    download_client_id TEXT REFERENCES download_clients(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    download_url TEXT NOT NULL,
    magnet_url TEXT,
    torrent_hash TEXT,
    size_bytes INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'downloading', 'completed', 'importing', 'imported', 'failed'
    progress_percent REAL NOT NULL DEFAULT 0,
    error_message TEXT,
    file_path TEXT, -- where the downloaded file ended up
    target_library_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_wanted ON downloads(wanted_item_id);
CREATE INDEX IF NOT EXISTS idx_wanted_items_user ON wanted_items(user_id);
CREATE INDEX IF NOT EXISTS idx_wanted_items_active ON wanted_items(is_active, is_fulfilled);
