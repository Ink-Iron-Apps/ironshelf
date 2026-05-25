-- Migration 007: Add kindle_email column to users table for Send-to-Kindle integration.
ALTER TABLE users ADD COLUMN kindle_email TEXT;
