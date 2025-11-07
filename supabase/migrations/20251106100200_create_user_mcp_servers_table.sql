-- Create user_mcp_servers table to store MCP server configurations
-- Replaces file-based .mcp.json with PostgreSQL for instant access (no S3 lag)

CREATE TABLE IF NOT EXISTS user_mcp_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    server_name TEXT NOT NULL,

    -- MCP server type: stdio (command-based), sse (server-sent events), http (HTTP API)
    server_type TEXT NOT NULL DEFAULT 'stdio',

    -- For stdio servers (command-based)
    command TEXT,
    args JSONB DEFAULT '[]',
    env JSONB DEFAULT '{}',

    -- For sse/http servers (URL-based)
    url TEXT,
    headers JSONB DEFAULT '{}',

    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint: one config per server per user
    CONSTRAINT unique_user_mcp_server UNIQUE (user_id, server_name),

    -- Check constraints to ensure valid configuration per type
    CONSTRAINT valid_stdio_config CHECK (
        server_type != 'stdio' OR (command IS NOT NULL)
    ),
    CONSTRAINT valid_url_config CHECK (
        server_type = 'stdio' OR (url IS NOT NULL)
    )
);

-- Index for fast lookups by user_id
CREATE INDEX idx_user_mcp_servers_user_id ON user_mcp_servers(user_id);

-- Index for active servers
CREATE INDEX idx_user_mcp_servers_status ON user_mcp_servers(user_id, status);

-- Add RLS policies
ALTER TABLE user_mcp_servers ENABLE ROW LEVEL SECURITY;

-- Users can only see their own MCP servers
CREATE POLICY "Users can view own MCP servers"
    ON user_mcp_servers FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own MCP servers
CREATE POLICY "Users can insert own MCP servers"
    ON user_mcp_servers FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own MCP servers
CREATE POLICY "Users can update own MCP servers"
    ON user_mcp_servers FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own MCP servers
CREATE POLICY "Users can delete own MCP servers"
    ON user_mcp_servers FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger to update updated_at on row update
CREATE TRIGGER update_user_mcp_servers_updated_at
    BEFORE UPDATE ON user_mcp_servers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE user_mcp_servers IS 'Stores MCP server configurations per user (replaces .mcp.json file)';
COMMENT ON COLUMN user_mcp_servers.server_name IS 'Unique name for the MCP server (e.g., "context7", "incident_tools")';
COMMENT ON COLUMN user_mcp_servers.server_type IS 'Server type: stdio (command), sse (server-sent events), http (HTTP API)';
COMMENT ON COLUMN user_mcp_servers.command IS 'Command to execute (stdio only, e.g., "npx", "python")';
COMMENT ON COLUMN user_mcp_servers.args IS 'Array of command arguments as JSONB (stdio only)';
COMMENT ON COLUMN user_mcp_servers.env IS 'Environment variables as JSONB object (stdio only)';
COMMENT ON COLUMN user_mcp_servers.url IS 'Server URL (sse/http only, e.g., "https://api.example.com/mcp")';
COMMENT ON COLUMN user_mcp_servers.headers IS 'HTTP headers as JSONB object (sse/http only, e.g., {"Authorization": "Bearer token"})';
COMMENT ON COLUMN user_mcp_servers.status IS 'Status: active, disabled';
