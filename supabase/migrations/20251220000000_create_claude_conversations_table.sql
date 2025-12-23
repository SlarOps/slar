-- Migration: Create claude_conversations table for chat history persistence
-- This enables users to resume previous AI conversations

CREATE TABLE IF NOT EXISTS claude_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL UNIQUE,  -- Claude SDK session_id returned from init
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT,  -- Auto-generated from first message or user can edit
    first_message TEXT,  -- First user prompt for preview
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    message_count INTEGER DEFAULT 1,
    model TEXT DEFAULT 'sonnet',  -- Model used for conversation
    workspace_path TEXT,  -- User's workspace path when conversation started
    metadata JSONB DEFAULT '{}',  -- Additional metadata (org_id, project_id, etc.)
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_claude_conversations_user_id ON claude_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_claude_conversations_conversation_id ON claude_conversations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_claude_conversations_user_last_message ON claude_conversations(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_claude_conversations_archived ON claude_conversations(user_id, is_archived) WHERE is_archived = FALSE;

-- Enable RLS
ALTER TABLE claude_conversations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own conversations
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'claude_conversations' AND policyname = 'Users can view own conversations') THEN
        CREATE POLICY "Users can view own conversations" ON claude_conversations FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'claude_conversations' AND policyname = 'Users can insert own conversations') THEN
        CREATE POLICY "Users can insert own conversations" ON claude_conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'claude_conversations' AND policyname = 'Users can update own conversations') THEN
        CREATE POLICY "Users can update own conversations" ON claude_conversations FOR UPDATE USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'claude_conversations' AND policyname = 'Users can delete own conversations') THEN
        CREATE POLICY "Users can delete own conversations" ON claude_conversations FOR DELETE USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'claude_conversations' AND policyname = 'Service role bypass') THEN
        CREATE POLICY "Service role bypass" ON claude_conversations FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_claude_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_claude_conversations_updated_at ON claude_conversations;
CREATE TRIGGER trigger_claude_conversations_updated_at
    BEFORE UPDATE ON claude_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_claude_conversations_updated_at();

-- Comment for documentation
COMMENT ON TABLE claude_conversations IS 'Stores Claude AI conversation metadata for resume functionality';
COMMENT ON COLUMN claude_conversations.conversation_id IS 'Claude SDK session_id returned from system init message';
COMMENT ON COLUMN claude_conversations.title IS 'Auto-generated from first message, user can edit';
COMMENT ON COLUMN claude_conversations.first_message IS 'First user prompt for preview in conversation list';
