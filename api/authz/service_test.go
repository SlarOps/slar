package authz

import (
	"context"
	"errors"
	"testing"
	"time"
)

// ============================================================================
// Mock Implementations
// ============================================================================

// MockAuthorizer implements Authorizer for testing
type MockAuthorizer struct {
	OrgRoles     map[string]map[string]Role   // userID -> orgID -> role
	ProjectRoles map[string]map[string]Role   // userID -> projectID -> role
}

func NewMockAuthorizer() *MockAuthorizer {
	return &MockAuthorizer{
		OrgRoles:     make(map[string]map[string]Role),
		ProjectRoles: make(map[string]map[string]Role),
	}
}

func (m *MockAuthorizer) SetOrgRole(userID, orgID string, role Role) {
	if m.OrgRoles[userID] == nil {
		m.OrgRoles[userID] = make(map[string]Role)
	}
	m.OrgRoles[userID][orgID] = role
}

func (m *MockAuthorizer) SetProjectRole(userID, projectID string, role Role) {
	if m.ProjectRoles[userID] == nil {
		m.ProjectRoles[userID] = make(map[string]Role)
	}
	m.ProjectRoles[userID][projectID] = role
}

func (m *MockAuthorizer) Check(ctx context.Context, userID string, action Action, resourceType ResourceType, resourceID string) bool {
	switch resourceType {
	case ResourceOrg:
		return m.CanPerformOrgAction(ctx, userID, resourceID, action)
	case ResourceProject:
		return m.CanPerformProjectAction(ctx, userID, resourceID, action)
	}
	return false
}

func (m *MockAuthorizer) CanAccessOrg(ctx context.Context, userID, orgID string) bool {
	return m.GetOrgRole(ctx, userID, orgID) != ""
}

func (m *MockAuthorizer) CanAccessProject(ctx context.Context, userID, projectID string) bool {
	return m.GetProjectRole(ctx, userID, projectID) != ""
}

func (m *MockAuthorizer) CanPerformOrgAction(ctx context.Context, userID, orgID string, action Action) bool {
	role := m.GetOrgRole(ctx, userID, orgID)
	if role == "" {
		return false
	}
	return HasPermission(OrgPermissions, role, action)
}

func (m *MockAuthorizer) CanPerformProjectAction(ctx context.Context, userID, projectID string, action Action) bool {
	role := m.GetProjectRole(ctx, userID, projectID)
	if role == "" {
		return false
	}
	return HasPermission(ProjectPermissions, role, action)
}

func (m *MockAuthorizer) GetOrgRole(ctx context.Context, userID, orgID string) Role {
	if roles, ok := m.OrgRoles[userID]; ok {
		return roles[orgID]
	}
	return ""
}

func (m *MockAuthorizer) GetProjectRole(ctx context.Context, userID, projectID string) Role {
	if roles, ok := m.ProjectRoles[userID]; ok {
		return roles[projectID]
	}
	return ""
}

// MockMembershipManager implements MembershipManager for testing
type MockMembershipManager struct {
	Memberships map[string]*Membership // key: userID:resourceType:resourceID
	Error       error
}

func NewMockMembershipManager() *MockMembershipManager {
	return &MockMembershipManager{
		Memberships: make(map[string]*Membership),
	}
}

func (m *MockMembershipManager) key(userID string, resourceType ResourceType, resourceID string) string {
	return userID + ":" + string(resourceType) + ":" + resourceID
}

func (m *MockMembershipManager) AddMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string, role Role) error {
	if m.Error != nil {
		return m.Error
	}
	key := m.key(userID, resourceType, resourceID)
	m.Memberships[key] = &Membership{
		ID:           "mem-" + key,
		UserID:       userID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Role:         role,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	return nil
}

func (m *MockMembershipManager) UpdateMemberRole(ctx context.Context, userID string, resourceType ResourceType, resourceID string, newRole Role) error {
	if m.Error != nil {
		return m.Error
	}
	key := m.key(userID, resourceType, resourceID)
	if mem, ok := m.Memberships[key]; ok {
		mem.Role = newRole
		mem.UpdatedAt = time.Now()
		return nil
	}
	return errors.New("membership not found")
}

func (m *MockMembershipManager) RemoveMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string) error {
	if m.Error != nil {
		return m.Error
	}
	key := m.key(userID, resourceType, resourceID)
	if _, ok := m.Memberships[key]; ok {
		delete(m.Memberships, key)
		return nil
	}
	return errors.New("membership not found")
}

