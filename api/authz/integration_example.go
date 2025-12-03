package authz

/*
INTEGRATION GUIDE - How to add authz to SLAR API

This file provides examples of how to integrate the authz package
with the existing SLAR API router and services.

================================================================================
STEP 1: Initialize Authz Components in router/api.go
================================================================================

Add this to the import section:
	"github.com/vanchonlee/slar/authz"

Add this after the service initialization section:
*/

// Example initialization code for router/api.go:
/*
	// Initialize authz components
	authzBackend, membershipMgr, orgRepo, projectRepo := authz.NewSimpleBackend(pg)
	orgService := authz.NewOrgService(authzBackend, membershipMgr, orgRepo)
	projectService := authz.NewProjectService(authzBackend, membershipMgr, projectRepo, orgRepo)
	authzMiddleware := authz.NewAuthzMiddleware(authzBackend)

	// Initialize org/project handlers
	orgHandler := handlers.NewOrgHandler(orgService)
	projectHandler := handlers.NewProjectHandler(projectService)
*/

/*
================================================================================
STEP 2: Add Org/Project Routes
================================================================================

Add these routes inside the protected group:

	// ORGANIZATION MANAGEMENT
	orgRoutes := protected.Group("/orgs")
	{
		orgRoutes.POST("", orgHandler.CreateOrg)
		orgRoutes.GET("", orgHandler.ListOrgs)
		orgRoutes.GET("/:id", orgHandler.GetOrg)
		orgRoutes.PATCH("/:id", orgHandler.UpdateOrg)
		orgRoutes.DELETE("/:id", orgHandler.DeleteOrg)
		orgRoutes.GET("/:id/members", orgHandler.GetOrgMembers)
		orgRoutes.POST("/:id/members", orgHandler.AddOrgMember)
		orgRoutes.PATCH("/:id/members/:user_id", orgHandler.UpdateOrgMemberRole)
		orgRoutes.DELETE("/:id/members/:user_id", orgHandler.RemoveOrgMember)

		// Projects under org
		orgRoutes.GET("/:org_id/projects", projectHandler.ListOrgProjects)
		orgRoutes.POST("/:org_id/projects", projectHandler.CreateProject)
	}

	// PROJECT MANAGEMENT
	projectRoutes := protected.Group("/projects")
	{
		projectRoutes.GET("", projectHandler.ListUserProjects)
		projectRoutes.GET("/:id", projectHandler.GetProject)
		projectRoutes.PATCH("/:id", projectHandler.UpdateProject)
		projectRoutes.DELETE("/:id", projectHandler.DeleteProject)
		projectRoutes.GET("/:id/members", projectHandler.GetProjectMembers)
		projectRoutes.POST("/:id/members", projectHandler.AddProjectMember)
		projectRoutes.DELETE("/:id/members/:user_id", projectHandler.RemoveProjectMember)
	}
*/

/*
================================================================================
STEP 3: Add Authz to Incident Routes
================================================================================

Option A: Require project_id in URL path

	// INCIDENTS scoped to project
	projectIncidentRoutes := protected.Group("/projects/:project_id/incidents")
	projectIncidentRoutes.Use(authzMiddleware.RequireProjectAccess())
	{
		projectIncidentRoutes.GET("", incidentHandler.ListIncidents)
		projectIncidentRoutes.POST("", incidentHandler.CreateIncident)
		projectIncidentRoutes.GET("/:id", incidentHandler.GetIncident)
		// ... etc
	}

Option B: Require project_id as query parameter (backward compatible)

	// INCIDENTS with optional project filtering
	incidentRoutes := protected.Group("/incidents")
	incidentRoutes.Use(authzMiddleware.OptionalProjectFilter())  // New middleware
	{
		incidentRoutes.GET("", incidentHandler.ListIncidents)
		// If ?project_id=xxx is provided, filter by project
		// Otherwise, return all incidents from user's accessible projects
	}
*/

/*
================================================================================
STEP 4: Update IncidentService to Filter by Project
================================================================================

Modify services/incident.go to accept project filtering:
*/

// ExampleIncidentFilter shows how to add project filtering to incident queries
type ExampleIncidentFilter struct {
	ProjectID string
	OrgID     string
	Status    string
	// ... other existing filters
}

// Example SQL modification for ListIncidents:
/*
	SELECT i.* FROM incidents i
	JOIN groups g ON i.group_id = g.id
	WHERE g.project_id = $1  -- Filter by project
	AND ($2 = '' OR i.status = $2)
	ORDER BY i.created_at DESC
*/

// Example for getting incidents across all user's projects:
/*
	SELECT i.* FROM incidents i
	JOIN groups g ON i.group_id = g.id
	JOIN projects p ON g.project_id = p.id
	WHERE p.id IN (
		-- User's accessible projects
		SELECT DISTINCT p2.id FROM projects p2
		WHERE p2.is_active = true AND (
			EXISTS (
				SELECT 1 FROM memberships m
				WHERE m.user_id = $1 AND m.resource_type = 'project' AND m.resource_id = p2.id
			)
			OR (
				EXISTS (
					SELECT 1 FROM memberships m
					WHERE m.user_id = $1 AND m.resource_type = 'org' AND m.resource_id = p2.organization_id
				)
				AND NOT EXISTS (
					SELECT 1 FROM memberships m
					WHERE m.resource_type = 'project' AND m.resource_id = p2.id
				)
			)
		)
	)
	ORDER BY i.created_at DESC
*/

/*
================================================================================
STEP 5: Migration Strategy
================================================================================

1. Run the migration to create org/project tables:
   supabase db push

2. Create a default organization for existing data:
   INSERT INTO organizations (name, slug) VALUES ('Default Org', 'default');

3. Update existing groups to belong to the default org:
   UPDATE groups SET organization_id = (SELECT id FROM organizations WHERE slug = 'default');

4. Create default project if needed:
   INSERT INTO projects (organization_id, name, slug)
   SELECT id, 'Default Project', 'default' FROM organizations WHERE slug = 'default';

5. Update groups with project_id:
   UPDATE groups SET project_id = (SELECT id FROM projects WHERE slug = 'default');

================================================================================
COMPLETE INTEGRATION CHECKLIST
================================================================================

[ ] Run migration (creates organizations, projects, memberships tables)
[ ] Update groups.organization_id and groups.project_id for existing data
[ ] Add authz initialization to router/api.go
[ ] Add org/project routes
[ ] Update IncidentService with project filtering
[ ] Update incident handlers to use project context
[ ] Add authz middleware to incident routes
[ ] Test: Create org -> Create project -> Create incident in project
[ ] Test: User without access cannot see incidents

*/

// OptionalProjectFilter middleware that doesn't require project_id but uses it if provided
func (m *AuthzMiddleware) OptionalProjectFilter() func(c interface{}) {
	// Implementation would go here
	// This is just an example signature
	return nil
}
