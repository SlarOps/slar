-- Add kv_namespace_id column to monitor_deployments table
-- This stores the Cloudflare KV namespace ID for fast log access

ALTER TABLE monitor_deployments 
ADD COLUMN IF NOT EXISTS kv_namespace_id TEXT;

COMMENT ON COLUMN monitor_deployments.kv_namespace_id IS 'Cloudflare KV namespace ID for storing monitor logs (fast access, no query quota)';
