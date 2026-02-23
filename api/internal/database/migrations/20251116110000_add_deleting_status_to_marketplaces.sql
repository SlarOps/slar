-- Add 'deleting' status to marketplaces table
-- Required for background deletion workflow

-- Drop the old constraint
ALTER TABLE public.marketplaces
DROP CONSTRAINT IF EXISTS marketplaces_status_check;

-- Add new constraint with 'deleting' status
ALTER TABLE public.marketplaces
ADD CONSTRAINT marketplaces_status_check
CHECK (status IN ('active', 'inactive', 'syncing', 'error', 'deleting'));

-- Comment
COMMENT ON COLUMN public.marketplaces.status IS 'Marketplace status: active (ready), inactive (disabled), syncing (fetching data), error (failed), deleting (cleanup in progress)';
