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
// It first checks explicit project membership, then inherits from org
func (a *SimpleAuthorizer) GetProjectRole(ctx context.Context, userID, projectID string) Role {
	// 1. Check explicit project membership first
	var role string
	err := a.db.QueryRowContext(ctx, `
		SELECT role FROM memberships
		WHERE user_id = $1 AND resource_type = 'project' AND resource_id = $2
	`, userID, projectID).Scan(&role)

	if err == nil {
		return Role(role)
	}

	// 2. No explicit role -> check org membership for inheritance
	var orgID string
	err = a.db.QueryRowContext(ctx, `
		SELECT organization_id FROM projects WHERE id = $1
	`, projectID).Scan(&orgID)

	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("Error getting project org: %v", err)
		}
		return ""
	}

	// 3. Check if project has explicit members (restricts access)
	var hasExplicitMembers bool
	err = a.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM memberships
			WHERE resource_type = 'project' AND resource_id = $1
		)
	`, projectID).Scan(&hasExplicitMembers)

	if err != nil {
		log.Printf("Error checking project members: %v", err)
		return ""
	}

	// 4. If project has explicit members, user must be one of them
	if hasExplicitMembers {
		return ""
	}

	// 5. No explicit members -> inherit from org
	orgRole := a.GetOrgRole(ctx, userID, orgID)
	return MapOrgRoleToProjectRole(orgRole)
}

// CanPerformProjectAction checks if a user can perform an action on a project
func (a *SimpleAuthorizer) CanPerformProjectAction(ctx context.Context, userID, projectID string, action Action) bool {
	role := a.GetProjectRole(ctx, userID, projectID)
	if role == "" {
		return false
	}
	return HasPermission(ProjectPermissions, role, action)
}
