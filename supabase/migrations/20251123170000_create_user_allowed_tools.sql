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

-- Add RLS policies
ALTER TABLE user_allowed_tools ENABLE ROW LEVEL SECURITY;

-- Users can see their own allowed tools
CREATE POLICY "Users can view own allowed tools"
    ON user_allowed_tools FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own allowed tools
CREATE POLICY "Users can insert own allowed tools"
    ON user_allowed_tools FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own allowed tools
CREATE POLICY "Users can delete own allowed tools"
    ON user_allowed_tools FOR DELETE
    USING (auth.uid() = user_id);

-- Comments
COMMENT ON TABLE user_allowed_tools IS 'Stores tools that are always allowed for a user without prompting';
COMMENT ON COLUMN user_allowed_tools.tool_name IS 'Name of the tool (e.g., "WebSearch", "incident_tools")';
