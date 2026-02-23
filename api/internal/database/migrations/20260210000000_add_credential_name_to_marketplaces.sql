-- Add credential_name column to marketplaces table
-- Allows users to specify which Vault credential to use for private repo access
ALTER TABLE public.marketplaces ADD COLUMN IF NOT EXISTS credential_name TEXT;

COMMENT ON COLUMN public.marketplaces.credential_name IS 'Name of Vault credential used for private repository access';
