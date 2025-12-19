package authz

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ============================================================================
// SimpleOrgRepository - SQL implementation of OrgRepository
// ============================================================================

// SimpleOrgRepository implements OrgRepository using SQL
type SimpleOrgRepository struct {
	db *sql.DB
}

// NewSimpleOrgRepository creates a new SimpleOrgRepository
func NewSimpleOrgRepository(db *sql.DB) *SimpleOrgRepository {
	return &SimpleOrgRepository{db: db}
}

// Ensure SimpleOrgRepository implements OrgRepository
var _ OrgRepository = (*SimpleOrgRepository)(nil)

// Create creates a new organization
func (r *SimpleOrgRepository) Create(ctx context.Context, org *Organization) error {
	if org.ID == "" {
		org.ID = uuid.New().String()
	}
	now := time.Now()
	org.CreatedAt = now
	org.UpdatedAt = now

	// Handle empty settings - PostgreSQL JSON type requires valid JSON or NULL
	var settings interface{}
	if org.Settings == "" {
		settings = nil // Will be stored as NULL in database
	} else {
		settings = org.Settings
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO organizations (id, name, slug, description, settings, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, org.ID, org.Name, org.Slug, org.Description, settings, org.IsActive, org.CreatedAt, org.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to create organization: %w", err)
	}
	return nil
}

// Get retrieves an organization by ID
func (r *SimpleOrgRepository) Get(ctx context.Context, id string) (*Organization, error) {
	var org Organization
	var settings sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT id, name, slug, COALESCE(description, ''), settings, is_active, created_at, updated_at
		FROM organizations
		WHERE id = $1
	`, id).Scan(&org.ID, &org.Name, &org.Slug, &org.Description, &settings, &org.IsActive, &org.CreatedAt, &org.UpdatedAt)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get organization: %w", err)
	}
	org.Settings = settings.String
	return &org, nil
}

// GetBySlug retrieves an organization by slug
func (r *SimpleOrgRepository) GetBySlug(ctx context.Context, slug string) (*Organization, error) {
	var org Organization
	var settings sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT id, name, slug, COALESCE(description, ''), settings, is_active, created_at, updated_at
		FROM organizations
		WHERE slug = $1
	`, slug).Scan(&org.ID, &org.Name, &org.Slug, &org.Description, &settings, &org.IsActive, &org.CreatedAt, &org.UpdatedAt)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get organization: %w", err)
	}
	org.Settings = settings.String
	return &org, nil
}

// List returns all organizations
func (r *SimpleOrgRepository) List(ctx context.Context, limit, offset int) ([]Organization, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, slug, COALESCE(description, ''), settings, is_active, created_at, updated_at
		FROM organizations
		WHERE is_active = true
		ORDER BY name
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list organizations: %w", err)
	}
	defer rows.Close()

	return scanOrganizations(rows)
}

// ListByUser returns organizations that a user has access to
func (r *SimpleOrgRepository) ListByUser(ctx context.Context, userID string) ([]Organization, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT o.id, o.name, o.slug, COALESCE(o.description, ''), o.settings, o.is_active, o.created_at, o.updated_at
		FROM organizations o
		JOIN memberships m ON m.resource_id = o.id AND m.resource_type = 'org'
		WHERE m.user_id = $1 AND o.is_active = true
		ORDER BY o.name
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list user organizations: %w", err)
	}
	defer rows.Close()

	return scanOrganizations(rows)
}

// Update updates an organization
func (r *SimpleOrgRepository) Update(ctx context.Context, org *Organization) error {
	org.UpdatedAt = time.Now()

	// Handle empty settings - PostgreSQL JSON type requires valid JSON or NULL
	var settings interface{}
	if org.Settings == "" {
		settings = nil
	} else {
		settings = org.Settings
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE organizations
		SET name = $2, slug = $3, description = $4, settings = $5, is_active = $6, updated_at = $7
		WHERE id = $1
	`, org.ID, org.Name, org.Slug, org.Description, settings, org.IsActive, org.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to update organization: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete deletes an organization
func (r *SimpleOrgRepository) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM organizations WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete organization: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// Exists checks if an organization exists
func (r *SimpleOrgRepository) Exists(ctx context.Context, id string) bool {
	var exists bool
	r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1)`, id).Scan(&exists)
	return exists
}

