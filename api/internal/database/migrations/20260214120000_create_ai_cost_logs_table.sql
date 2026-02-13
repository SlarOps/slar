-- AI Cost Logs Table for tracking Claude Agent SDK usage costs
-- Following SDK best practices: tracks AssistantMessage usage with message ID deduplication
CREATE TABLE ai_cost_logs (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Tenant Context (ReBAC)
    user_id UUID NOT NULL,
    org_id UUID,
    project_id UUID,

    -- Session Context
    session_id UUID,
    conversation_id UUID,

    -- SDK Message Info (for deduplication)
    message_id TEXT NOT NULL,  -- SDK AssistantMessage.id (same ID = same usage)

    -- Model & Request Info
    model TEXT NOT NULL,
    request_type TEXT NOT NULL DEFAULT 'chat',  -- 'chat', 'tool', 'memory'
    step_number INTEGER DEFAULT 1,  -- Step number in conversation

    -- Token Usage (from AssistantMessage.usage)
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_input_tokens INTEGER DEFAULT 0,
    cache_read_input_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,

    -- Cost (calculated from usage)
    total_cost_usd DECIMAL(20, 10) NOT NULL DEFAULT 0,

    -- Metadata
    usage_metadata JSONB,  -- Full usage object from SDK AssistantMessage
    metadata JSONB         -- Additional context
);

-- Indexes for common queries
CREATE INDEX idx_cost_logs_user_time ON ai_cost_logs(user_id, created_at DESC);
CREATE INDEX idx_cost_logs_org_time ON ai_cost_logs(org_id, created_at DESC);
CREATE INDEX idx_cost_logs_project_time ON ai_cost_logs(project_id, created_at DESC);
CREATE INDEX idx_cost_logs_model ON ai_cost_logs(model, created_at DESC);
CREATE INDEX idx_cost_logs_session ON ai_cost_logs(session_id);
CREATE INDEX idx_cost_logs_conversation ON ai_cost_logs(conversation_id);
CREATE INDEX idx_cost_logs_message_id ON ai_cost_logs(message_id);  -- For deduplication checks

-- View for cost summary by user
CREATE OR REPLACE VIEW v_user_cost_summary AS
SELECT
    user_id,
    org_id,
    project_id,
    model,
    DATE_TRUNC('day', created_at) as date,
    COUNT(*) as total_requests,
    COUNT(DISTINCT message_id) as unique_messages,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens,
    SUM(total_cost_usd) as total_cost,
    AVG(total_cost_usd) as avg_cost_per_request
FROM ai_cost_logs
GROUP BY user_id, org_id, project_id, model, DATE_TRUNC('day', created_at);
