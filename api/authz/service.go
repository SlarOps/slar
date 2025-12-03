package authz

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// Common errors
var (
	ErrForbidden       = errors.New("forbidden: you don't have permission to perform this action")
	ErrNotFound        = errors.New("resource not found")
	ErrAlreadyExists   = errors.New("resource already exists")
	ErrInvalidInput    = errors.New("invalid input")
	ErrCannotRemoveSelf = errors.New("cannot remove yourself from organization")
)

// OrgService handles organization business logic.
// It combines authorization, membership, and repository.
type OrgService struct {
	authz   Authorizer
	members MembershipManager
	repo    OrgRepository
}

// NewOrgService creates a new organization service
func NewOrgService(authz Authorizer, members MembershipManager, repo OrgRepository) *OrgService {
	return &OrgService{
		authz:   authz,
		members: members,
		repo:    repo,
	}
}

// CreateOrgInput represents input for creating an organization
type CreateOrgInput struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description,omitempty"`
}

// CreateOrg creates a new organization and adds the creator as owner
func (s *OrgService) CreateOrg(ctx context.Context, userID string, input CreateOrgInput) (*Organization, error) {
	// Validate input
	if input.Name == "" || input.Slug == "" {
		return nil, ErrInvalidInput
	}

	// Check if slug already exists
	if s.repo.SlugExists(ctx, input.Slug) {
		return nil, fmt.Errorf("%w: slug already taken", ErrAlreadyExists)
	}

	// Create organization
	org := &Organization{
		ID:          uuid.New().String(),
		Name:        input.Name,
		Slug:        input.Slug,
		Description: input.Description,
		IsActive:    true,
	}

	if err := s.repo.Create(ctx, org); err != nil {
		return nil, fmt.Errorf("failed to create organization: %w", err)
	}

	// Add creator as owner
	if err := s.members.AddMember(ctx, userID, ResourceOrg, org.ID, RoleOwner); err != nil {
		// Rollback org creation
		_ = s.repo.Delete(ctx, org.ID)
		return nil, fmt.Errorf("failed to add owner membership: %w", err)
	}

	return org, nil
}

// GetOrg retrieves an organization by ID (with authorization)
func (s *OrgService) GetOrg(ctx context.Context, userID, orgID string) (*Organization, error) {
	if !s.authz.CanAccessOrg(ctx, userID, orgID) {
		return nil, ErrForbidden
	}
	return s.repo.Get(ctx, orgID)
}

// ListUserOrgs returns all organizations a user has access to
func (s *OrgService) ListUserOrgs(ctx context.Context, userID string) ([]Organization, error) {
	return s.repo.ListByUser(ctx, userID)
}

// OrganizationWithRole represents an organization with the user's role
type OrganizationWithRole struct {
	Organization
	UserRole Role `json:"user_role"`
}

// ListUserOrgsWithRole returns all organizations a user has access to with their role
func (s *OrgService) ListUserOrgsWithRole(ctx context.Context, userID string) ([]OrganizationWithRole, error) {
	orgs, err := s.repo.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	result := make([]OrganizationWithRole, len(orgs))
	for i, org := range orgs {
		role := s.authz.GetOrgRole(ctx, userID, org.ID)
		result[i] = OrganizationWithRole{
			Organization: org,
			UserRole:     role,
		}
	}
	return result, nil
}

// UpdateOrgInput represents input for updating an organization
type UpdateOrgInput struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

// UpdateOrg updates an organization (requires admin+ role)
func (s *OrgService) UpdateOrg(ctx context.Context, userID, orgID string, input UpdateOrgInput) (*Organization, error) {
	if !s.authz.CanPerformOrgAction(ctx, userID, orgID, ActionUpdate) {
		return nil, ErrForbidden
	}

	org, err := s.repo.Get(ctx, orgID)
	if err != nil {
		return nil, err
	}

	if input.Name != nil {
		org.Name = *input.Name
	}
	if input.Description != nil {
		org.Description = *input.Description
	}

	if err := s.repo.Update(ctx, org); err != nil {
		return nil, err
	}

	return org, nil
}

// DeleteOrg deletes an organization (requires owner role)
func (s *OrgService) DeleteOrg(ctx context.Context, userID, orgID string) error {
	if !s.authz.CanPerformOrgAction(ctx, userID, orgID, ActionDelete) {
		return ErrForbidden
	}
	return s.repo.Delete(ctx, orgID)
}