// SlugExists checks if a slug is already taken
func (r *SimpleOrgRepository) SlugExists(ctx context.Context, slug string) bool {
	var exists bool
	r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM organizations WHERE slug = $1)`, slug).Scan(&exists)
	return exists
}

// Helper function to scan organization rows
func scanOrganizations(rows *sql.Rows) ([]Organization, error) {
	var orgs []Organization
	for rows.Next() {
		var org Organization
		var settings sql.NullString
		if err := rows.Scan(&org.ID, &org.Name, &org.Slug, &org.Description, &settings, &org.IsActive, &org.CreatedAt, &org.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan organization: %w", err)
		}
		org.Settings = settings.String
		orgs = append(orgs, org)
	}
	return orgs, rows.Err()
}

// ============================================================================
// SimpleProjectRepository - SQL implementation of ProjectRepository
// ============================================================================

// SimpleProjectRepository implements ProjectRepository using SQL
type SimpleProjectRepository struct {
	db *sql.DB
}

// NewSimpleProjectRepository creates a new SimpleProjectRepository
func NewSimpleProjectRepository(db *sql.DB) *SimpleProjectRepository {
	return &SimpleProjectRepository{db: db}
}

// Ensure SimpleProjectRepository implements ProjectRepository
var _ ProjectRepository = (*SimpleProjectRepository)(nil)

// Create creates a new project
func (r *SimpleProjectRepository) Create(ctx context.Context, project *Project) error {
	if project.ID == "" {
		project.ID = uuid.New().String()
	}
	now := time.Now()
	project.CreatedAt = now
	project.UpdatedAt = now

	// Handle empty settings - PostgreSQL JSON type requires valid JSON or NULL
	var settings interface{}
	if project.Settings == "" {
		settings = nil // Will be stored as NULL in database
	} else {
		settings = project.Settings
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO projects (id, organization_id, name, slug, description, settings, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, project.ID, project.OrganizationID, project.Name, project.Slug, project.Description, settings, project.IsActive, project.CreatedAt, project.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to create project: %w", err)
	}
	return nil
}

// Get retrieves a project by ID
func (r *SimpleProjectRepository) Get(ctx context.Context, id string) (*Project, error) {
	var project Project
	var settings sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT id, organization_id, name, slug, COALESCE(description, ''), settings, is_active, created_at, updated_at
		FROM projects
		WHERE id = $1
	`, id).Scan(&project.ID, &project.OrganizationID, &project.Name, &project.Slug, &project.Description, &settings, &project.IsActive, &project.CreatedAt, &project.UpdatedAt)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get project: %w", err)
	}
	project.Settings = settings.String
	return &project, nil
}

// GetBySlug retrieves a project by org ID and slug
func (r *SimpleProjectRepository) GetBySlug(ctx context.Context, orgID, slug string) (*Project, error) {
	var project Project
	var settings sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT id, organization_id, name, slug, COALESCE(description, ''), settings, is_active, created_at, updated_at
		FROM projects
		WHERE organization_id = $1 AND slug = $2
	`, orgID, slug).Scan(&project.ID, &project.OrganizationID, &project.Name, &project.Slug, &project.Description, &settings, &project.IsActive, &project.CreatedAt, &project.UpdatedAt)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get project: %w", err)
	}
	project.Settings = settings.String
	return &project, nil
}

// ListByOrg returns all projects in an organization
func (r *SimpleProjectRepository) ListByOrg(ctx context.Context, orgID string) ([]Project, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, organization_id, name, slug, COALESCE(description, ''), settings, is_active, created_at, updated_at
		FROM projects
		WHERE organization_id = $1 AND is_active = true
		ORDER BY name
	`, orgID)
	if err != nil {
		return nil, fmt.Errorf("failed to list projects: %w", err)
	}
	defer rows.Close()

	return scanProjects(rows)
}