func (m *MockMembershipManager) GetMembership(ctx context.Context, userID string, resourceType ResourceType, resourceID string) (*Membership, error) {
	key := m.key(userID, resourceType, resourceID)
	if mem, ok := m.Memberships[key]; ok {
		return mem, nil
	}
	return nil, errors.New("membership not found")
}

func (m *MockMembershipManager) GetUserMemberships(ctx context.Context, userID string) ([]Membership, error) {
	var result []Membership
	for _, mem := range m.Memberships {
		if mem.UserID == userID {
			result = append(result, *mem)
		}
	}
	return result, nil
}

func (m *MockMembershipManager) GetUserOrgMemberships(ctx context.Context, userID string) ([]Membership, error) {
	var result []Membership
	for _, mem := range m.Memberships {
		if mem.UserID == userID && mem.ResourceType == ResourceOrg {
			result = append(result, *mem)
		}
	}
	return result, nil
}

func (m *MockMembershipManager) GetUserProjectMemberships(ctx context.Context, userID string) ([]Membership, error) {
	var result []Membership
	for _, mem := range m.Memberships {
		if mem.UserID == userID && mem.ResourceType == ResourceProject {
			result = append(result, *mem)
		}
	}
	return result, nil
}

func (m *MockMembershipManager) GetResourceMembers(ctx context.Context, resourceType ResourceType, resourceID string) ([]Membership, error) {
	var result []Membership
	for _, mem := range m.Memberships {
		if mem.ResourceType == resourceType && mem.ResourceID == resourceID {
			result = append(result, *mem)
		}
	}
	return result, nil
}

func (m *MockMembershipManager) IsMember(ctx context.Context, userID string, resourceType ResourceType, resourceID string) bool {
	key := m.key(userID, resourceType, resourceID)
	_, ok := m.Memberships[key]
	return ok
}

// MockOrgRepository implements OrgRepository for testing
type MockOrgRepository struct {
	Orgs  map[string]*Organization
	Error error
}

func NewMockOrgRepository() *MockOrgRepository {
	return &MockOrgRepository{
		Orgs: make(map[string]*Organization),
	}
}

func (m *MockOrgRepository) Create(ctx context.Context, org *Organization) error {
	if m.Error != nil {
		return m.Error
	}
	m.Orgs[org.ID] = org
	return nil
}

func (m *MockOrgRepository) Get(ctx context.Context, id string) (*Organization, error) {
	if org, ok := m.Orgs[id]; ok {
		return org, nil
	}
	return nil, ErrNotFound
}

func (m *MockOrgRepository) GetBySlug(ctx context.Context, slug string) (*Organization, error) {
	for _, org := range m.Orgs {
		if org.Slug == slug {
			return org, nil
		}
	}
	return nil, ErrNotFound
}

func (m *MockOrgRepository) List(ctx context.Context, limit, offset int) ([]Organization, error) {
	var result []Organization
	for _, org := range m.Orgs {
		result = append(result, *org)
	}
	return result, nil
}

func (m *MockOrgRepository) ListByUser(ctx context.Context, userID string) ([]Organization, error) {
	return m.List(ctx, 100, 0)
}

func (m *MockOrgRepository) Update(ctx context.Context, org *Organization) error {
	if m.Error != nil {
		return m.Error
	}
	if _, ok := m.Orgs[org.ID]; !ok {
		return ErrNotFound
	}
	m.Orgs[org.ID] = org
	return nil
}

func (m *MockOrgRepository) Delete(ctx context.Context, id string) error {
	if _, ok := m.Orgs[id]; !ok {
		return ErrNotFound
	}
	delete(m.Orgs, id)
	return nil
}

func (m *MockOrgRepository) Exists(ctx context.Context, id string) bool {
	_, ok := m.Orgs[id]
	return ok
}

func (m *MockOrgRepository) SlugExists(ctx context.Context, slug string) bool {
	for _, org := range m.Orgs {
		if org.Slug == slug {
			return true
		}
	}
	return false
}

