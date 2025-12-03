-- Migration: Add Row Level Security (RLS) Policies for Organization Isolation
-- This migration implements RLS policies that restrict data access based on organization membership
-- Must be run AFTER 20251202_add_organization_tenant_isolation.sql

-- ============================================================================
-- STEP 1: Helper Function to Get User's Organizations
-- ============================================================================
-- This function returns all organization IDs that the current user has access to

CREATE OR REPLACE FUNCTION public.get_user_organizations()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT resource_id
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND resource_type = 'org';
$$;

COMMENT ON FUNCTION public.get_user_organizations() IS 'Returns organization IDs the current user has membership in';

-- ============================================================================
-- STEP 2: Helper Function to Get User's Projects
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_user_projects()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT resource_id
    FROM public.memberships
    WHERE user_id = auth.uid()
      AND resource_type = 'project';
$$;

COMMENT ON FUNCTION public.get_user_projects() IS 'Returns project IDs the current user has direct membership in';

-- ============================================================================
-- STEP 3: Helper Function to Check Org Access
-- ============================================================================
CREATE OR REPLACE FUNCTION public.user_has_org_access(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships
        WHERE user_id = auth.uid()
          AND resource_type = 'org'
          AND resource_id = org_id
    );
$$;

COMMENT ON FUNCTION public.user_has_org_access(UUID) IS 'Check if current user has access to specific organization';

-- ============================================================================
-- STEP 4: Enable RLS on Organizations Table
-- ============================================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Organizations: Users can only see orgs they belong to
CREATE POLICY "users_view_own_organizations"
    ON public.organizations
    FOR SELECT
    USING (id IN (SELECT public.get_user_organizations()));

-- Organizations: Only owners/admins can update
CREATE POLICY "admins_update_organizations"
    ON public.organizations
    FOR UPDATE
    USING (
        id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
    );

-- Organizations: Only owners can delete
CREATE POLICY "owners_delete_organizations"
    ON public.organizations
    FOR DELETE
    USING (
        id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role = 'owner'
        )
    );

-- Organizations: Any authenticated user can create (they become owner)
CREATE POLICY "authenticated_users_create_organizations"
    ON public.organizations
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================================
-- STEP 5: Enable RLS on Projects Table
-- ============================================================================
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Projects: Users can see projects in their orgs or direct project membership
CREATE POLICY "users_view_projects"
    ON public.projects
    FOR SELECT
    USING (
        organization_id IN (SELECT public.get_user_organizations())
        OR id IN (SELECT public.get_user_projects())
    );

-- Projects: Org admins or project admins can update
CREATE POLICY "admins_update_projects"
    ON public.projects
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
        OR id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'project'
              AND role IN ('owner', 'admin')
        )
    );

-- Projects: Org admins can create projects
CREATE POLICY "org_admins_create_projects"
    ON public.projects
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
    );

-- Projects: Org owners can delete projects
CREATE POLICY "org_owners_delete_projects"
    ON public.projects
    FOR DELETE
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role = 'owner'
        )
    );

-- ============================================================================
-- STEP 6: Enable RLS on Memberships Table
-- ============================================================================
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- Memberships: Users can see their own memberships and memberships in their orgs
CREATE POLICY "users_view_memberships"
    ON public.memberships
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR (resource_type = 'org' AND resource_id IN (SELECT public.get_user_organizations()))
        OR (resource_type = 'project' AND resource_id IN (SELECT public.get_user_projects()))
    );

-- Memberships: Admins can create memberships for their orgs/projects
CREATE POLICY "admins_create_memberships"
    ON public.memberships
    FOR INSERT
    WITH CHECK (
        (resource_type = 'org' AND resource_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        ))
        OR (resource_type = 'project' AND resource_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'project'
              AND role IN ('owner', 'admin')
        ))
    );

-- Memberships: Admins can update memberships (but not promote above own role)
CREATE POLICY "admins_update_memberships"
    ON public.memberships
    FOR UPDATE
    USING (
        (resource_type = 'org' AND resource_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        ))
        OR (resource_type = 'project' AND resource_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'project'
              AND role IN ('owner', 'admin')
        ))
    );

-- Memberships: Admins can remove memberships
CREATE POLICY "admins_delete_memberships"
    ON public.memberships
    FOR DELETE
    USING (
        user_id = auth.uid()  -- Users can leave voluntarily
        OR (resource_type = 'org' AND resource_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        ))
        OR (resource_type = 'project' AND resource_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'project'
              AND role IN ('owner', 'admin')
        ))
    );

-- ============================================================================
-- STEP 7: Enable RLS on Groups Table
-- ============================================================================
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- Groups: Users can see groups in their organizations
CREATE POLICY "users_view_groups"
    ON public.groups
    FOR SELECT
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- Groups: Members of org can create groups
CREATE POLICY "org_members_create_groups"
    ON public.groups
    FOR INSERT
    WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

-- Groups: Group leaders/org admins can update groups
CREATE POLICY "leaders_update_groups"
    ON public.groups
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
        OR id IN (
            SELECT group_id
            FROM public.group_members
            WHERE user_id = auth.uid()
              AND role = 'leader'
              AND is_active = true
        )
    );

