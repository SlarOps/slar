-- Create agent_device_certs table for Zero-Trust device authentication
CREATE TABLE IF NOT EXISTS agent_device_certs (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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

-- NOTE: RLS disabled - authorization handled at application level (Go/Python API)
-- Zero-Trust verification happens in the API layer
-- ALTER TABLE agent_device_certs ENABLE ROW LEVEL SECURITY;

-- RLS Policies removed - using OIDC auth, not Supabase auth
-- Device certificate verification is handled by the API

COMMENT ON TABLE agent_device_certs IS 'Zero-Trust device certificates for mobile/agent authentication';