// MockProjectRepository implements ProjectRepository for testing
type MockProjectRepository struct {
	Projects map[string]*Project
	Error    error
}

func NewMockProjectRepository() *MockProjectRepository {
	return &MockProjectRepository{
		Projects: make(map[string]*Project),
	}
}

func (m *MockProjectRepository) Create(ctx context.Context, project *Project) error {
	if m.Error != nil {
		return m.Error
	}
	m.Projects[project.ID] = project
	return nil
}

func (m *MockProjectRepository) Get(ctx context.Context, id string) (*Project, error) {
	if proj, ok := m.Projects[id]; ok {
		return proj, nil
	}
	return nil, ErrNotFound
}

func (m *MockProjectRepository) GetBySlug(ctx context.Context, orgID, slug string) (*Project, error) {
	for _, proj := range m.Projects {
		if proj.OrganizationID == orgID && proj.Slug == slug {
			return proj, nil
		}
	}
	return nil, ErrNotFound
}

func (m *MockProjectRepository) ListByOrg(ctx context.Context, orgID string) ([]Project, error) {
	var result []Project
	for _, proj := range m.Projects {
		if proj.OrganizationID == orgID {
			result = append(result, *proj)
		}
	}
	return result, nil
}

func (m *MockProjectRepository) ListByUser(ctx context.Context, userID string) ([]Project, error) {
	var result []Project
	for _, proj := range m.Projects {
		result = append(result, *proj)
	}
	return result, nil
}

func (m *MockProjectRepository) Update(ctx context.Context, project *Project) error {
	if m.Error != nil {
		return m.Error
	}
	if _, ok := m.Projects[project.ID]; !ok {
		return ErrNotFound
	}
	m.Projects[project.ID] = project
	return nil
}

func (m *MockProjectRepository) Delete(ctx context.Context, id string) error {
	if _, ok := m.Projects[id]; !ok {
		return ErrNotFound
	}
	delete(m.Projects, id)
	return nil
}

func (m *MockProjectRepository) Exists(ctx context.Context, id string) bool {
	_, ok := m.Projects[id]
	return ok
}

func (m *MockProjectRepository) SlugExistsInOrg(ctx context.Context, orgID, slug string) bool {
	for _, proj := range m.Projects {
		if proj.OrganizationID == orgID && proj.Slug == slug {
			return true
		}
	}
	return false
}

func (m *MockProjectRepository) GetOrgID(ctx context.Context, projectID string) (string, error) {
	if proj, ok := m.Projects[projectID]; ok {
		return proj.OrganizationID, nil
	}
	return "", ErrNotFound
}

// ============================================================================
// OrgService Tests
// ============================================================================

func TestOrgService_CreateOrg(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		userID  string
		input   CreateOrgInput
		setup   func(*MockAuthorizer, *MockMembershipManager, *MockOrgRepository)
		wantErr bool
	}{
		{
			name:   "create org successfully",
			userID: "user-1",
			input: CreateOrgInput{
				Name:        "Test Org",
				Slug:        "test-org",
				Description: "A test organization",
			},
			setup:   func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {},
			wantErr: false,
		},
		{
			name:   "fail - empty name",
			userID: "user-1",
			input: CreateOrgInput{
				Name: "",
				Slug: "test-org",
			},
			setup:   func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {},
			wantErr: true,
		},
		{
			name:   "fail - empty slug",
			userID: "user-1",
			input: CreateOrgInput{
				Name: "Test Org",
				Slug: "",
			},
			setup:   func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {},
			wantErr: true,
		},
		{
			name:   "fail - slug already exists",
			userID: "user-1",
			input: CreateOrgInput{
				Name: "Test Org",
				Slug: "existing-slug",
			},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				r.Orgs["org-existing"] = &Organization{
					ID:   "org-existing",
					Slug: "existing-slug",
				}
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			repo := NewMockOrgRepository()
			tt.setup(authz, members, repo)

			svc := NewOrgService(authz, members, repo)
			org, err := svc.CreateOrg(ctx, tt.userID, tt.input)

			if (err != nil) != tt.wantErr {
				t.Errorf("CreateOrg() error = %v, wantErr %v", err, tt.wantErr)
			}

			if !tt.wantErr {
				if org == nil {
					t.Error("CreateOrg() returned nil org")
				}
				if org.Name != tt.input.Name {
					t.Errorf("CreateOrg() name = %v, want %v", org.Name, tt.input.Name)
				}
				// Check owner membership was created
				if !members.IsMember(ctx, tt.userID, ResourceOrg, org.ID) {
					t.Error("CreateOrg() did not create owner membership")
				}
			}
		})
	}
}

