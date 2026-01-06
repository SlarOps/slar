-- Create API Keys tables for authentication and rate limiting
-- This migration creates the api_keys table, usage logs, rate limits, and stats view

-- 1. Create api_keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    api_key VARCHAR(255) NOT NULL UNIQUE,
    api_key_hash VARCHAR(255) NOT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    rate_limit_per_hour INTEGER NOT NULL DEFAULT 1000,
    rate_limit_per_day INTEGER NOT NULL DEFAULT 10000,
    total_requests INTEGER NOT NULL DEFAULT 0,
    total_alerts_created INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    environment VARCHAR(50) NOT NULL DEFAULT 'prod',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- 2. Create indexes for api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_organization_id ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_api_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);

-- 3. Create api_key_usage_logs table
CREATE TABLE IF NOT EXISTS api_key_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_size INTEGER DEFAULT 0,
    response_status INTEGER NOT NULL,
    response_time_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    alert_id UUID,
    alert_title VARCHAR(500),
    alert_severity VARCHAR(50),
    request_id VARCHAR(100),
    error_message TEXT
);

-- 4. Create indexes for usage logs
CREATE INDEX IF NOT EXISTS idx_api_key_usage_logs_api_key_id ON api_key_usage_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_logs_created_at ON api_key_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_logs_endpoint ON api_key_usage_logs(endpoint);

-- 5. Create api_key_rate_limits table
CREATE TABLE IF NOT EXISTS api_key_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    window_start TIMESTAMPTZ NOT NULL,
    window_type VARCHAR(10) NOT NULL, -- 'hour' or 'day'
    request_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(api_key_id, window_start, window_type)
);

-- 6. Create indexes for rate limits
CREATE INDEX IF NOT EXISTS idx_api_key_rate_limits_api_key_id ON api_key_rate_limits(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_rate_limits_window ON api_key_rate_limits(api_key_id, window_start, window_type);

-- 7. Create api_key_stats view for convenient statistics
CREATE OR REPLACE VIEW api_key_stats AS
SELECT
    ak.id,
    ak.name,
    ak.user_id,
    u.name AS user_name,
    u.email AS user_email,
    ak.group_id,
    g.name AS group_name,
    ak.environment,
    ak.is_active,
    ak.created_at,
    ak.last_used_at,
    ak.total_requests,
    ak.total_alerts_created,
    ak.rate_limit_per_hour,
    ak.rate_limit_per_day,
    COALESCE((
        SELECT COUNT(*)
        FROM api_key_usage_logs ul
        WHERE ul.api_key_id = ak.id
        AND ul.created_at > NOW() - INTERVAL '24 hours'
    ), 0) AS requests_last_24h,
    COALESCE((
        SELECT COUNT(*)
        FROM api_key_usage_logs ul
        WHERE ul.api_key_id = ak.id
        AND ul.created_at > NOW() - INTERVAL '24 hours'
        AND ul.alert_id IS NOT NULL
    ), 0) AS alerts_last_24h,
    COALESCE((
        SELECT COUNT(*)
        FROM api_key_usage_logs ul
        WHERE ul.api_key_id = ak.id
        AND ul.created_at > NOW() - INTERVAL '24 hours'
        AND ul.response_status >= 400
    ), 0) AS errors_last_24h,
    COALESCE((
        SELECT AVG(ul.response_time_ms)::FLOAT
        FROM api_key_usage_logs ul
        WHERE ul.api_key_id = ak.id
        AND ul.created_at > NOW() - INTERVAL '24 hours'
    ), 0) AS avg_response_time_ms,
    CASE
        WHEN NOT ak.is_active THEN 'disabled'
        WHEN ak.expires_at IS NOT NULL AND ak.expires_at < NOW() THEN 'expired'
        ELSE 'active'
    END AS status
FROM api_keys ak
LEFT JOIN users u ON ak.user_id = u.id
LEFT JOIN groups g ON ak.group_id = g.id;

-- 8. Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_api_keys_updated_at ON api_keys;
CREATE TRIGGER trigger_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_api_keys_updated_at();

-- NOTE: RLS is intentionally NOT enabled for api_keys
-- Reason: Go API uses service_role (bypasses RLS), all authorization
-- is handled by ReBAC in application layer (APIKeyService + authz middleware)
-- Adding RLS here would be dead code with no security benefit
