-- Migration: Add Organization/Tenant Isolation
-- This migration implements multi-tenant isolation by adding organization_id to all resource tables
-- Pattern: Denormalized org_id for security, RLS simplicity, and query performance

-- ============================================================================
-- STEP 1: Create Organizations Table (Tenant Container)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    settings JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_active ON public.organizations(is_active);

COMMENT ON TABLE public.organizations IS 'Top-level tenant container for multi-tenant isolation';

-- ============================================================================
-- STEP 2: Create Projects Table (Resource Container within Org)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    settings JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL,

    CONSTRAINT fk_projects_organization
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_organization ON public.projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON public.projects(organization_id, slug);
CREATE INDEX IF NOT EXISTS idx_projects_active ON public.projects(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_unique_slug_per_org ON public.projects(organization_id, slug) WHERE is_active = true;

COMMENT ON TABLE public.projects IS 'Projects within organizations - groups, services, incidents belong to projects';

-- ============================================================================
-- STEP 3: Create Memberships Table (ReBAC)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    resource_type TEXT NOT NULL,  -- 'org' or 'project'
    resource_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',  -- owner, admin, member, viewer
    invited_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_memberships_user
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT valid_resource_type CHECK (resource_type IN ('org', 'project')),
    CONSTRAINT valid_role CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_unique ON public.memberships(user_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_resource ON public.memberships(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_memberships_role ON public.memberships(role);

COMMENT ON TABLE public.memberships IS 'User membership in orgs and projects with role-based access';

-- ============================================================================
-- STEP 4: Add organization_id to Groups (Teams)
-- ============================================================================
ALTER TABLE public.groups
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS project_id UUID;

-- Add indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_groups_organization ON public.groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_groups_project ON public.groups(project_id);

-- Add foreign key constraints (deferred to allow migration of existing data)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_groups_organization') THEN
        ALTER TABLE public.groups
            ADD CONSTRAINT fk_groups_organization
            FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_groups_project') THEN
        ALTER TABLE public.groups
            ADD CONSTRAINT fk_groups_project
            FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================================
-- STEP 5: Add organization_id to Services
-- ============================================================================
ALTER TABLE public.services
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS project_id UUID;

CREATE INDEX IF NOT EXISTS idx_services_organization ON public.services(organization_id);
CREATE INDEX IF NOT EXISTS idx_services_project ON public.services(project_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_services_organization') THEN
        ALTER TABLE public.services
            ADD CONSTRAINT fk_services_organization
            FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_services_project') THEN
        ALTER TABLE public.services
            ADD CONSTRAINT fk_services_project
            FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================================
-- STEP 6: Add organization_id to Escalation Policies
-- ============================================================================
ALTER TABLE public.escalation_policies
    ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_escalation_policies_organization ON public.escalation_policies(organization_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_escalation_policies_organization') THEN
        ALTER TABLE public.escalation_policies
            ADD CONSTRAINT fk_escalation_policies_organization
            FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- STEP 7: Add organization_id to Schedulers
-- ============================================================================
ALTER TABLE public.schedulers
    ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_schedulers_organization ON public.schedulers(organization_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_schedulers_organization') THEN
        ALTER TABLE public.schedulers
            ADD CONSTRAINT fk_schedulers_organization
            FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- STEP 8: Add organization_id to Shifts
-- ============================================================================
ALTER TABLE public.shifts
    ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_shifts_organization ON public.shifts(organization_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_shifts_organization') THEN
        ALTER TABLE public.shifts
            ADD CONSTRAINT fk_shifts_organization
            FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- STEP 9: Add organization_id to Incidents
-- ============================================================================
ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS project_id UUID;

CREATE INDEX IF NOT EXISTS idx_incidents_organization ON public.incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_incidents_project ON public.incidents(project_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_incidents_organization') THEN
        ALTER TABLE public.incidents
            ADD CONSTRAINT fk_incidents_organization
            FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_incidents_project') THEN
        ALTER TABLE public.incidents
            ADD CONSTRAINT fk_incidents_project
            FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================================
-- STEP 10: Add organization_id to Integrations
-- ============================================================================
ALTER TABLE public.integrations
    ADD COLUMN IF NOT EXISTS organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_integrations_organization ON public.integrations(organization_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_integrations_organization') THEN
        ALTER TABLE public.integrations
            ADD CONSTRAINT fk_integrations_organization
            FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- STEP 12: Create Default Organization for Existing Data Migration
-- ============================================================================
-- This creates a default org and assigns all existing data to it
-- Run this AFTER the schema changes above

-- Create default organization if it doesn't exist
INSERT INTO public.organizations (id, name, slug, description)
SELECT
    '00000000-0000-0000-0000-000000000001'::UUID,
    'Default Organization',
    'default',
    'Default organization for migrated data'
WHERE NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE slug = 'default'
);

-- Create default project if it doesn't exist
INSERT INTO public.projects (id, organization_id, name, slug, description)
SELECT
    '00000000-0000-0000-0000-000000000002'::UUID,
    '00000000-0000-0000-0000-000000000001'::UUID,
    'Default Project',
    'default',
    'Default project for migrated data'
WHERE NOT EXISTS (
    SELECT 1 FROM public.projects WHERE slug = 'default'
    AND organization_id = '00000000-0000-0000-0000-000000000001'::UUID
);

-- ============================================================================
-- STEP 13: Migrate Existing Data to Default Organization
-- ============================================================================
-- Update all existing records that have NULL organization_id

UPDATE public.groups
SET organization_id = '00000000-0000-0000-0000-000000000001'::UUID,
    project_id = '00000000-0000-0000-0000-000000000002'::UUID
WHERE organization_id IS NULL;

UPDATE public.services
SET organization_id = '00000000-0000-0000-0000-000000000001'::UUID,
    project_id = '00000000-0000-0000-0000-000000000002'::UUID
WHERE organization_id IS NULL;

UPDATE public.escalation_policies
SET organization_id = '00000000-0000-0000-0000-000000000001'::UUID
WHERE organization_id IS NULL;

UPDATE public.schedulers
SET organization_id = '00000000-0000-0000-0000-000000000001'::UUID
WHERE organization_id IS NULL;

UPDATE public.shifts
SET organization_id = '00000000-0000-0000-0000-000000000001'::UUID
WHERE organization_id IS NULL;

UPDATE public.incidents
SET organization_id = '00000000-0000-0000-0000-000000000001'::UUID,
    project_id = '00000000-0000-0000-0000-000000000002'::UUID
WHERE organization_id IS NULL;

UPDATE public.integrations
SET organization_id = '00000000-0000-0000-0000-000000000001'::UUID
WHERE organization_id IS NULL;

-- ============================================================================
-- STEP 14: Make organization_id NOT NULL (after data migration)
-- ============================================================================
-- Uncomment these after verifying all data has been migrated:
-- ALTER TABLE public.groups ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE public.services ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE public.escalation_policies ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE public.schedulers ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE public.shifts ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE public.incidents ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE public.integrations ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================================
-- STEP 15: Create Trigger for Auto-Propagating organization_id
-- ============================================================================
-- This trigger automatically sets organization_id based on group_id when inserting

CREATE OR REPLACE FUNCTION propagate_organization_id_from_group()
RETURNS TRIGGER AS $$
BEGIN
    -- If organization_id is not set but group_id is, get org from group
    IF NEW.organization_id IS NULL AND NEW.group_id IS NOT NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.groups
        WHERE id = NEW.group_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to incidents
DROP TRIGGER IF EXISTS trigger_incidents_propagate_org ON public.incidents;
CREATE TRIGGER trigger_incidents_propagate_org
    BEFORE INSERT ON public.incidents
    FOR EACH ROW
    EXECUTE FUNCTION propagate_organization_id_from_group();

-- Apply trigger to services
DROP TRIGGER IF EXISTS trigger_services_propagate_org ON public.services;
CREATE TRIGGER trigger_services_propagate_org
    BEFORE INSERT ON public.services
    FOR EACH ROW
    EXECUTE FUNCTION propagate_organization_id_from_group();

-- Apply trigger to escalation_policies
DROP TRIGGER IF EXISTS trigger_escalation_policies_propagate_org ON public.escalation_policies;
CREATE TRIGGER trigger_escalation_policies_propagate_org
    BEFORE INSERT ON public.escalation_policies
    FOR EACH ROW
    EXECUTE FUNCTION propagate_organization_id_from_group();

-- Apply trigger to schedulers
DROP TRIGGER IF EXISTS trigger_schedulers_propagate_org ON public.schedulers;
CREATE TRIGGER trigger_schedulers_propagate_org
    BEFORE INSERT ON public.schedulers
    FOR EACH ROW
    EXECUTE FUNCTION propagate_organization_id_from_group();

-- Apply trigger to shifts
DROP TRIGGER IF EXISTS trigger_shifts_propagate_org ON public.shifts;
CREATE TRIGGER trigger_shifts_propagate_org
    BEFORE INSERT ON public.shifts
    FOR EACH ROW
    EXECUTE FUNCTION propagate_organization_id_from_group();

-- ============================================================================
-- STEP 16: Update Timestamps Trigger for New Tables
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_organizations_updated_at ON public.organizations;
CREATE TRIGGER trigger_organizations_updated_at
    BEFORE UPDATE ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_projects_updated_at ON public.projects;
CREATE TRIGGER trigger_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_memberships_updated_at ON public.memberships;
CREATE TRIGGER trigger_memberships_updated_at
    BEFORE UPDATE ON public.memberships
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON COLUMN public.groups.organization_id IS 'Tenant isolation - all groups belong to an organization';
COMMENT ON COLUMN public.groups.project_id IS 'Project grouping within organization';
COMMENT ON COLUMN public.services.organization_id IS 'Tenant isolation - denormalized for RLS and query performance';
COMMENT ON COLUMN public.incidents.organization_id IS 'Tenant isolation - critical for incident data security';
