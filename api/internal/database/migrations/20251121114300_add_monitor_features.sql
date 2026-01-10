-- Migration: Add TCP_PING and response validation features to monitors

-- Add new columns to monitors table
ALTER TABLE monitors 
ADD COLUMN IF NOT EXISTS target TEXT,
ADD COLUMN IF NOT EXISTS response_keyword TEXT,
ADD COLUMN IF NOT EXISTS response_forbidden_keyword TEXT,
ADD COLUMN IF NOT EXISTS tooltip TEXT,
ADD COLUMN IF NOT EXISTS status_page_link TEXT;

-- Update existing monitors to populate target field with url for backward compatibility
UPDATE monitors SET target = url WHERE target IS NULL AND method != 'TCP_PING';

-- Add comment for documentation
COMMENT ON COLUMN monitors.target IS 'For TCP_PING: host:port format. For HTTP: same as url (for consistency)';
COMMENT ON COLUMN monitors.response_keyword IS 'Optional keyword that must be present in response body';
COMMENT ON COLUMN monitors.response_forbidden_keyword IS 'Optional keyword that must NOT be present in response body';
COMMENT ON COLUMN monitors.tooltip IS 'Tooltip text to display on status page';
COMMENT ON COLUMN monitors.status_page_link IS 'Clickable link on status page';
 