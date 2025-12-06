// Package authz provides authorization functionality using ReBAC model.
// This package follows Clean Architecture with separated concerns:
// - Authorizer: Only checks permissions (can be swapped to OpenFGA/SpiceDB)
// - MembershipManager: Manages user-resource relationships
// - Repository: CRUD operations for Org/Project data
package authz

import (
	"context"
)

// Role represents a user's role in an organization or project
type Role string

const (
	RoleOwner  Role = "owner"  // Full control (org only)
	RoleAdmin  Role = "admin"  // Manage members, settings
	RoleMember Role = "member" // Full access to resources
	RoleViewer Role = "viewer" // Read-only access
)

// Action represents an operation that can be performed on a resource
type Action string

const (
	ActionView   Action = "view"   // Read access
	ActionCreate Action = "create" // Create new resources
	ActionUpdate Action = "update" // Modify existing resources
	ActionDelete Action = "delete" // Remove resources
	ActionManage Action = "manage" // Administrative actions
)

// ResourceType represents the type of resource being accessed
type ResourceType string

const (
	ResourceOrg     ResourceType = "org"
	ResourceProject ResourceType = "project"
)

// Authorizer defines the interface for authorization checks ONLY.
// This interface answers one question: "Is this allowed?"
//
// Design principle: This interface should be swappable to OpenFGA/SpiceDB
// without affecting business logic.
type Authorizer interface {
	// Generic check method (ReBAC/OpenFGA compatible)
	// Example: Check(ctx, "user-123", "edit", "project", "proj-456")
	Check(ctx context.Context, userID string, action Action, resourceType ResourceType, resourceID string) bool

	// Helper methods (wrappers around Check for convenience)
	CanAccessOrg(ctx context.Context, userID, orgID string) bool
	CanAccessProject(ctx context.Context, userID, projectID string) bool
	CanPerformOrgAction(ctx context.Context, userID, orgID string, action Action) bool
	CanPerformProjectAction(ctx context.Context, userID, projectID string, action Action) bool

	// Get role for UI display (optional, may not exist in all implementations)
	GetOrgRole(ctx context.Context, userID, orgID string) Role
	GetProjectRole(ctx context.Context, userID, projectID string) Role
}

// Permission matrices define what actions each role can perform

// OrgPermissions defines what actions each role can perform at org level
var OrgPermissions = map[Role]map[Action]bool{
	RoleOwner: {
		ActionView:   true,
		ActionCreate: true,
		ActionUpdate: true,
		ActionDelete: true,
		ActionManage: true,
	},
	RoleAdmin: {
		ActionView:   true,
		ActionCreate: true,
		ActionUpdate: true,
		ActionDelete: false,
		ActionManage: true,
	},
	RoleMember: {
		ActionView:   true,
		ActionCreate: true,
		ActionUpdate: false,
		ActionDelete: false,
		ActionManage: false,
	},
	RoleViewer: {
		ActionView:   true,
		ActionCreate: false,
		ActionUpdate: false,
		ActionDelete: false,
		ActionManage: false,
	},
}

// ProjectPermissions defines what actions each role can perform at project level
var ProjectPermissions = map[Role]map[Action]bool{
	RoleOwner: { // Owner has same permissions as Admin at project level
		ActionView:   true,
		ActionCreate: true,
		ActionUpdate: true,
		ActionDelete: true,
		ActionManage: true,
	},
	RoleAdmin: {
		ActionView:   true,
		ActionCreate: true,
		ActionUpdate: true,
		ActionDelete: true,
		ActionManage: true,
	},
	RoleMember: {
		ActionView:   true,
		ActionCreate: true,
		ActionUpdate: true,
		ActionDelete: false,
		ActionManage: false,
	},
	RoleViewer: {
		ActionView:   true,
		ActionCreate: false,
		ActionUpdate: false,
		ActionDelete: false,
		ActionManage: false,
	},
}

// HasPermission checks if a role has permission to perform an action
func HasPermission(permissions map[Role]map[Action]bool, role Role, action Action) bool {
	if rolePerms, ok := permissions[role]; ok {
		if allowed, ok := rolePerms[action]; ok {
			return allowed
		}
	}
	return false
}

// MapOrgRoleToProjectRole maps an organization role to a project role for inheritance
func MapOrgRoleToProjectRole(orgRole Role) Role {
	switch orgRole {
	case RoleOwner, RoleAdmin:
		return RoleAdmin
	case RoleMember:
		return RoleMember
	case RoleViewer:
		return RoleViewer
	default:
		return ""
	}
}
