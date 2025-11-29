-- Create mobile_sessions table for storing mobile app connections
CREATE TABLE IF NOT EXISTS mobile_sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id TEXT,
    access_token_hash TEXT NOT NULL,
    refresh_token_hash TEXT NOT NULL,
    device_info JSONB DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint for user + device combination
    CONSTRAINT unique_user_device UNIQUE (user_id, device_id)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_mobile_sessions_user_id ON mobile_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_sessions_expires_at ON mobile_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_mobile_sessions_device_id ON mobile_sessions(device_id);

-- Add RLS policies
ALTER TABLE mobile_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own sessions
CREATE POLICY "Users can view own mobile sessions" ON mobile_sessions
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own sessions
CREATE POLICY "Users can create own mobile sessions" ON mobile_sessions
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own sessions
CREATE POLICY "Users can update own mobile sessions" ON mobile_sessions
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own sessions
CREATE POLICY "Users can delete own mobile sessions" ON mobile_sessions
    FOR DELETE
    USING (auth.uid() = user_id);

-- Service role can manage all sessions (for backend operations)
CREATE POLICY "Service role can manage all mobile sessions" ON mobile_sessions
    FOR ALL
    USING (auth.role() = 'service_role');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_mobile_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_update_mobile_sessions_updated_at ON mobile_sessions;
CREATE TRIGGER trigger_update_mobile_sessions_updated_at
    BEFORE UPDATE ON mobile_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_mobile_sessions_updated_at();

-- Add comment
COMMENT ON TABLE mobile_sessions IS 'Stores mobile app session tokens for push notification registration';