func TestOrgService_GetOrg(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		userID  string
		orgID   string
		setup   func(*MockAuthorizer, *MockMembershipManager, *MockOrgRepository)
		wantErr bool
	}{
		{
			name:   "get org successfully",
			userID: "user-1",
			orgID:  "org-1",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("user-1", "org-1", RoleMember)
				r.Orgs["org-1"] = &Organization{ID: "org-1", Name: "Test Org"}
			},
			wantErr: false,
		},
		{
			name:   "fail - no access",
			userID: "user-2",
			orgID:  "org-1",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				r.Orgs["org-1"] = &Organization{ID: "org-1", Name: "Test Org"}
			},
			wantErr: true,
		},
		{
			name:   "fail - org not found",
			userID: "user-1",
			orgID:  "org-999",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("user-1", "org-999", RoleMember)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			repo := NewMockOrgRepository()
			tt.setup(authz, members, repo)

			svc := NewOrgService(authz, members, repo)
			_, err := svc.GetOrg(ctx, tt.userID, tt.orgID)

			if (err != nil) != tt.wantErr {
				t.Errorf("GetOrg() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestOrgService_UpdateOrg(t *testing.T) {
	ctx := context.Background()
	newName := "Updated Name"

	tests := []struct {
		name    string
		userID  string
		orgID   string
		input   UpdateOrgInput
		setup   func(*MockAuthorizer, *MockMembershipManager, *MockOrgRepository)
		wantErr bool
	}{
		{
			name:   "update org as admin",
			userID: "user-1",
			orgID:  "org-1",
			input:  UpdateOrgInput{Name: &newName},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("user-1", "org-1", RoleAdmin)
				r.Orgs["org-1"] = &Organization{ID: "org-1", Name: "Old Name", Slug: "test"}
			},
			wantErr: false,
		},
		{
			name:   "fail - member cannot update",
			userID: "user-2",
			orgID:  "org-1",
			input:  UpdateOrgInput{Name: &newName},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("user-2", "org-1", RoleMember)
				r.Orgs["org-1"] = &Organization{ID: "org-1", Name: "Old Name", Slug: "test"}
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			repo := NewMockOrgRepository()
			tt.setup(authz, members, repo)

			svc := NewOrgService(authz, members, repo)
			org, err := svc.UpdateOrg(ctx, tt.userID, tt.orgID, tt.input)

			if (err != nil) != tt.wantErr {
				t.Errorf("UpdateOrg() error = %v, wantErr %v", err, tt.wantErr)
			}

			if !tt.wantErr && org.Name != newName {
				t.Errorf("UpdateOrg() name = %v, want %v", org.Name, newName)
			}
		})
	}
}

