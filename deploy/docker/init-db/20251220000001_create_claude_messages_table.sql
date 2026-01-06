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

-- NOTE: RLS disabled - authorization handled at application level (Go/Python API)
-- Access control is enforced via conversation ownership check in API
-- ALTER TABLE claude_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies removed - using OIDC auth, not Supabase auth

-- Comments
COMMENT ON TABLE claude_messages IS 'Stores individual messages in Claude conversations for history display';
COMMENT ON COLUMN claude_messages.conversation_id IS 'References claude_conversations.conversation_id';
COMMENT ON COLUMN claude_messages.role IS 'Message role: user, assistant, or system';
COMMENT ON COLUMN claude_messages.message_type IS 'Type: text, tool_use, tool_result, thinking, error';
