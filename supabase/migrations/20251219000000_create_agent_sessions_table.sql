-- Migration: Create agent_sessions and agent_nonces tables for Zero-Trust persistence
-- This fixes the issue where AI API restart causes all sessions to be lost

-- Agent Sessions table - stores verified Zero-Trust sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id UUID PRIMARY KEY,
    cert_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    permissions TEXT[] DEFAULT ARRAY['chat'],
    device_public_key TEXT NOT NULL,  -- Base64 encoded Ed25519 public key
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_cert_id ON agent_sessions(cert_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_active ON agent_sessions(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_agent_sessions_expires ON agent_sessions(expires_at);

-- Agent Nonces table - prevents replay attacks
-- Stores used nonces per certificate
CREATE TABLE IF NOT EXISTS agent_nonces (
    id BIGSERIAL PRIMARY KEY,
    cert_id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    used_at TIMESTAMPTZ DEFAULT NOW(),
    -- Unique constraint to prevent replay
    CONSTRAINT unique_cert_nonce UNIQUE (cert_id, nonce)
);

-- Index for fast nonce lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_agent_nonces_cert_id ON agent_nonces(cert_id);
CREATE INDEX IF NOT EXISTS idx_agent_nonces_used_at ON agent_nonces(used_at);

-- Instance public key cache table
CREATE TABLE IF NOT EXISTS agent_instance_keys (
    instance_id TEXT PRIMARY KEY,
    public_key_pem TEXT NOT NULL,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Function to clean up expired sessions (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_agent_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete expired sessions
    DELETE FROM agent_sessions WHERE expires_at < NOW() OR is_active = FALSE;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Delete old nonces (older than 5 minutes)
    DELETE FROM agent_nonces WHERE used_at < NOW() - INTERVAL '5 minutes';

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comment for documentation
COMMENT ON TABLE agent_sessions IS 'Zero-Trust verified sessions for AI Agent WebSocket connections';
COMMENT ON TABLE agent_nonces IS 'Used nonces for replay attack prevention in Zero-Trust auth';
COMMENT ON TABLE agent_instance_keys IS 'Cached instance public keys for certificate verification';
