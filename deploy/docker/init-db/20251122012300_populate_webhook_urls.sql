-- Migration: Populate webhook_url for existing integrations
-- This migration updates existing integrations to have webhook_url values

-- Update all existing integrations with webhook URLs
-- Using the default api.slar.io for now (can be changed via application later)
UPDATE integrations
SET webhook_url = 'https://dev-api.slarhq.com/webhook/' || type || '/' || id::text
WHERE webhook_url IS NULL;

-- For future reference: Application should set webhook_url on creation
-- based on API_BASE_URL environment variable
