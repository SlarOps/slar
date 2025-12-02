-- Create agent_device_certs table for Zero-Trust device authentication
CREATE TABLE IF NOT EXISTS agent_device_certs (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_public_key TEXT NOT NULL,
    instance_id TEXT NOT NULL DEFAULT 'default',
    permissions TEXT[] DEFAULT ARRAY['chat', 'tools'],
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(device_id, user_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_agent_device_certs_user ON agent_device_certs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_device_certs_device ON agent_device_certs(device_id);

-- Enable RLS
ALTER TABLE agent_device_certs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own certificates
CREATE POLICY "Users can view own device certs" ON agent_device_certs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own device certs" ON agent_device_certs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own device certs" ON agent_device_certs
    FOR UPDATE USING (auth.uid() = user_id);