// ListByUser returns projects that a user has access to
func (r *SimpleProjectRepository) ListByUser(ctx context.Context, userID string) ([]Project, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT DISTINCT p.id, p.organization_id, p.name, p.slug, COALESCE(p.description, ''), p.settings, p.is_active, p.created_at, p.updated_at
		FROM projects p
		WHERE p.is_active = true AND (
			-- User has explicit project membership
			EXISTS (
				SELECT 1 FROM memberships m
				WHERE m.user_id = $1 AND m.resource_type = 'project' AND m.resource_id = p.id
			)
			OR (
				-- User is org member AND project has no explicit members
				EXISTS (
					SELECT 1 FROM memberships m
					WHERE m.user_id = $1 AND m.resource_type = 'org' AND m.resource_id = p.organization_id
				)
				AND NOT EXISTS (
					SELECT 1 FROM memberships m
					WHERE m.resource_type = 'project' AND m.resource_id = p.id
				)
			)
		)
		ORDER BY p.name
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list user projects: %w", err)
	}
	defer rows.Close()

	return scanProjects(rows)
}

// Update updates a project
func (r *SimpleProjectRepository) Update(ctx context.Context, project *Project) error {
	project.UpdatedAt = time.Now()

	// Handle empty settings - PostgreSQL JSON type requires valid JSON or NULL
	var settings interface{}
	if project.Settings == "" {
		settings = nil
	} else {
		settings = project.Settings
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE projects
		SET name = $2, slug = $3, description = $4, settings = $5, is_active = $6, updated_at = $7
		WHERE id = $1
	`, project.ID, project.Name, project.Slug, project.Description, settings, project.IsActive, project.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to update project: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete deletes a project
func (r *SimpleProjectRepository) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM projects WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete project: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// Exists checks if a project exists
func (r *SimpleProjectRepository) Exists(ctx context.Context, id string) bool {
	var exists bool
	r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1)`, id).Scan(&exists)
	return exists
}

// SlugExistsInOrg checks if a slug is already taken in an org
func (r *SimpleProjectRepository) SlugExistsInOrg(ctx context.Context, orgID, slug string) bool {
	var exists bool
	r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE organization_id = $1 AND slug = $2)`, orgID, slug).Scan(&exists)
	return exists
}

// GetOrgID returns the organization ID for a project
func (r *SimpleProjectRepository) GetOrgID(ctx context.Context, projectID string) (string, error) {
	var orgID string
	err := r.db.QueryRowContext(ctx, `SELECT organization_id FROM projects WHERE id = $1`, projectID).Scan(&orgID)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("failed to get project org: %w", err)
	}
	return orgID, nil
}

// Helper function to scan project rows
func scanProjects(rows *sql.Rows) ([]Project, error) {
	var projects []Project
	for rows.Next() {
		var project Project
		var settings sql.NullString
		if err := rows.Scan(&project.ID, &project.OrganizationID, &project.Name, &project.Slug, &project.Description, &settings, &project.IsActive, &project.CreatedAt, &project.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan project: %w", err)
		}
		project.Settings = settings.String
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

// ============================================================================
// Factory function for convenience
// ============================================================================

// NewSimpleBackend creates all simple implementations at once
// Returns: Authorizer, MembershipManager, OrgRepository, ProjectRepository
func NewSimpleBackend(db *sql.DB) (Authorizer, MembershipManager, OrgRepository, ProjectRepository) {
	return NewSimpleAuthorizer(db),
		NewSimpleMembershipManager(db),
		NewSimpleOrgRepository(db),
		NewSimpleProjectRepository(db)
}

// VerifyMembershipNotFound is a helper for error checking
func VerifyMembershipNotFound(err error) bool {
	return errors.Is(err, ErrNotFound) || err.Error() == "membership not found"
}
