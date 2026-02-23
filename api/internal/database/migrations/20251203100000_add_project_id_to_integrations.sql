-- Add project_id column to integrations table for project-level isolation
-- This allows integrations to be scoped to specific projects within an organization

-- Add project_id column
ALTER TABLE integrations
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Create index for project filtering
CREATE INDEX IF NOT EXISTS idx_integrations_project ON integrations(project_id);

-- Create composite index for org + project filtering
CREATE INDEX IF NOT EXISTS idx_integrations_org_project ON integrations(organization_id, project_id);

-- NOTE: RLS disabled - authorization handled at application level (Go API)
-- Drop old policies that use auth.uid()
DROP POLICY IF EXISTS "users_view_integrations" ON integrations;
DROP POLICY IF EXISTS "admins_manage_integrations" ON integrations;
DROP POLICY IF EXISTS "Users can view integrations in accessible projects" ON integrations;
DROP POLICY IF EXISTS "Users can manage integrations in accessible projects" ON integrations;

-- Authorization is enforced by Go API via org/project membership check

COMMENT ON COLUMN integrations.project_id IS 'Optional project scope. NULL means org-level (shared across all projects)';
