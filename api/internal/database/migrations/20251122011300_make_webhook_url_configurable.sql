-- Migration: Update webhook_url to use configurable base URL
-- This migration updates the generated column to use a configurable base URL

-- Drop the existing generated column
ALTER TABLE integrations DROP COLUMN IF EXISTS webhook_url;

-- Add webhook_url as a regular column (not generated)
-- The application will populate this based on env variable
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS webhook_url VARCHAR;

-- Add comment
COMMENT ON COLUMN integrations.webhook_url IS 'Webhook URL for this integration (populated by application based on API_BASE_URL)';

-- Create function to generate webhook URL
CREATE OR REPLACE FUNCTION generate_webhook_url(base_url TEXT, integration_type TEXT, integration_id UUID)
RETURNS TEXT AS $$
BEGIN
    RETURN base_url || '/webhook/' || integration_type || '/' || integration_id::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create trigger function to auto-generate webhook_url on insert/update
CREATE OR REPLACE FUNCTION set_integration_webhook_url()
RETURNS TRIGGER AS $$
BEGIN
    -- Get base URL from environment or use default
    -- Note: This will be set by the application, not in the database
    -- For now, we'll leave it NULL and let the application handle it
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: The application will be responsible for setting webhook_url
-- based on the API_BASE_URL environment variable
