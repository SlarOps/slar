-- Add worker_url column to monitor_deployments for direct Worker API access
-- This URL is used by frontend to call Worker API instead of Go backend
-- Format: https://{worker-name}.{subdomain}.workers.dev

ALTER TABLE monitor_deployments ADD COLUMN IF NOT EXISTS worker_url TEXT;

-- Update existing deployments with placeholder (users need to update manually)
COMMENT ON COLUMN monitor_deployments.worker_url IS 'Cloudflare Worker URL for direct API access. Format: https://{worker-name}.{subdomain}.workers.dev';