func TestOrgService_DeleteOrg(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		userID  string
		orgID   string
		setup   func(*MockAuthorizer, *MockMembershipManager, *MockOrgRepository)
		wantErr bool
	}{
		{
			name:   "delete org as owner",
			userID: "user-1",
			orgID:  "org-1",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("user-1", "org-1", RoleOwner)
				r.Orgs["org-1"] = &Organization{ID: "org-1", Name: "Test Org"}
			},
			wantErr: false,
		},
		{
			name:   "fail - admin cannot delete",
			userID: "user-2",
			orgID:  "org-1",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("user-2", "org-1", RoleAdmin)
				r.Orgs["org-1"] = &Organization{ID: "org-1", Name: "Test Org"}
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			repo := NewMockOrgRepository()
			tt.setup(authz, members, repo)

			svc := NewOrgService(authz, members, repo)
			err := svc.DeleteOrg(ctx, tt.userID, tt.orgID)

			if (err != nil) != tt.wantErr {
				t.Errorf("DeleteOrg() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestOrgService_AddOrgMember(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		actorID string
		orgID   string
		input   AddOrgMemberInput
		setup   func(*MockAuthorizer, *MockMembershipManager, *MockOrgRepository)
		wantErr bool
	}{
		{
			name:    "add member as admin",
			actorID: "admin-1",
			orgID:   "org-1",
			input:   AddOrgMemberInput{UserID: "user-2", Role: RoleMember},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("admin-1", "org-1", RoleAdmin)
			},
			wantErr: false,
		},
		{
			name:    "fail - cannot add owner",
			actorID: "admin-1",
			orgID:   "org-1",
			input:   AddOrgMemberInput{UserID: "user-2", Role: RoleOwner},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("admin-1", "org-1", RoleAdmin)
			},
			wantErr: true,
		},
		{
			name:    "fail - member cannot add members",
			actorID: "member-1",
			orgID:   "org-1",
			input:   AddOrgMemberInput{UserID: "user-2", Role: RoleMember},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("member-1", "org-1", RoleMember)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			repo := NewMockOrgRepository()
			tt.setup(authz, members, repo)

			svc := NewOrgService(authz, members, repo)
			err := svc.AddOrgMember(ctx, tt.actorID, tt.orgID, tt.input)

			if (err != nil) != tt.wantErr {
				t.Errorf("AddOrgMember() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestOrgService_RemoveOrgMember(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name         string
		actorID      string
		orgID        string
		targetUserID string
		setup        func(*MockAuthorizer, *MockMembershipManager, *MockOrgRepository)
		wantErr      bool
	}{
		{
			name:         "remove member as admin",
			actorID:      "admin-1",
			orgID:        "org-1",
			targetUserID: "user-2",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("admin-1", "org-1", RoleAdmin)
				a.SetOrgRole("user-2", "org-1", RoleMember)
				m.AddMember(ctx, "user-2", ResourceOrg, "org-1", RoleMember)
			},
			wantErr: false,
		},
		{
			name:         "fail - cannot remove owner",
			actorID:      "admin-1",
			orgID:        "org-1",
			targetUserID: "owner-1",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("admin-1", "org-1", RoleAdmin)
				a.SetOrgRole("owner-1", "org-1", RoleOwner)
			},
			wantErr: true,
		},
		{
			name:         "fail - cannot remove self",
			actorID:      "admin-1",
			orgID:        "org-1",
			targetUserID: "admin-1",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, r *MockOrgRepository) {
				a.SetOrgRole("admin-1", "org-1", RoleAdmin)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			repo := NewMockOrgRepository()
			tt.setup(authz, members, repo)

			svc := NewOrgService(authz, members, repo)
			err := svc.RemoveOrgMember(ctx, tt.actorID, tt.orgID, tt.targetUserID)

			if (err != nil) != tt.wantErr {
				t.Errorf("RemoveOrgMember() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// ============================================================================
// ProjectService Tests
// ============================================================================

func TestProjectService_CreateProject(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		userID  string
		input   CreateProjectInput
		setup   func(*MockAuthorizer, *MockMembershipManager, *MockProjectRepository, *MockOrgRepository)
		wantErr bool
	}{
		{
			name:   "create project successfully",
			userID: "user-1",
			input: CreateProjectInput{
				OrganizationID: "org-1",
				Name:           "Test Project",
				Slug:           "test-project",
				Description:    "A test project",
			},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, pr *MockProjectRepository, or *MockOrgRepository) {
				a.SetOrgRole("user-1", "org-1", RoleMember)
			},
			wantErr: false,
		},
		{
			name:   "fail - no org access",
			userID: "user-2",
			input: CreateProjectInput{
				OrganizationID: "org-1",
				Name:           "Test Project",
				Slug:           "test-project",
			},
			setup:   func(a *MockAuthorizer, m *MockMembershipManager, pr *MockProjectRepository, or *MockOrgRepository) {},
			wantErr: true,
		},
		{
			name:   "fail - slug already exists in org",
			userID: "user-1",
			input: CreateProjectInput{
				OrganizationID: "org-1",
				Name:           "Test Project",
				Slug:           "existing-slug",
			},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, pr *MockProjectRepository, or *MockOrgRepository) {
				a.SetOrgRole("user-1", "org-1", RoleMember)
				pr.Projects["proj-existing"] = &Project{
					ID:             "proj-existing",
					OrganizationID: "org-1",
					Slug:           "existing-slug",
				}
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			projectRepo := NewMockProjectRepository()
			orgRepo := NewMockOrgRepository()
			tt.setup(authz, members, projectRepo, orgRepo)

			svc := NewProjectService(authz, members, projectRepo, orgRepo)
			proj, err := svc.CreateProject(ctx, tt.userID, tt.input)

			if (err != nil) != tt.wantErr {
				t.Errorf("CreateProject() error = %v, wantErr %v", err, tt.wantErr)
			}

			if !tt.wantErr && proj == nil {
				t.Error("CreateProject() returned nil project")
			}
		})
	}
}

func TestProjectService_GetProject(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name      string
		userID    string
		projectID string
		setup     func(*MockAuthorizer, *MockMembershipManager, *MockProjectRepository, *MockOrgRepository)
		wantErr   bool
	}{
		{
			name:      "get project successfully",
			userID:    "user-1",
			projectID: "proj-1",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, pr *MockProjectRepository, or *MockOrgRepository) {
				a.SetProjectRole("user-1", "proj-1", RoleMember)
				pr.Projects["proj-1"] = &Project{ID: "proj-1", Name: "Test Project"}
			},
			wantErr: false,
		},
		{
			name:      "fail - no access",
			userID:    "user-2",
			projectID: "proj-1",
			setup: func(a *MockAuthorizer, m *MockMembershipManager, pr *MockProjectRepository, or *MockOrgRepository) {
				pr.Projects["proj-1"] = &Project{ID: "proj-1", Name: "Test Project"}
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			projectRepo := NewMockProjectRepository()
			orgRepo := NewMockOrgRepository()
			tt.setup(authz, members, projectRepo, orgRepo)

			svc := NewProjectService(authz, members, projectRepo, orgRepo)
			_, err := svc.GetProject(ctx, tt.userID, tt.projectID)

			if (err != nil) != tt.wantErr {
				t.Errorf("GetProject() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestProjectService_AddProjectMember(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name      string
		actorID   string
		projectID string
		input     AddProjectMemberInput
		setup     func(*MockAuthorizer, *MockMembershipManager, *MockProjectRepository, *MockOrgRepository)
		wantErr   bool
	}{
		{
			name:      "add project member",
			actorID:   "admin-1",
			projectID: "proj-1",
			input:     AddProjectMemberInput{UserID: "user-2", Role: RoleMember},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, pr *MockProjectRepository, or *MockOrgRepository) {
				a.SetProjectRole("admin-1", "proj-1", RoleAdmin)
				pr.Projects["proj-1"] = &Project{ID: "proj-1", OrganizationID: "org-1"}
				m.AddMember(ctx, "user-2", ResourceOrg, "org-1", RoleMember)
			},
			wantErr: false,
		},
		{
			name:      "fail - user not in org",
			actorID:   "admin-1",
			projectID: "proj-1",
			input:     AddProjectMemberInput{UserID: "user-3", Role: RoleMember},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, pr *MockProjectRepository, or *MockOrgRepository) {
				a.SetProjectRole("admin-1", "proj-1", RoleAdmin)
				pr.Projects["proj-1"] = &Project{ID: "proj-1", OrganizationID: "org-1"}
			},
			wantErr: true,
		},
		{
			name:      "fail - cannot add as owner",
			actorID:   "admin-1",
			projectID: "proj-1",
			input:     AddProjectMemberInput{UserID: "user-2", Role: RoleOwner},
			setup: func(a *MockAuthorizer, m *MockMembershipManager, pr *MockProjectRepository, or *MockOrgRepository) {
				a.SetProjectRole("admin-1", "proj-1", RoleAdmin)
				pr.Projects["proj-1"] = &Project{ID: "proj-1", OrganizationID: "org-1"}
				m.AddMember(ctx, "user-2", ResourceOrg, "org-1", RoleMember)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authz := NewMockAuthorizer()
			members := NewMockMembershipManager()
			projectRepo := NewMockProjectRepository()
			orgRepo := NewMockOrgRepository()
			tt.setup(authz, members, projectRepo, orgRepo)

			svc := NewProjectService(authz, members, projectRepo, orgRepo)
			err := svc.AddProjectMember(ctx, tt.actorID, tt.projectID, tt.input)

			if (err != nil) != tt.wantErr {
				t.Errorf("AddProjectMember() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
