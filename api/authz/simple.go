package authz

import (
	"context"
	"database/sql"
	"log"
)

// SimpleAuthorizer implements the Authorizer interface using direct SQL queries.
// This is the default implementation for in-process authorization.
// It ONLY handles permission checks - no CRUD operations.
type SimpleAuthorizer struct {
	db *sql.DB
}

// NewSimpleAuthorizer creates a new SimpleAuthorizer with the given database connection
func NewSimpleAuthorizer(db *sql.DB) *SimpleAuthorizer {
	return &SimpleAuthorizer{db: db}
}

// Ensure SimpleAuthorizer implements Authorizer interface
var _ Authorizer = (*SimpleAuthorizer)(nil)

// ============================================================================
// Generic Check Method (ReBAC/OpenFGA compatible signature)
// ============================================================================

// Check performs a generic authorization check
// This method signature is compatible with OpenFGA/SpiceDB for easy migration
func (a *SimpleAuthorizer) Check(ctx context.Context, userID string, action Action, resourceType ResourceType, resourceID string) bool {
	switch resourceType {
	case ResourceOrg:
		return a.CanPerformOrgAction(ctx, userID, resourceID, action)
	case ResourceProject:
		return a.CanPerformProjectAction(ctx, userID, resourceID, action)
	default:
		return false
	}
}

// ============================================================================
// Organization Access
// ============================================================================

// CanAccessOrg checks if a user has any access to an organization
func (a *SimpleAuthorizer) CanAccessOrg(ctx context.Context, userID, orgID string) bool {
	return a.GetOrgRole(ctx, userID, orgID) != ""
}

// GetOrgRole returns the user's role in an organization
func (a *SimpleAuthorizer) GetOrgRole(ctx context.Context, userID, orgID string) Role {
	var role string
	err := a.db.QueryRowContext(ctx, `
		SELECT role FROM memberships
		WHERE user_id = $1 AND resource_type = 'org' AND resource_id = $2
	`, userID, orgID).Scan(&role)

	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("Error getting org role: %v", err)
		}
		return ""
	}
	return Role(role)
}

// CanPerformOrgAction checks if a user can perform an action on an organization
func (a *SimpleAuthorizer) CanPerformOrgAction(ctx context.Context, userID, orgID string, action Action) bool {
	role := a.GetOrgRole(ctx, userID, orgID)
	if role == "" {
		return false
	}
	return HasPermission(OrgPermissions, role, action)
}

// ============================================================================
// Project Access
// ============================================================================

// CanAccessProject checks if a user has any access to a project
func (a *SimpleAuthorizer) CanAccessProject(ctx context.Context, userID, projectID string) bool {
	return a.GetProjectRole(ctx, userID, projectID) != ""
}

// GetProjectRole returns the user's effective role in a project
// Optimized: Uses a single query to check explicit membership, org inheritance, and restrictions
// Previously required 4-5 queries, now reduced to 1
func (a *SimpleAuthorizer) GetProjectRole(ctx context.Context, userID, projectID string) Role {
	// Single optimized query that handles all cases:
	// 1. Check explicit project membership
	// 2. If no explicit membership, check org membership for inheritance
	// 3. Only inherit if project has no explicit members (is "open")
	// 4. Returns both role and whether it's inherited for proper role mapping
	var role sql.NullString
	var isInherited bool
	err := a.db.QueryRowContext(ctx, `
		WITH project_info AS (
			-- Get project's org_id and check if it has explicit members
			SELECT
				p.organization_id,
				EXISTS(
					SELECT 1 FROM memberships
					WHERE resource_type = 'project' AND resource_id = $2
				) AS has_explicit_members
			FROM projects p
			WHERE p.id = $2
		),
		explicit_role AS (
			-- Check for explicit project membership
			SELECT role, 0 AS priority, false AS is_inherited FROM memberships
			WHERE user_id = $1 AND resource_type = 'project' AND resource_id = $2
		),
		inherited_role AS (
			-- Check org membership for inheritance (only if no explicit project members)
			SELECT m.role, 1 AS priority, true AS is_inherited FROM memberships m
			JOIN project_info pi ON m.resource_id = pi.organization_id
			WHERE m.user_id = $1
			AND m.resource_type = 'org'
			AND NOT pi.has_explicit_members
		),
		all_roles AS (
			SELECT role, priority, is_inherited FROM explicit_role
			UNION ALL
			SELECT role, priority, is_inherited FROM inherited_role
		)
		SELECT role, is_inherited FROM all_roles ORDER BY priority LIMIT 1
	`, userID, projectID).Scan(&role, &isInherited)

	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("Error getting project role: %v", err)
		}
		return ""
	}

	if !role.Valid || role.String == "" {
		return ""
	}

	// If inherited from org, map the role
	if isInherited {
		return MapOrgRoleToProjectRole(Role(role.String))
	}

	return Role(role.String)
}

// CanPerformProjectAction checks if a user can perform an action on a project
func (a *SimpleAuthorizer) CanPerformProjectAction(ctx context.Context, userID, projectID string, action Action) bool {
	role := a.GetProjectRole(ctx, userID, projectID)
	if role == "" {
		return false
	}
	return HasPermission(ProjectPermissions, role, action)
}
