-- Update existing user buckets to support skills (.zip, .skill files)
-- This migration updates the allowed_mime_types and file_size_limit for existing buckets

-- Update all existing user buckets to support both MCP configs and skills
UPDATE storage.buckets
SET
  file_size_limit = 8388608,  -- 8MB (8 * 1024 * 1024)
  allowed_mime_types = ARRAY[
    'application/json',           -- .mcp.json files
    'application/octet-stream',   -- .skill files
    'application/zip',            -- .zip archives
    'text/plain'                  -- text-based skills
  ]
WHERE
  -- Only update user buckets (those that match UUID pattern)
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public = false;

-- Verify the update
SELECT
  name,
  file_size_limit,
  allowed_mime_types,
  public
FROM storage.buckets
WHERE name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
LIMIT 5;
