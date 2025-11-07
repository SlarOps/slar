-- Create installed_plugins table for fast metadata queries
-- Replaces .claude/plugins/installed_plugins.json file in S3
-- S3 is still used for actual plugin files

-- Installed plugins table
CREATE TABLE IF NOT EXISTS public.installed_plugins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Plugin identification
    plugin_name TEXT NOT NULL,
    marketplace_id UUID REFERENCES public.marketplaces(id) ON DELETE CASCADE,
    marketplace_name TEXT NOT NULL,

    -- Plugin metadata
    version TEXT DEFAULT 'unknown',
    install_path TEXT NOT NULL, -- S3 path to plugin files
    display_name TEXT,
    description TEXT,

    -- Status and configuration
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'installing', 'error')),
    is_local BOOLEAN DEFAULT false,

    -- Git metadata
    git_commit_sha TEXT,

    -- Timestamps
    installed_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: one plugin per user per (plugin_name, marketplace_name) combination
    UNIQUE(user_id, plugin_name, marketplace_name)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_installed_plugins_user_id ON public.installed_plugins(user_id);
CREATE INDEX IF NOT EXISTS idx_installed_plugins_marketplace_id ON public.installed_plugins(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_installed_plugins_status ON public.installed_plugins(status);
CREATE INDEX IF NOT EXISTS idx_installed_plugins_user_status ON public.installed_plugins(user_id, status);
CREATE INDEX IF NOT EXISTS idx_installed_plugins_user_marketplace ON public.installed_plugins(user_id, marketplace_name);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_installed_plugins_last_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_installed_plugins_last_updated
    BEFORE UPDATE ON public.installed_plugins
    FOR EACH ROW
    EXECUTE FUNCTION update_installed_plugins_last_updated();

-- RLS Policies
ALTER TABLE public.installed_plugins ENABLE ROW LEVEL SECURITY;

-- Users can view their own installed plugins
CREATE POLICY "Users can view own installed plugins"
    ON public.installed_plugins
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own installed plugins
CREATE POLICY "Users can insert own installed plugins"
    ON public.installed_plugins
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own installed plugins
CREATE POLICY "Users can update own installed plugins"
    ON public.installed_plugins
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own installed plugins
CREATE POLICY "Users can delete own installed plugins"
    ON public.installed_plugins
    FOR DELETE
    USING (auth.uid() = user_id);

-- View for easier querying with marketplace info
CREATE OR REPLACE VIEW public.installed_plugins_with_marketplace AS
SELECT
    ip.*,
    m.name as marketplace_display_name,
    m.repository_url,
    m.status as marketplace_status
FROM public.installed_plugins ip
LEFT JOIN public.marketplaces m ON ip.marketplace_id = m.id;

-- Grant access to view
GRANT SELECT ON public.installed_plugins_with_marketplace TO authenticated;

-- Comment
COMMENT ON TABLE public.installed_plugins IS 'Stores installed plugin metadata for fast queries. Replaces .claude/plugins/installed_plugins.json';
COMMENT ON COLUMN public.installed_plugins.marketplace_id IS 'Foreign key to marketplaces table';
COMMENT ON COLUMN public.installed_plugins.install_path IS 'S3 path to plugin files directory';
COMMENT ON VIEW public.installed_plugins_with_marketplace IS 'Convenient view with marketplace information joined';