// AddOrgMemberInput represents input for adding a member
type AddOrgMemberInput struct {
	UserID string `json:"user_id"`
	Role   Role   `json:"role"`
}

// AddOrgMember adds a member to an organization (requires manage permission)
func (s *OrgService) AddOrgMember(ctx context.Context, actorID, orgID string, input AddOrgMemberInput) error {
	if !s.authz.CanPerformOrgAction(ctx, actorID, orgID, ActionManage) {
		return ErrForbidden
	}

	// Cannot add someone as owner (only one owner allowed during creation)
	if input.Role == RoleOwner {
		return fmt.Errorf("%w: cannot add another owner", ErrInvalidInput)
	}

	return s.members.AddMember(ctx, input.UserID, ResourceOrg, orgID, input.Role)
}

// UpdateOrgMemberRole updates a member's role (requires manage permission)
func (s *OrgService) UpdateOrgMemberRole(ctx context.Context, actorID, orgID, targetUserID string, newRole Role) error {
	if !s.authz.CanPerformOrgAction(ctx, actorID, orgID, ActionManage) {
		return ErrForbidden
	}

	// Cannot change owner role
	currentRole := s.authz.GetOrgRole(ctx, targetUserID, orgID)
	if currentRole == RoleOwner {
		return fmt.Errorf("%w: cannot change owner's role", ErrInvalidInput)
	}

	// Cannot promote to owner
	if newRole == RoleOwner {
		return fmt.Errorf("%w: cannot promote to owner", ErrInvalidInput)
	}

	return s.members.UpdateMemberRole(ctx, targetUserID, ResourceOrg, orgID, newRole)
}

// RemoveOrgMember removes a member from an organization (requires manage permission)
func (s *OrgService) RemoveOrgMember(ctx context.Context, actorID, orgID, targetUserID string) error {
	if !s.authz.CanPerformOrgAction(ctx, actorID, orgID, ActionManage) {
		return ErrForbidden
	}

	// Cannot remove owner
	targetRole := s.authz.GetOrgRole(ctx, targetUserID, orgID)
	if targetRole == RoleOwner {
		return fmt.Errorf("%w: cannot remove owner", ErrInvalidInput)
	}

	// Cannot remove yourself
	if actorID == targetUserID {
		return ErrCannotRemoveSelf
	}

	return s.members.RemoveMember(ctx, targetUserID, ResourceOrg, orgID)
}

// GetOrgMembers returns all members of an organization
func (s *OrgService) GetOrgMembers(ctx context.Context, userID, orgID string) ([]Membership, error) {
	if !s.authz.CanAccessOrg(ctx, userID, orgID) {
		return nil, ErrForbidden
	}
	return s.members.GetResourceMembers(ctx, ResourceOrg, orgID)
}

// ============================================================================
// ProjectService
// ============================================================================

// ProjectService handles project business logic.
type ProjectService struct {
	authz    Authorizer
	members  MembershipManager
	repo     ProjectRepository
	orgRepo  OrgRepository
}

// NewProjectService creates a new project service
func NewProjectService(authz Authorizer, members MembershipManager, repo ProjectRepository, orgRepo OrgRepository) *ProjectService {
	return &ProjectService{
		authz:   authz,
		members: members,
		repo:    repo,
		orgRepo: orgRepo,
	}
}

// CreateProjectInput represents input for creating a project
type CreateProjectInput struct {
	OrganizationID string `json:"organization_id"`
	Name           string `json:"name"`
	Slug           string `json:"slug"`
	Description    string `json:"description,omitempty"`
}

// CreateProject creates a new project within an organization
func (s *ProjectService) CreateProject(ctx context.Context, userID string, input CreateProjectInput) (*Project, error) {
	// Check if user can create projects in this org
	if !s.authz.CanPerformOrgAction(ctx, userID, input.OrganizationID, ActionCreate) {
		return nil, ErrForbidden
	}

	// Validate input
	if input.Name == "" || input.Slug == "" {
		return nil, ErrInvalidInput
	}

	// Check if slug already exists in org
	if s.repo.SlugExistsInOrg(ctx, input.OrganizationID, input.Slug) {
		return nil, fmt.Errorf("%w: slug already taken in this organization", ErrAlreadyExists)
	}

	// Create project
	project := &Project{
		ID:             uuid.New().String(),
		OrganizationID: input.OrganizationID,
		Name:           input.Name,
		Slug:           input.Slug,
		Description:    input.Description,
		IsActive:       true,
	}

	if err := s.repo.Create(ctx, project); err != nil {
		return nil, fmt.Errorf("failed to create project: %w", err)
	}

	// Note: No explicit project membership created
	// User inherits access from org membership
	// Only create explicit membership if you want to restrict access

	return project, nil
}

