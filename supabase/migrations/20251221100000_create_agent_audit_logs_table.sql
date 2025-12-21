-- Migration: Create agent_audit_logs table
-- Description: Comprehensive audit logging for AI Agent following OWASP and AWS CloudTrail best practices
--
-- This table stores all security-relevant events for:
-- - Session lifecycle (created, authenticated, ended)
-- - Chat messages (sent, received)
-- - Tool executions (requested, approved, denied, executed)
-- - Security events (auth failures, rate limits, signature errors)
--
-- Best Practices Implemented:
-- - Structured event format (OWASP Logging Cheat Sheet)
-- - Consistent schema (AWS CloudTrail style)
-- - Sensitive data sanitization (done in application layer)
-- - Indexed for efficient querying by user, org, time

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS agent_audit_logs (
    -- Primary key and unique event identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID UNIQUE NOT NULL,  -- Client-generated for deduplication

    -- Timestamp (always UTC)
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Event classification
    event_type TEXT NOT NULL,       -- e.g., 'session.created', 'tool.executed'
    event_category TEXT NOT NULL,   -- 'session', 'chat', 'tool', 'security'

    -- Identity context (WHO)
    user_id UUID NOT NULL,
    user_email TEXT,
    org_id UUID,                    -- Organization for tenant isolation
    project_id UUID,                -- Project context if applicable
    session_id UUID,                -- Agent session ID
    device_cert_id TEXT,            -- Device certificate ID (Zero-Trust)

    -- Source context (WHERE)
    source_ip INET,                 -- Client IP address
    user_agent TEXT,                -- Client user agent
    instance_id TEXT,               -- Self-hosted instance ID

    -- Action details (WHAT)
    action TEXT NOT NULL,           -- Specific action performed
    resource_type TEXT,             -- Type of resource affected
    resource_id TEXT,               -- ID of resource affected
    request_params JSONB,           -- Sanitized request parameters

    -- Result (OUTCOME)
    status TEXT NOT NULL,           -- 'success', 'failure', 'pending'
    error_code TEXT,                -- Error code if failed
    error_message TEXT,             -- Error message if failed
    response_data JSONB,            -- Sanitized response summary

    -- Metadata
    duration_ms INTEGER,            -- Operation duration in milliseconds
    metadata JSONB,                 -- Additional context

    -- Audit metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Indexes for efficient querying
-- ============================================================

-- Primary query patterns:
-- 1. Get events by user (for user audit trail)
CREATE INDEX idx_audit_logs_user_id ON agent_audit_logs(user_id);

-- 2. Get events by organization (for org-wide audit)
CREATE INDEX idx_audit_logs_org_id ON agent_audit_logs(org_id);

-- 3. Get events by time (for time-range queries)
CREATE INDEX idx_audit_logs_event_time ON agent_audit_logs(event_time DESC);

-- 4. Get events by type (for filtering specific events)
CREATE INDEX idx_audit_logs_event_type ON agent_audit_logs(event_type);

-- 5. Get events by category (for filtering by category)
CREATE INDEX idx_audit_logs_event_category ON agent_audit_logs(event_category);

-- 6. Get events by session (for session audit trail)
CREATE INDEX idx_audit_logs_session_id ON agent_audit_logs(session_id);

-- 7. Composite index for common query: user events in time range
CREATE INDEX idx_audit_logs_user_time ON agent_audit_logs(user_id, event_time DESC);

-- 8. Composite index for org events in time range
CREATE INDEX idx_audit_logs_org_time ON agent_audit_logs(org_id, event_time DESC);

-- 9. Get security events (for security monitoring)
CREATE INDEX idx_audit_logs_security ON agent_audit_logs(event_category, event_time DESC)
WHERE event_category = 'security';

-- 10. Get failed events (for error monitoring)
CREATE INDEX idx_audit_logs_failures ON agent_audit_logs(status, event_time DESC)
WHERE status = 'failure';

-- ============================================================
-- Partitioning (for large-scale deployments)
-- ============================================================

-- Note: For very high volume, consider partitioning by time:
-- CREATE TABLE agent_audit_logs (...) PARTITION BY RANGE (event_time);
--
-- And create monthly partitions:
-- CREATE TABLE agent_audit_logs_2024_01 PARTITION OF agent_audit_logs
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- ============================================================
-- Retention Policy
-- ============================================================

-- Create a function to clean up old audit logs (optional)
-- Default retention: 90 days (configurable)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM agent_audit_logs
    WHERE event_time < NOW() - (retention_days || ' days')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RAISE NOTICE 'Deleted % audit log entries older than % days', deleted_count, retention_days;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Note: Schedule this function with pg_cron or external scheduler:
-- SELECT cron.schedule('cleanup-audit-logs', '0 3 * * *',
--     $$SELECT cleanup_old_audit_logs(90)$$);

-- ============================================================
-- RLS Policies (Row Level Security)
-- ============================================================

-- Enable RLS
ALTER TABLE agent_audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own audit logs
CREATE POLICY audit_logs_user_select ON agent_audit_logs
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR
        -- Org admins can view all org events
        EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.user_id = auth.uid()
            AND m.resource_type = 'org'
            AND m.resource_id = agent_audit_logs.org_id
            AND m.role IN ('owner', 'admin')
        )
    );

