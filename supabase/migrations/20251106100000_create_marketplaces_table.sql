-- Create marketplaces table for fast metadata queries
-- Replaces S3-based metadata storage for instant reads/writes
-- S3 is still used for actual plugin files (ZIP archives)

-- Marketplaces table
CREATE TABLE IF NOT EXISTS public.marketplaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Marketplace identification
    name TEXT NOT NULL,
    repository_url TEXT,
    branch TEXT DEFAULT 'main',

    -- Metadata (from marketplace.json)
    display_name TEXT,
    description TEXT,
    version TEXT,
    plugins JSONB DEFAULT '[]'::jsonb, -- Array of plugin metadata

    -- Storage references
    zip_path TEXT, -- S3 path to ZIP file
    zip_size BIGINT, -- Size in bytes

    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'syncing', 'error')),
    last_synced_at TIMESTAMPTZ,
    sync_error TEXT,

    -- Git metadata
    git_commit_sha TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: one marketplace per user per name
    UNIQUE(user_id, name)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_marketplaces_user_id ON public.marketplaces(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplaces_status ON public.marketplaces(status);
CREATE INDEX IF NOT EXISTS idx_marketplaces_user_status ON public.marketplaces(user_id, status);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_marketplaces_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_marketplaces_updated_at
    BEFORE UPDATE ON public.marketplaces
    FOR EACH ROW
    EXECUTE FUNCTION update_marketplaces_updated_at();

-- RLS Policies
ALTER TABLE public.marketplaces ENABLE ROW LEVEL SECURITY;

-- Users can view their own marketplaces
CREATE POLICY "Users can view own marketplaces"
    ON public.marketplaces
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own marketplaces
CREATE POLICY "Users can insert own marketplaces"
    ON public.marketplaces
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own marketplaces
CREATE POLICY "Users can update own marketplaces"
    ON public.marketplaces
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own marketplaces
CREATE POLICY "Users can delete own marketplaces"
    ON public.marketplaces
    FOR DELETE
    USING (auth.uid() = user_id);

-- Comment
COMMENT ON TABLE public.marketplaces IS 'Stores marketplace metadata for fast queries. Plugin files are stored in S3.';
COMMENT ON COLUMN public.marketplaces.plugins IS 'JSONB array of plugin metadata from marketplace.json';
COMMENT ON COLUMN public.marketplaces.zip_path IS 'S3 storage path to marketplace ZIP file';
