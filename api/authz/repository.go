package authz

import (
	"context"
	"time"
)

// Organization represents an organization (tenant)
type Organization struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Description string    `json:"description,omitempty"`
	Settings    string    `json:"settings,omitempty"` // JSON string
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Project represents a project within an organization
type Project struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	Name           string    `json:"name"`
	Slug           string    `json:"slug"`
	Description    string    `json:"description,omitempty"`
	Settings       string    `json:"settings,omitempty"` // JSON string
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// OrgRepository handles CRUD operations for organizations.
// This is purely a data access layer - no authorization logic.
type OrgRepository interface {
	// Create creates a new organization
	Create(ctx context.Context, org *Organization) error

	// Get retrieves an organization by ID
	Get(ctx context.Context, id string) (*Organization, error)

	// GetBySlug retrieves an organization by slug
	GetBySlug(ctx context.Context, slug string) (*Organization, error)

	// List returns all organizations (admin only, typically)
	List(ctx context.Context, limit, offset int) ([]Organization, error)

	// ListByUser returns organizations that a user has access to
	// Note: This uses memberships table for filtering
	ListByUser(ctx context.Context, userID string) ([]Organization, error)

	// Update updates an organization
	Update(ctx context.Context, org *Organization) error

	// Delete deletes an organization (cascades to projects, memberships)
	Delete(ctx context.Context, id string) error

	// Exists checks if an organization exists
	Exists(ctx context.Context, id string) bool

	// SlugExists checks if a slug is already taken
	SlugExists(ctx context.Context, slug string) bool
}

// ProjectRepository handles CRUD operations for projects.
// This is purely a data access layer - no authorization logic.
type ProjectRepository interface {
	// Create creates a new project
	Create(ctx context.Context, project *Project) error

	// Get retrieves a project by ID
	Get(ctx context.Context, id string) (*Project, error)

	// GetBySlug retrieves a project by org ID and slug
	GetBySlug(ctx context.Context, orgID, slug string) (*Project, error)

	// ListByOrg returns all projects in an organization
	ListByOrg(ctx context.Context, orgID string) ([]Project, error)

	// ListByUser returns projects that a user has access to
	// Note: This considers both explicit project membership and org membership
	ListByUser(ctx context.Context, userID string) ([]Project, error)

	// Update updates a project
	Update(ctx context.Context, project *Project) error

	// Delete deletes a project
	Delete(ctx context.Context, id string) error

	// Exists checks if a project exists
	Exists(ctx context.Context, id string) bool

	// SlugExistsInOrg checks if a slug is already taken in an org
	SlugExistsInOrg(ctx context.Context, orgID, slug string) bool

	// GetOrgID returns the organization ID for a project
	GetOrgID(ctx context.Context, projectID string) (string, error)
}