-- Policy: Only system can insert (no direct user inserts)
-- INSERT is done via backend service with service role key
CREATE POLICY audit_logs_insert ON agent_audit_logs
    FOR INSERT
    WITH CHECK (true);  -- Backend uses service role

-- Policy: No updates allowed (audit logs are immutable)
CREATE POLICY audit_logs_no_update ON agent_audit_logs
    FOR UPDATE
    USING (false);

-- Policy: Only admins can delete (for retention cleanup)
CREATE POLICY audit_logs_delete ON agent_audit_logs
    FOR DELETE
    USING (
        -- Only via service role or scheduled job
        current_setting('role') = 'service_role'
    );

-- ============================================================
-- Views for common queries
-- ============================================================

-- View: Security events summary (last 24 hours)
CREATE OR REPLACE VIEW v_security_events_24h AS
SELECT
    event_type,
    COUNT(*) as event_count,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT source_ip) as unique_ips,
    MIN(event_time) as first_occurrence,
    MAX(event_time) as last_occurrence
FROM agent_audit_logs
WHERE event_category = 'security'
AND event_time > NOW() - INTERVAL '24 hours'
GROUP BY event_type
ORDER BY event_count DESC;

-- View: User activity summary
CREATE OR REPLACE VIEW v_user_activity_summary AS
SELECT
    user_id,
    user_email,
    org_id,
    COUNT(*) as total_events,
    COUNT(*) FILTER (WHERE event_category = 'chat') as chat_events,
    COUNT(*) FILTER (WHERE event_category = 'tool') as tool_events,
    COUNT(*) FILTER (WHERE status = 'failure') as failed_events,
    MIN(event_time) as first_activity,
    MAX(event_time) as last_activity
FROM agent_audit_logs
WHERE event_time > NOW() - INTERVAL '30 days'
GROUP BY user_id, user_email, org_id;

-- View: Tool usage statistics
CREATE OR REPLACE VIEW v_tool_usage_stats AS
SELECT
    metadata->>'tool_name' as tool_name,
    COUNT(*) as total_requests,
    COUNT(*) FILTER (WHERE event_type = 'tool.approved') as approved,
    COUNT(*) FILTER (WHERE event_type = 'tool.denied') as denied,
    COUNT(*) FILTER (WHERE event_type = 'tool.completed') as completed,
    COUNT(*) FILTER (WHERE event_type = 'tool.error') as errors,
    AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) as avg_duration_ms
FROM agent_audit_logs
WHERE event_category = 'tool'
AND event_time > NOW() - INTERVAL '30 days'
GROUP BY metadata->>'tool_name'
ORDER BY total_requests DESC;

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE agent_audit_logs IS 'Audit log for AI Agent actions following OWASP and AWS CloudTrail best practices';
COMMENT ON COLUMN agent_audit_logs.event_id IS 'Unique event identifier for deduplication';
COMMENT ON COLUMN agent_audit_logs.event_type IS 'Event type in format category.action (e.g., tool.executed)';
COMMENT ON COLUMN agent_audit_logs.event_category IS 'High-level category: session, chat, tool, security';
COMMENT ON COLUMN agent_audit_logs.request_params IS 'Sanitized request parameters (sensitive data redacted)';
COMMENT ON COLUMN agent_audit_logs.status IS 'Outcome: success, failure, or pending';
