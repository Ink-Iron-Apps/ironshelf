-- Drop acquisition engine tables (indexers, download clients, wanted items, downloads).
-- Migration 016 created these; this migration removes them for existing installs upgrading
-- past the acquisition-engine strip.
DROP TABLE IF EXISTS downloads;
DROP TABLE IF EXISTS wanted_items;
DROP TABLE IF EXISTS download_clients;
DROP TABLE IF EXISTS indexers;
