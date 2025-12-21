-- Migration: Create conversation_shares table for public share links
-- Enables sharing AI conversation analysis via public links with expiry

CREATE TABLE IF NOT EXISTS conversation_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES claude_conversations(id) ON DELETE CASCADE,
    share_token VARCHAR(64) UNIQUE NOT NULL,

    -- Who created the share
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Expiry (NULL = never expires, but we'll set default 7 days in app)
    expires_at TIMESTAMPTZ,

    -- Optional metadata
    title VARCHAR(255),  -- Custom title for shared view
    description TEXT,    -- Optional description/context

    -- Analytics
    view_count INTEGER DEFAULT 0,
    last_viewed_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversation_shares_token ON conversation_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_conversation_shares_conversation ON conversation_shares(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_shares_created_by ON conversation_shares(created_by);
CREATE INDEX IF NOT EXISTS idx_conversation_shares_expires ON conversation_shares(expires_at) WHERE expires_at IS NOT NULL;

-- No RLS - public shares are accessible by anyone with the token
-- The share endpoint will handle expiry checks
ALTER TABLE conversation_shares ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage their own shares
DO $$
BEGIN
    -- Public read access - share_token acts as authentication
    -- This allows Go backend (direct PostgreSQL connection) to read shares
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_shares' AND policyname = 'Public can view shares by token') THEN
        CREATE POLICY "Public can view shares by token" ON conversation_shares FOR SELECT USING (true);
    END IF;

    -- Authenticated users can create shares for themselves
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_shares' AND policyname = 'Users can create shares') THEN
        CREATE POLICY "Users can create shares" ON conversation_shares FOR INSERT WITH CHECK (auth.uid() = created_by);
    END IF;

    -- Authenticated users can delete their own shares
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_shares' AND policyname = 'Users can delete own shares') THEN
        CREATE POLICY "Users can delete own shares" ON conversation_shares FOR DELETE USING (auth.uid() = created_by);
    END IF;

    -- Allow UPDATE for view_count increment (by anyone with token)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_shares' AND policyname = 'Public can update view count') THEN
        CREATE POLICY "Public can update view count" ON conversation_shares FOR UPDATE USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Function to generate secure share token
CREATE OR REPLACE FUNCTION generate_share_token()
RETURNS VARCHAR(64) AS $$
DECLARE
    token VARCHAR(64);
BEGIN
    -- Generate URL-safe base64 token (32 bytes = 43 chars base64)
    token := encode(gen_random_bytes(24), 'base64');
    -- Replace URL-unsafe chars
    token := replace(replace(token, '+', '-'), '/', '_');
    -- Remove padding
    token := rtrim(token, '=');
    RETURN token;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE conversation_shares IS 'Public share links for AI conversations with optional expiry';
COMMENT ON COLUMN conversation_shares.share_token IS 'URL-safe token for public access';
COMMENT ON COLUMN conversation_shares.expires_at IS 'NULL means no expiry, otherwise link expires at this time';
