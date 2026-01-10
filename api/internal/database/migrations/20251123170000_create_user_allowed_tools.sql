-- Create user_allowed_tools table to store tools that are always allowed for a user
CREATE TABLE IF NOT EXISTS user_allowed_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    tool_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint: one entry per tool per user
    CONSTRAINT unique_user_allowed_tool UNIQUE (user_id, tool_name)
);

-- Index for fast lookups by user_id
CREATE INDEX idx_user_allowed_tools_user_id ON user_allowed_tools(user_id);

-- NOTE: RLS disabled - authorization handled at application level (Go/Python API)
-- ALTER TABLE user_allowed_tools ENABLE ROW LEVEL SECURITY;

-- RLS Policies removed - using OIDC auth, not Supabase auth
-- Authorization is enforced by API via user_id filtering

-- Comments
COMMENT ON TABLE user_allowed_tools IS 'Stores tools that are always allowed for a user without prompting';
COMMENT ON COLUMN user_allowed_tools.tool_name IS 'Name of the tool (e.g., "WebSearch", "incident_tools")';
