-- Add project_id column to integrations table for project-level isolation
-- This allows integrations to be scoped to specific projects within an organization

-- Add project_id column
ALTER TABLE integrations
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Create index for project filtering
CREATE INDEX IF NOT EXISTS idx_integrations_project ON integrations(project_id);

-- Create composite index for org + project filtering
CREATE INDEX IF NOT EXISTS idx_integrations_org_project ON integrations(organization_id, project_id);

-- Update RLS policies to include project-level access
DROP POLICY IF EXISTS "users_view_integrations" ON integrations;
DROP POLICY IF EXISTS "admins_manage_integrations" ON integrations;

-- Policy: Users can view integrations in their org (org-level) or their projects (project-level)
CREATE POLICY "users_view_integrations" ON integrations
FOR SELECT USING (
    -- Org-level integrations (project_id IS NULL) - visible to all org members
    (project_id IS NULL AND organization_id IN (SELECT get_user_organizations()))
    OR
    -- Project-level integrations - visible to project members
    (project_id IS NOT NULL AND project_id IN (
        SELECT resource_id FROM memberships
        WHERE user_id = auth.uid() AND resource_type = 'project'
    ))
);

-- Policy: Admins can manage integrations in their org
CREATE POLICY "admins_manage_integrations" ON integrations
FOR ALL USING (
    organization_id IN (
        SELECT resource_id FROM memberships
        WHERE user_id = auth.uid()
        AND resource_type = 'org'
        AND role IN ('owner', 'admin')
    )
);

COMMENT ON COLUMN integrations.project_id IS 'Optional project scope. NULL means org-level (shared across all projects)';
