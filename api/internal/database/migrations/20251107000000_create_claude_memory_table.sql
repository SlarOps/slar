-- Create claude_memory table for storing CLAUDE.md content per user
CREATE TABLE IF NOT EXISTS public.claude_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL DEFAULT 'local', -- 'local' or 'user'
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure one record per user per scope
    UNIQUE(user_id, scope)
);

-- Create index for faster user lookups
CREATE INDEX idx_claude_memory_user_id ON public.claude_memory(user_id);
CREATE INDEX idx_claude_memory_user_scope ON public.claude_memory(user_id, scope);

-- NOTE: RLS disabled - authorization handled at application level (Go/Python API)
-- ALTER TABLE public.claude_memory ENABLE ROW LEVEL SECURITY;

-- RLS Policies removed - using OIDC auth, not Supabase auth
-- Authorization is enforced by API via user_id filtering

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_claude_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at on UPDATE
CREATE TRIGGER claude_memory_updated_at_trigger
    BEFORE UPDATE ON public.claude_memory
    FOR EACH ROW
    EXECUTE FUNCTION update_claude_memory_updated_at();

-- Comment for documentation
COMMENT ON TABLE public.claude_memory IS 'Stores CLAUDE.md content (memory/context) for each user';
COMMENT ON COLUMN public.claude_memory.scope IS 'Memory scope: local (workspace) or user (global)';
COMMENT ON COLUMN public.claude_memory.content IS 'Markdown content of CLAUDE.md file';
COMMENT ON COLUMN public.claude_memory.updated_at IS 'Automatically updated on each content change';
