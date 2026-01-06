-- Migration: Add Organizations, Projects, and Memberships for ReBAC
-- This implements a simple in-process authorization model

-- ============================================================================
-- ORGANIZATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE organizations IS 'Top-level tenant for multi-tenancy. All resources belong to an organization.';

-- ============================================================================
-- PROJECTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(organization_id, slug)
);

COMMENT ON TABLE projects IS 'Logical grouping within an organization. Resources are scoped to projects.';

CREATE INDEX idx_projects_org ON projects(organization_id);

-- ============================================================================
-- MEMBERSHIPS (Single table for both org and project memberships)
-- ============================================================================
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,  -- 'org' or 'project'
    resource_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    invited_by UUID REFERENCES users(id),
    UNIQUE(user_id, resource_type, resource_id),
    CONSTRAINT valid_resource_type CHECK (resource_type IN ('org', 'project')),
    CONSTRAINT valid_role CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);

COMMENT ON TABLE memberships IS 'Unified membership table for organizations and projects. Supports ReBAC model.';
COMMENT ON COLUMN memberships.resource_type IS 'Type of resource: org or project';
COMMENT ON COLUMN memberships.resource_id IS 'ID of the organization or project';
COMMENT ON COLUMN memberships.role IS 'Role: owner (org only), admin, member, viewer';

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_resource ON memberships(resource_type, resource_id);
CREATE INDEX idx_memberships_lookup ON memberships(user_id, resource_type);

-- ============================================================================
-- UPDATE GROUPS TABLE - Add org_id and project_id
-- ============================================================================
ALTER TABLE groups
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_org ON groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_groups_project ON groups(project_id);

-- ============================================================================
-- UPDATE SERVICES TABLE - Add project_id for direct filtering
-- ============================================================================
ALTER TABLE services
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_services_project ON services(project_id);

COMMENT ON COLUMN services.project_id IS 'Direct link to project for filtering. Falls back to group.project_id if NULL.';

-- ============================================================================
-- HELPER FUNCTIONS (used by Go API for authorization checks)
-- ============================================================================

-- Function to check if user belongs to organization
CREATE OR REPLACE FUNCTION user_in_org(p_user_id UUID, p_org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM memberships
        WHERE user_id = p_user_id
        AND resource_type = 'org'
        AND resource_id = p_org_id
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get user's role in organization
CREATE OR REPLACE FUNCTION get_org_role(p_user_id UUID, p_org_id UUID)
RETURNS TEXT AS $$
BEGIN
    RETURN (
        SELECT role FROM memberships
        WHERE user_id = p_user_id
        AND resource_type = 'org'
        AND resource_id = p_org_id
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to check if user can access project
-- Logic: Check explicit project membership first, then inherit from org
CREATE OR REPLACE FUNCTION user_can_access_project(p_user_id UUID, p_project_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_org_id UUID;
    v_has_explicit_members BOOLEAN;
BEGIN
    -- Get org_id from project
    SELECT organization_id INTO v_org_id FROM projects WHERE id = p_project_id;

    IF v_org_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- User must belong to org first
    IF NOT user_in_org(p_user_id, v_org_id) THEN
        RETURN FALSE;
    END IF;

    -- Check if project has explicit members
    SELECT EXISTS (
        SELECT 1 FROM memberships
        WHERE resource_type = 'project' AND resource_id = p_project_id
    ) INTO v_has_explicit_members;

    -- If no explicit members, all org members can access
    IF NOT v_has_explicit_members THEN
        RETURN TRUE;
    END IF;

    -- If has explicit members, user must be one of them
    RETURN EXISTS (
        SELECT 1 FROM memberships
        WHERE user_id = p_user_id
        AND resource_type = 'project'
        AND resource_id = p_project_id
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get user's effective role in project
CREATE OR REPLACE FUNCTION get_project_role(p_user_id UUID, p_project_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_org_id UUID;
    v_explicit_role TEXT;
    v_org_role TEXT;
BEGIN
    -- Check explicit project membership first
    SELECT role INTO v_explicit_role
    FROM memberships
    WHERE user_id = p_user_id
    AND resource_type = 'project'
    AND resource_id = p_project_id;

    IF v_explicit_role IS NOT NULL THEN
        RETURN v_explicit_role;
    END IF;

    -- No explicit role -> inherit from org
    SELECT organization_id INTO v_org_id FROM projects WHERE id = p_project_id;

    SELECT role INTO v_org_role
    FROM memberships
    WHERE user_id = p_user_id
    AND resource_type = 'org'
    AND resource_id = v_org_id;

    -- Map org role to project role
    RETURN CASE v_org_role
        WHEN 'owner' THEN 'admin'
        WHEN 'admin' THEN 'admin'
        WHEN 'member' THEN 'member'
        WHEN 'viewer' THEN 'viewer'
        ELSE NULL
    END;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- TRIGGERS FOR updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_organizations_updated_at ON organizations;
CREATE TRIGGER trigger_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_timestamp();

DROP TRIGGER IF EXISTS trigger_projects_updated_at ON projects;
CREATE TRIGGER trigger_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_timestamp();

DROP TRIGGER IF EXISTS trigger_memberships_updated_at ON memberships;
CREATE TRIGGER trigger_memberships_updated_at
    BEFORE UPDATE ON memberships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_timestamp();

-- ============================================================================
-- RLS DISABLED - Authorization handled at application level (Go API)
-- ============================================================================
-- NOTE: RLS is disabled because we use OIDC auth, not Supabase auth.
-- Authorization is enforced by Go API via membership table queries.
-- This is more flexible and allows the API to handle complex authorization logic.

-- ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- RLS Policies removed - using OIDC auth, not Supabase auth

-- ============================================================================
-- GRANTS (for database roles)
-- ============================================================================
-- Note: These grants are for database roles, not Supabase roles
-- The application connects with a PostgreSQL user that has these privileges
