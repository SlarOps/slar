-- Migration: Create claude_messages table for storing conversation messages
-- This enables displaying chat history when resuming conversations

CREATE TABLE IF NOT EXISTS claude_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL,  -- References claude_conversations.conversation_id
    role TEXT NOT NULL,  -- 'user', 'assistant', 'system'
    content TEXT,  -- Message content (text)
    message_type TEXT DEFAULT 'text',  -- 'text', 'tool_use', 'tool_result', 'thinking', 'error'
    tool_name TEXT,  -- Tool name if message_type is tool_use/tool_result
    tool_input JSONB,  -- Tool input if message_type is tool_use
    metadata JSONB DEFAULT '{}',  -- Additional metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_claude_messages_conversation_id ON claude_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_claude_messages_conversation_created ON claude_messages(conversation_id, created_at ASC);

-- Enable RLS
ALTER TABLE claude_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Access via conversation ownership (join with claude_conversations)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'claude_messages' AND policyname = 'Users can view own messages') THEN
        CREATE POLICY "Users can view own messages" ON claude_messages FOR SELECT
        USING (
            EXISTS (
                SELECT 1 FROM claude_conversations c
                WHERE c.conversation_id = claude_messages.conversation_id
                AND c.user_id = auth.uid()
            )
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'claude_messages' AND policyname = 'Service role bypass') THEN
        CREATE POLICY "Service role bypass" ON claude_messages FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Comments
COMMENT ON TABLE claude_messages IS 'Stores individual messages in Claude conversations for history display';
COMMENT ON COLUMN claude_messages.conversation_id IS 'References claude_conversations.conversation_id';
COMMENT ON COLUMN claude_messages.role IS 'Message role: user, assistant, or system';
COMMENT ON COLUMN claude_messages.message_type IS 'Type: text, tool_use, tool_result, thinking, error';
