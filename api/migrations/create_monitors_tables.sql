-- Migration: Create tables for UptimeFlare-style monitoring

-- Table to store Cloudflare Worker deployments
CREATE TABLE IF NOT EXISTS monitor_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    
    -- Cloudflare Credentials
    cf_account_id TEXT NOT NULL,
    cf_api_token TEXT NOT NULL, -- Should be encrypted in app, but stored as text here
    
    -- Worker Config
    worker_name TEXT NOT NULL DEFAULT 'slar-uptime-worker',
    kv_config_id TEXT, -- ID of SLAR_CONFIG namespace
    kv_state_id TEXT, -- ID of SLAR_STATE namespace
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_deployed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE
);

-- Table to store individual monitors
CREATE TABLE IF NOT EXISTS monitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID NOT NULL REFERENCES monitor_deployments(id) ON DELETE CASCADE,
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Check Config
    method VARCHAR(10) NOT NULL DEFAULT 'GET',
    url TEXT NOT NULL,
    target TEXT, -- For TCP_PING: host:port, for HTTP: same as url
    headers JSONB DEFAULT '{}',
    body TEXT,
    timeout INTEGER DEFAULT 10000, -- ms
    expect_status INTEGER, -- Optional, if null check 2xx
    follow_redirect BOOLEAN DEFAULT true,
    
    -- Response Validation
    response_keyword TEXT, -- Optional keyword that must be present
    response_forbidden_keyword TEXT, -- Optional keyword that must NOT be present
    
    -- Status Page
    tooltip TEXT,
    status_page_link TEXT,
    
    -- Schedule
    interval_seconds INTEGER DEFAULT 60, -- Not used by worker yet (worker runs every min), but good for future
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    last_check_at TIMESTAMP WITH TIME ZONE,
    last_status INTEGER,
    last_latency INTEGER,
    last_error TEXT,
    is_up BOOLEAN,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_monitors_deployment_id ON monitors(deployment_id);
CREATE INDEX idx_monitor_deployments_group_id ON monitor_deployments(group_id);

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_monitor_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at
CREATE TRIGGER trigger_monitor_deployments_updated_at
    BEFORE UPDATE ON monitor_deployments
    FOR EACH ROW
    EXECUTE FUNCTION update_monitor_updated_at();

CREATE TRIGGER trigger_monitors_updated_at
    BEFORE UPDATE ON monitors
    FOR EACH ROW
    EXECUTE FUNCTION update_monitor_updated_at();