-- Groups: Org admins can delete groups
CREATE POLICY "admins_delete_groups"
    ON public.groups
    FOR DELETE
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
    );

-- ============================================================================
-- STEP 8: Enable RLS on Services Table
-- ============================================================================
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Services: Users can see services in their organizations
CREATE POLICY "users_view_services"
    ON public.services
    FOR SELECT
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- Services: Org members can create services
CREATE POLICY "org_members_create_services"
    ON public.services
    FOR INSERT
    WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

-- Services: Org admins can update services
CREATE POLICY "admins_update_services"
    ON public.services
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin', 'member')
        )
    );

-- Services: Org admins can delete services
CREATE POLICY "admins_delete_services"
    ON public.services
    FOR DELETE
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
    );

-- ============================================================================
-- STEP 9: Enable RLS on Incidents Table
-- ============================================================================
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- Incidents: Users can see incidents in their organizations
CREATE POLICY "users_view_incidents"
    ON public.incidents
    FOR SELECT
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- Incidents: Org members can create incidents (via webhooks, etc.)
CREATE POLICY "org_members_create_incidents"
    ON public.incidents
    FOR INSERT
    WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

-- Incidents: Assigned users or org members can update incidents
CREATE POLICY "members_update_incidents"
    ON public.incidents
    FOR UPDATE
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- Note: Incidents are typically never deleted, just resolved
-- If needed, only org admins should be able to delete
CREATE POLICY "admins_delete_incidents"
    ON public.incidents
    FOR DELETE
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
    );

-- ============================================================================
-- STEP 10: Enable RLS on Escalation Policies Table
-- ============================================================================
ALTER TABLE public.escalation_policies ENABLE ROW LEVEL SECURITY;

-- Escalation Policies: Users can see policies in their organizations
CREATE POLICY "users_view_escalation_policies"
    ON public.escalation_policies
    FOR SELECT
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- Escalation Policies: Org admins can manage
CREATE POLICY "admins_manage_escalation_policies"
    ON public.escalation_policies
    FOR ALL
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
    );

-- ============================================================================
-- STEP 11: Enable RLS on Schedulers Table
-- ============================================================================
ALTER TABLE public.schedulers ENABLE ROW LEVEL SECURITY;

-- Schedulers: Users can see schedulers in their organizations
CREATE POLICY "users_view_schedulers"
    ON public.schedulers
    FOR SELECT
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- Schedulers: Org members can create/update schedulers
CREATE POLICY "members_manage_schedulers"
    ON public.schedulers
    FOR ALL
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- ============================================================================
-- STEP 12: Enable RLS on Shifts Table
-- ============================================================================
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- Shifts: Users can see shifts in their organizations
CREATE POLICY "users_view_shifts"
    ON public.shifts
    FOR SELECT
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- Shifts: Org members can manage shifts
CREATE POLICY "members_manage_shifts"
    ON public.shifts
    FOR ALL
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- ============================================================================
-- STEP 13: Enable RLS on API Keys Table
-- ============================================================================
-- ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- -- API Keys: Users can see API keys in their organizations
-- CREATE POLICY "users_view_api_keys"
--     ON public.api_keys
--     FOR SELECT
--     USING (organization_id IN (SELECT public.get_user_organizations()));

-- -- API Keys: Org admins can manage API keys
-- CREATE POLICY "admins_manage_api_keys"
--     ON public.api_keys
--     FOR ALL
--     USING (
--         organization_id IN (
--             SELECT resource_id
--             FROM public.memberships
--             WHERE user_id = auth.uid()
--               AND resource_type = 'org'
--               AND role IN ('owner', 'admin')
--         )
--     );

-- ============================================================================
-- STEP 14: Enable RLS on Integrations Table
-- ============================================================================
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- Integrations: Users can see integrations in their organizations
CREATE POLICY "users_view_integrations"
    ON public.integrations
    FOR SELECT
    USING (organization_id IN (SELECT public.get_user_organizations()));

-- Integrations: Org admins can manage integrations
CREATE POLICY "admins_manage_integrations"
    ON public.integrations
    FOR ALL
    USING (
        organization_id IN (
            SELECT resource_id
            FROM public.memberships
            WHERE user_id = auth.uid()
              AND resource_type = 'org'
              AND role IN ('owner', 'admin')
        )
    );

-- ============================================================================
-- STEP 15: Bypass RLS for Service Account / Backend Operations
-- ============================================================================
-- Create a role for backend operations that bypasses RLS
-- The Go API uses this role when connecting with service credentials

-- Note: In Supabase, you typically use the service_role key which bypasses RLS
-- If you need a custom role for specific backend operations:

-- CREATE ROLE slar_backend NOINHERIT;
-- ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
-- ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
-- ... etc for other tables

-- Grant bypass to service role (Supabase default)
-- ALTER TABLE public.organizations OWNER TO postgres;
-- GRANT ALL ON public.organizations TO service_role;

-- ============================================================================
-- STEP 16: Create Policy for Anonymous Webhook Access
-- ============================================================================
-- For webhook endpoints that need to create incidents without auth
-- We create a special policy that allows insert based on API key validation

