package authz

import (
	"context"
	"time"
)

// Membership represents a user's membership in an org or project
type Membership struct {
	ID           string       `json:"id"`
	UserID       string       `json:"user_id"`
	ResourceType ResourceType `json:"resource_type"`
	ResourceID   string       `json:"resource_id"`
	Role         Role         `json:"role"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
	InvitedBy    string       `json:"invited_by,omitempty"`
}

// MembershipManager manages user-resource relationships.
// This is separate from Authorizer to follow Single Responsibility Principle.
// When switching to OpenFGA/SpiceDB, this interface handles the "write" side
// while Authorizer handles the "read/check" side.
type MembershipManager interface {
	// AddMember adds a user to an organization or project with a role
	AddMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string, role Role) error

	// UpdateMemberRole updates a user's role in a resource
	UpdateMemberRole(ctx context.Context, userID string, resourceType ResourceType, resourceID string, newRole Role) error

	// RemoveMember removes a user from an organization or project
	RemoveMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string) error

	// GetMembership gets a specific membership
	GetMembership(ctx context.Context, userID string, resourceType ResourceType, resourceID string) (*Membership, error)

	// GetUserMemberships returns all memberships for a user
	GetUserMemberships(ctx context.Context, userID string) ([]Membership, error)

	// GetUserOrgMemberships returns all organization memberships for a user
	GetUserOrgMemberships(ctx context.Context, userID string) ([]Membership, error)

	// GetUserProjectMemberships returns all project memberships for a user
	GetUserProjectMemberships(ctx context.Context, userID string) ([]Membership, error)

	// GetResourceMembers returns all members of an organization or project
	GetResourceMembers(ctx context.Context, resourceType ResourceType, resourceID string) ([]Membership, error)

	// IsMember checks if a user is a member of a resource (any role)
	IsMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string) bool
}
