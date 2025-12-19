-- Migration: Migrate group_members to memberships (Option A - Single Table Strategy)
-- This migration implements ReBAC model by consolidating group_members into memberships table

-- ============================================================================
-- STEP 1: Modify memberships constraint to allow 'group' resource_type
-- ============================================================================
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS valid_resource_type;

ALTER TABLE memberships ADD CONSTRAINT valid_resource_type
    CHECK (resource_type IN ('org', 'project', 'group'));

COMMENT ON TABLE memberships IS 'Unified membership table for organizations, projects, and groups. Supports ReBAC model.';
COMMENT ON COLUMN memberships.resource_type IS 'Type of resource: org, project, or group';

-- ============================================================================
-- STEP 2: Migrate data from group_members to memberships
-- ============================================================================
-- Note: We only migrate the core membership data (user_id, group_id, role)
-- The escalation_order and notification_preferences belong to Scheduler tables, not memberships

INSERT INTO memberships (user_id, resource_type, resource_id, role, created_at, updated_at, invited_by)
SELECT
    gm.user_id,
    'group' AS resource_type,
    gm.group_id AS resource_id,
    -- Map group_members roles to memberships roles
    CASE gm.role
        WHEN 'leader' THEN 'admin'    -- leader maps to admin
        WHEN 'member' THEN 'member'
        ELSE 'member'
    END AS role,
    COALESCE(gm.added_at, NOW()) AS created_at,
    NOW() AS updated_at,
    gm.added_by::UUID AS invited_by
FROM group_members gm
WHERE gm.is_active = true
ON CONFLICT (user_id, resource_type, resource_id) DO NOTHING;

-- ============================================================================
-- STEP 3: Update memberships role constraint to include group roles
-- ============================================================================
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS valid_role;

ALTER TABLE memberships ADD CONSTRAINT valid_role
    CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

-- ============================================================================
-- STEP 4: Create helper function for group membership check
-- ============================================================================
CREATE OR REPLACE FUNCTION user_in_group(p_user_id UUID, p_group_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM memberships
        WHERE user_id = p_user_id
        AND resource_type = 'group'
        AND resource_id = p_group_id
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get user's role in group
CREATE OR REPLACE FUNCTION get_group_role(p_user_id UUID, p_group_id UUID)
RETURNS TEXT AS $$
BEGIN
    RETURN (
        SELECT role FROM memberships
        WHERE user_id = p_user_id
        AND resource_type = 'group'
        AND resource_id = p_group_id
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- STEP 5: Create index for group membership lookup
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_memberships_group_lookup
    ON memberships(resource_id)
    WHERE resource_type = 'group';

-- ============================================================================
-- STEP 6: Add RLS policies for group memberships
-- ============================================================================

-- Drop existing group_members policies if any
DROP POLICY IF EXISTS "Users can view own group memberships" ON memberships;
DROP POLICY IF EXISTS "Group admins can manage group memberships" ON memberships;

-- Update the "Org admins can manage memberships" policy to include groups
DROP POLICY IF EXISTS "Org admins can manage memberships" ON memberships;

CREATE POLICY "Admins can manage memberships" ON memberships
    FOR ALL USING (
        (resource_type = 'org' AND get_org_role(auth.uid(), resource_id) IN ('owner', 'admin'))
        OR
        (resource_type = 'project' AND get_project_role(auth.uid(), resource_id) = 'admin')
        OR
        (resource_type = 'group' AND get_group_role(auth.uid(), resource_id) = 'admin')
    );

-- ============================================================================
-- STEP 7: Verify migration
-- ============================================================================
DO $$
DECLARE
    v_group_members_count INTEGER;
    v_memberships_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_group_members_count FROM group_members WHERE is_active = true;
    SELECT COUNT(*) INTO v_memberships_count FROM memberships WHERE resource_type = 'group';

    RAISE NOTICE 'Migration complete: % active group_members migrated to % memberships',
        v_group_members_count, v_memberships_count;
END $$;

-- ============================================================================
-- NOTE: group_members table is NOT dropped yet for safety
-- After verifying the migration and updating all Go code, run:
-- DROP TABLE group_members;
-- ============================================================================