// GetProject retrieves a project by ID (with authorization)
func (s *ProjectService) GetProject(ctx context.Context, userID, projectID string) (*Project, error) {
	if !s.authz.CanAccessProject(ctx, userID, projectID) {
		return nil, ErrForbidden
	}
	return s.repo.Get(ctx, projectID)
}

// ListOrgProjects returns all projects in an organization
func (s *ProjectService) ListOrgProjects(ctx context.Context, userID, orgID string) ([]Project, error) {
	if !s.authz.CanAccessOrg(ctx, userID, orgID) {
		return nil, ErrForbidden
	}
	return s.repo.ListByOrg(ctx, orgID)
}

// ListUserProjects returns all projects a user has access to
func (s *ProjectService) ListUserProjects(ctx context.Context, userID string) ([]Project, error) {
	return s.repo.ListByUser(ctx, userID)
}

// UpdateProjectInput represents input for updating a project
type UpdateProjectInput struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

// UpdateProject updates a project (requires admin role in project)
func (s *ProjectService) UpdateProject(ctx context.Context, userID, projectID string, input UpdateProjectInput) (*Project, error) {
	if !s.authz.CanPerformProjectAction(ctx, userID, projectID, ActionUpdate) {
		return nil, ErrForbidden
	}

	project, err := s.repo.Get(ctx, projectID)
	if err != nil {
		return nil, err
	}

	if input.Name != nil {
		project.Name = *input.Name
	}
	if input.Description != nil {
		project.Description = *input.Description
	}

	if err := s.repo.Update(ctx, project); err != nil {
		return nil, err
	}

	return project, nil
}

// DeleteProject deletes a project (requires delete permission)
func (s *ProjectService) DeleteProject(ctx context.Context, userID, projectID string) error {
	if !s.authz.CanPerformProjectAction(ctx, userID, projectID, ActionDelete) {
		return ErrForbidden
	}
	return s.repo.Delete(ctx, projectID)
}

// AddProjectMemberInput represents input for adding a project member
type AddProjectMemberInput struct {
	UserID string `json:"user_id"`
	Role   Role   `json:"role"`
}

// AddProjectMember adds an explicit member to a project
// This restricts project access to explicit members only
func (s *ProjectService) AddProjectMember(ctx context.Context, actorID, projectID string, input AddProjectMemberInput) error {
	if !s.authz.CanPerformProjectAction(ctx, actorID, projectID, ActionManage) {
		return ErrForbidden
	}

	// Validate role (no owner for projects)
	if input.Role == RoleOwner {
		return fmt.Errorf("%w: projects don't have owners", ErrInvalidInput)
	}

	// Check if user is in the org
	orgID, err := s.repo.GetOrgID(ctx, projectID)
	if err != nil {
		return err
	}

	if !s.members.IsMember(ctx, input.UserID, ResourceOrg, orgID) {
		return fmt.Errorf("%w: user must be a member of the organization first", ErrInvalidInput)
	}

	return s.members.AddMember(ctx, input.UserID, ResourceProject, projectID, input.Role)
}

// RemoveProjectMember removes an explicit member from a project
func (s *ProjectService) RemoveProjectMember(ctx context.Context, actorID, projectID, targetUserID string) error {
	if !s.authz.CanPerformProjectAction(ctx, actorID, projectID, ActionManage) {
		return ErrForbidden
	}

	if actorID == targetUserID {
		return ErrCannotRemoveSelf
	}

	return s.members.RemoveMember(ctx, targetUserID, ResourceProject, projectID)
}

// GetProjectMembers returns all explicit members of a project
func (s *ProjectService) GetProjectMembers(ctx context.Context, userID, projectID string) ([]Membership, error) {
	if !s.authz.CanAccessProject(ctx, userID, projectID) {
		return nil, ErrForbidden
	}
	return s.members.GetResourceMembers(ctx, ResourceProject, projectID)
}