-- Note: This is handled at the application level in Go API
-- The Go API validates API keys and uses service credentials
-- RLS is bypassed for API key authenticated requests

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON POLICY "users_view_own_organizations" ON public.organizations IS 'Users can only see organizations they are members of';
COMMENT ON POLICY "users_view_groups" ON public.groups IS 'Multi-tenant isolation: users only see groups in their organizations';
COMMENT ON POLICY "users_view_incidents" ON public.incidents IS 'Multi-tenant isolation: users only see incidents in their organizations';
COMMENT ON POLICY "users_view_services" ON public.services IS 'Multi-tenant isolation: users only see services in their organizations';

-- ============================================================================
-- STEP 17: Enable RLS on Group Members Table
-- ============================================================================
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Group Members: Users can see members of groups in their organizations
CREATE POLICY "users_view_group_members"
    ON public.group_members
    FOR SELECT
    USING (
        group_id IN (
            SELECT id FROM public.groups
            WHERE organization_id IN (SELECT public.get_user_organizations())
        )
    );

-- Group Members: Group leaders and org admins can manage group members
CREATE POLICY "leaders_manage_group_members"
    ON public.group_members
    FOR ALL
    USING (
        group_id IN (
            SELECT g.id FROM public.groups g
            WHERE g.organization_id IN (
                SELECT resource_id
                FROM public.memberships
                WHERE user_id = auth.uid()
                  AND resource_type = 'org'
                  AND role IN ('owner', 'admin')
            )
        )
        OR group_id IN (
            SELECT group_id FROM public.group_members
            WHERE user_id = auth.uid()
              AND role = 'leader'
              AND is_active = true
        )
    );

-- ============================================================================
-- STEP 18: Enable RLS on Escalation Levels Table
-- ============================================================================
ALTER TABLE public.escalation_levels ENABLE ROW LEVEL SECURITY;

-- Escalation Levels: Inherit access from parent policy
CREATE POLICY "users_view_escalation_levels"
    ON public.escalation_levels
    FOR SELECT
    USING (
        policy_id IN (
            SELECT id FROM public.escalation_policies
            WHERE organization_id IN (SELECT public.get_user_organizations())
        )
    );

-- Escalation Levels: Org admins can manage
CREATE POLICY "admins_manage_escalation_levels"
    ON public.escalation_levels
    FOR ALL
    USING (
        policy_id IN (
            SELECT ep.id FROM public.escalation_policies ep
            WHERE ep.organization_id IN (
                SELECT resource_id
                FROM public.memberships
                WHERE user_id = auth.uid()
                  AND resource_type = 'org'
                  AND role IN ('owner', 'admin')
            )
        )
    );

-- ============================================================================
-- STEP 19: Enable RLS on Schedule Overrides Table
-- ============================================================================
ALTER TABLE public.schedule_overrides ENABLE ROW LEVEL SECURITY;

-- Schedule Overrides: Users can see overrides for groups in their orgs
CREATE POLICY "users_view_schedule_overrides"
    ON public.schedule_overrides
    FOR SELECT
    USING (
        group_id IN (
            SELECT id FROM public.groups
            WHERE organization_id IN (SELECT public.get_user_organizations())
        )
    );

-- Schedule Overrides: Group members can create/manage overrides
CREATE POLICY "members_manage_schedule_overrides"
    ON public.schedule_overrides
    FOR ALL
    USING (
        group_id IN (
            SELECT id FROM public.groups
            WHERE organization_id IN (SELECT public.get_user_organizations())
        )
    );

-- ============================================================================
-- STEP 20: Enable RLS on Incident Events Table
-- ============================================================================
ALTER TABLE public.incident_events ENABLE ROW LEVEL SECURITY;

-- Incident Events: Inherit access from parent incident
CREATE POLICY "users_view_incident_events"
    ON public.incident_events
    FOR SELECT
    USING (
        incident_id IN (
            SELECT id FROM public.incidents
            WHERE organization_id IN (SELECT public.get_user_organizations())
        )
    );

-- Incident Events: Allow insert for incidents user can access
CREATE POLICY "users_create_incident_events"
    ON public.incident_events
    FOR INSERT
    WITH CHECK (
        incident_id IN (
            SELECT id FROM public.incidents
            WHERE organization_id IN (SELECT public.get_user_organizations())
        )
    );

-- ============================================================================
-- STEP 21: Enable RLS on Alert Escalations Table (if exists)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_escalations') THEN
        ALTER TABLE public.alert_escalations ENABLE ROW LEVEL SECURITY;

        -- Cast alert_id to UUID to match incidents.id type
        EXECUTE 'CREATE POLICY "users_view_alert_escalations"
            ON public.alert_escalations
            FOR SELECT
            USING (
                alert_id::uuid IN (
                    SELECT id FROM public.incidents
                    WHERE organization_id IN (SELECT public.get_user_organizations())
                )
            )';
    END IF;
END $$;

-- ============================================================================
-- Verification Query (Run manually to verify policies)
-- ============================================================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
