-- Migration: Organization Isolation Helper Functions
-- This migration provides helper functions for authorization checks
-- NOTE: RLS is DISABLED - Authorization is handled at application level (Go API)
-- 
-- REASON: We use OIDC auth (Keycloak, Auth0, etc.), not Supabase auth.
-- The auth.uid() function only works with Supabase Auth, not plain PostgreSQL.
-- Go API performs authorization checks using these helper functions directly.

-- ============================================================================
-- HELPER FUNCTIONS (Called by Go API for authorization)
-- ============================================================================

-- Get all organization IDs that a user has membership in
CREATE OR REPLACE FUNCTION public.get_user_organizations(p_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT resource_id
    FROM public.memberships
    WHERE user_id = p_user_id
      AND resource_type = 'org';
$$;

COMMENT ON FUNCTION public.get_user_organizations(UUID) IS 'Returns organization IDs the user has membership in';

-- Get all project IDs that a user has direct membership in
CREATE OR REPLACE FUNCTION public.get_user_projects(p_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT resource_id
    FROM public.memberships
    WHERE user_id = p_user_id
      AND resource_type = 'project';
$$;

COMMENT ON FUNCTION public.get_user_projects(UUID) IS 'Returns project IDs the user has direct membership in';

-- Check if user has access to specific organization
CREATE OR REPLACE FUNCTION public.user_has_org_access(p_user_id UUID, org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships
        WHERE user_id = p_user_id
          AND resource_type = 'org'
          AND resource_id = org_id
    );
$$;

COMMENT ON FUNCTION public.user_has_org_access(UUID, UUID) IS 'Check if user has access to specific organization';

-- ============================================================================
-- RLS DISABLED - Using OIDC Auth
-- ============================================================================
-- The following tables have RLS disabled because authorization is handled
-- at the application level (Go API) using the helper functions above.
--
-- This approach is more flexible for OIDC-based authentication where
-- auth.uid() is not available.

-- Disable RLS on all org-scoped tables (if enabled by previous migrations)

-- Organizations
ALTER TABLE public.organizations DISABLE ROW LEVEL SECURITY;

-- Projects  
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;

-- Memberships
ALTER TABLE public.memberships DISABLE ROW LEVEL SECURITY;

-- Groups
ALTER TABLE public.groups DISABLE ROW LEVEL SECURITY;

-- Group Members (if exists)
DO $$ BEGIN
    ALTER TABLE public.group_members DISABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Services
ALTER TABLE public.services DISABLE ROW LEVEL SECURITY;

-- Incidents
ALTER TABLE public.incidents DISABLE ROW LEVEL SECURITY;

-- Incident Events (if exists)
DO $$ BEGIN
    ALTER TABLE public.incident_events DISABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Escalation Policies
ALTER TABLE public.escalation_policies DISABLE ROW LEVEL SECURITY;

-- Escalation Levels (if exists)
DO $$ BEGIN
    ALTER TABLE public.escalation_levels DISABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Schedulers
ALTER TABLE public.schedulers DISABLE ROW LEVEL SECURITY;

-- Shifts
ALTER TABLE public.shifts DISABLE ROW LEVEL SECURITY;

-- Schedule Overrides (if exists)
DO $$ BEGIN
    ALTER TABLE public.schedule_overrides DISABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Integrations
ALTER TABLE public.integrations DISABLE ROW LEVEL SECURITY;

-- Alert Escalations (if exists)
DO $$ BEGIN
    ALTER TABLE public.alert_escalations DISABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ============================================================================
-- DROP OLD RLS POLICIES (cleanup)
-- ============================================================================
-- These policies used auth.uid() which doesn't work with OIDC

-- Organizations
DROP POLICY IF EXISTS "users_view_own_organizations" ON public.organizations;
DROP POLICY IF EXISTS "admins_update_organizations" ON public.organizations;
DROP POLICY IF EXISTS "owners_delete_organizations" ON public.organizations;
DROP POLICY IF EXISTS "authenticated_users_create_organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can view own organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Org admins can update organizations" ON public.organizations;
DROP POLICY IF EXISTS "Org owners can delete organizations" ON public.organizations;
DROP POLICY IF EXISTS "Service role full access to organizations" ON public.organizations;

-- Projects
DROP POLICY IF EXISTS "users_view_projects" ON public.projects;
DROP POLICY IF EXISTS "admins_update_projects" ON public.projects;
DROP POLICY IF EXISTS "org_admins_create_projects" ON public.projects;
DROP POLICY IF EXISTS "org_owners_delete_projects" ON public.projects;
DROP POLICY IF EXISTS "Users can view accessible projects" ON public.projects;
DROP POLICY IF EXISTS "Org members can create projects" ON public.projects;
DROP POLICY IF EXISTS "Project admins can update projects" ON public.projects;
DROP POLICY IF EXISTS "Service role full access to projects" ON public.projects;

-- Memberships
DROP POLICY IF EXISTS "users_view_memberships" ON public.memberships;
DROP POLICY IF EXISTS "admins_create_memberships" ON public.memberships;
DROP POLICY IF EXISTS "admins_update_memberships" ON public.memberships;
DROP POLICY IF EXISTS "admins_delete_memberships" ON public.memberships;
DROP POLICY IF EXISTS "Users can view own memberships" ON public.memberships;
DROP POLICY IF EXISTS "Org admins can manage memberships" ON public.memberships;
DROP POLICY IF EXISTS "Service role full access to memberships" ON public.memberships;

-- Groups
DROP POLICY IF EXISTS "users_view_groups" ON public.groups;
DROP POLICY IF EXISTS "org_members_create_groups" ON public.groups;
DROP POLICY IF EXISTS "leaders_update_groups" ON public.groups;
DROP POLICY IF EXISTS "admins_delete_groups" ON public.groups;

-- Group Members
DO $$ BEGIN
    DROP POLICY IF EXISTS "users_view_group_members" ON public.group_members;
    DROP POLICY IF EXISTS "leaders_manage_group_members" ON public.group_members;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Services
DROP POLICY IF EXISTS "users_view_services" ON public.services;
DROP POLICY IF EXISTS "org_members_create_services" ON public.services;
DROP POLICY IF EXISTS "admins_update_services" ON public.services;
DROP POLICY IF EXISTS "admins_delete_services" ON public.services;

-- Incidents
DROP POLICY IF EXISTS "users_view_incidents" ON public.incidents;
DROP POLICY IF EXISTS "org_members_create_incidents" ON public.incidents;
DROP POLICY IF EXISTS "members_update_incidents" ON public.incidents;
DROP POLICY IF EXISTS "admins_delete_incidents" ON public.incidents;

-- Incident Events
DO $$ BEGIN
    DROP POLICY IF EXISTS "users_view_incident_events" ON public.incident_events;
    DROP POLICY IF EXISTS "users_create_incident_events" ON public.incident_events;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Escalation Policies
DROP POLICY IF EXISTS "users_view_escalation_policies" ON public.escalation_policies;
DROP POLICY IF EXISTS "admins_manage_escalation_policies" ON public.escalation_policies;

-- Escalation Levels
DO $$ BEGIN
    DROP POLICY IF EXISTS "users_view_escalation_levels" ON public.escalation_levels;
    DROP POLICY IF EXISTS "admins_manage_escalation_levels" ON public.escalation_levels;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Schedulers
DROP POLICY IF EXISTS "users_view_schedulers" ON public.schedulers;
DROP POLICY IF EXISTS "members_manage_schedulers" ON public.schedulers;

-- Shifts
DROP POLICY IF EXISTS "users_view_shifts" ON public.shifts;
DROP POLICY IF EXISTS "members_manage_shifts" ON public.shifts;

-- Schedule Overrides
DO $$ BEGIN
    DROP POLICY IF EXISTS "users_view_schedule_overrides" ON public.schedule_overrides;
    DROP POLICY IF EXISTS "members_manage_schedule_overrides" ON public.schedule_overrides;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Integrations
DROP POLICY IF EXISTS "users_view_integrations" ON public.integrations;
DROP POLICY IF EXISTS "admins_manage_integrations" ON public.integrations;

-- Alert Escalations
DO $$ BEGIN
    DROP POLICY IF EXISTS "users_view_alert_escalations" ON public.alert_escalations;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON FUNCTION public.get_user_organizations(UUID) IS 'Returns organization IDs the user has membership in. Called by Go API for authorization.';
COMMENT ON FUNCTION public.get_user_projects(UUID) IS 'Returns project IDs the user has direct membership in. Called by Go API for authorization.';
COMMENT ON FUNCTION public.user_has_org_access(UUID, UUID) IS 'Check if user has access to specific organization. Called by Go API for authorization.';
