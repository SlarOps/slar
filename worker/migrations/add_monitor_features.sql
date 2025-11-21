-- D1 Migration: Add TCP_PING and response validation features
-- This should be executed on the D1 database via Cloudflare API or dashboard

-- Add new columns to monitors table
ALTER TABLE monitors ADD COLUMN target TEXT;
ALTER TABLE monitors ADD COLUMN response_keyword TEXT;
ALTER TABLE monitors ADD COLUMN response_forbidden_keyword TEXT;

-- Note: D1 (SQLite) doesn't support adding multiple columns in one statement
-- Each ALTER TABLE ADD COLUMN must be separate

-- Update existing monitors to populate target field with url for backward compatibility
UPDATE monitors SET target = url WHERE target IS NULL AND method != 'TCP_PING';
