-- Create claude_memory table for storing CLAUDE.md content per user
CREATE TABLE IF NOT EXISTS public.claude_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure one record per user
    UNIQUE(user_id)
);

-- Create index for faster user lookups
CREATE INDEX idx_claude_memory_user_id ON public.claude_memory(user_id);

-- Enable RLS (Row Level Security)
ALTER TABLE public.claude_memory ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own memory
CREATE POLICY "Users can view their own memory"
    ON public.claude_memory
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can only insert their own memory
CREATE POLICY "Users can insert their own memory"
    ON public.claude_memory
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only update their own memory
CREATE POLICY "Users can update their own memory"
    ON public.claude_memory
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only delete their own memory
CREATE POLICY "Users can delete their own memory"
    ON public.claude_memory
    FOR DELETE
    USING (auth.uid() = user_id);

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

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claude_memory TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Comment for documentation
COMMENT ON TABLE public.claude_memory IS 'Stores CLAUDE.md content (memory/context) for each user';
COMMENT ON COLUMN public.claude_memory.content IS 'Markdown content of CLAUDE.md file';
COMMENT ON COLUMN public.claude_memory.updated_at IS 'Automatically updated on each content change';
