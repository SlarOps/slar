-- Migration: Change provider_id from UUID to TEXT
-- Reason: OIDC providers use various subject ID formats (strings, numbers, etc.)
-- not always UUIDs. TEXT type supports all OIDC subject formats.

ALTER TABLE users ALTER COLUMN provider_id TYPE TEXT;

-- Comment for documentation
COMMENT ON COLUMN users.provider_id IS 'Original provider subject ID (OIDC sub claim). TEXT type to support various OIDC provider formats.';
