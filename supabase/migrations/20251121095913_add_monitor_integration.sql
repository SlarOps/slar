-- Migration: Add integration support to monitor deployments
-- This allows monitor workers to send incidents via integration webhook URLs

-- Add integration_id column to link deployments to integrations
ALTER TABLE monitor_deployments 
ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX idx_monitor_deployments_integration_id ON monitor_deployments(integration_id);

-- Add comment for documentation
COMMENT ON COLUMN monitor_deployments.integration_id IS 'Optional link to integration for webhook-based incident reporting';
