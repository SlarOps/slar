package authz

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

// ============================================================================
// SimpleOrgRepository Tests
// ============================================================================

func TestSimpleOrgRepository_Create(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleOrgRepository(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		org      *Organization
		mockFunc func()
		wantErr  bool
	}{
		{
			name: "create org with ID",
			org: &Organization{
				ID:          "org-1",
				Name:        "Test Org",
				Slug:        "test-org",
				Description: "A test organization",
				IsActive:    true,
			},
			mockFunc: func() {
				mock.ExpectExec("INSERT INTO organizations").
					WithArgs("org-1", "Test Org", "test-org", "A test organization", "", true, sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(1, 1))
			},
			wantErr: false,
		},
		{
			name: "create org without ID (auto-generate)",
			org: &Organization{
				Name:     "Auto ID Org",
				Slug:     "auto-id-org",
				IsActive: true,
			},
			mockFunc: func() {
				mock.ExpectExec("INSERT INTO organizations").
					WithArgs(sqlmock.AnyArg(), "Auto ID Org", "auto-id-org", "", "", true, sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(1, 1))
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			err := repo.Create(ctx, tt.org)
			if (err != nil) != tt.wantErr {
				t.Errorf("Create() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && tt.org.ID == "" {
				t.Error("Create() should set ID if empty")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleOrgRepository_Get(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleOrgRepository(db)
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name     string
		id       string
		mockFunc func()
		wantOrg  *Organization
		wantErr  bool
	}{
		{
			name: "get existing org",
			id:   "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, name, slug").
					WithArgs("org-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "name", "slug", "description", "settings", "is_active", "created_at", "updated_at"}).
						AddRow("org-1", "Test Org", "test-org", "Description", `{"theme":"dark"}`, true, now, now))
			},
			wantOrg: &Organization{
				ID:          "org-1",
				Name:        "Test Org",
				Slug:        "test-org",
				Description: "Description",
				Settings:    `{"theme":"dark"}`,
				IsActive:    true,
			},
			wantErr: false,
		},
		{
			name: "org not found",
			id:   "org-999",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, name, slug").
					WithArgs("org-999").
					WillReturnError(sql.ErrNoRows)
			},
			wantOrg: nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			org, err := repo.Get(ctx, tt.id)
			if (err != nil) != tt.wantErr {
				t.Errorf("Get() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && org.Name != tt.wantOrg.Name {
				t.Errorf("Get() name = %v, want %v", org.Name, tt.wantOrg.Name)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleOrgRepository_GetBySlug(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleOrgRepository(db)
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name     string
		slug     string
		mockFunc func()
		wantErr  bool
	}{
		{
			name: "get by slug",
			slug: "test-org",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, name, slug").
					WithArgs("test-org").
					WillReturnRows(sqlmock.NewRows([]string{"id", "name", "slug", "description", "settings", "is_active", "created_at", "updated_at"}).
						AddRow("org-1", "Test Org", "test-org", "", nil, true, now, now))
			},
			wantErr: false,
		},
		{
			name: "slug not found",
			slug: "nonexistent",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, name, slug").
					WithArgs("nonexistent").
					WillReturnError(sql.ErrNoRows)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			_, err := repo.GetBySlug(ctx, tt.slug)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetBySlug() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleOrgRepository_List(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleOrgRepository(db)
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name     string
		limit    int
		offset   int
		mockFunc func()
		wantLen  int
		wantErr  bool
	}{
		{
			name:   "list all orgs",
			limit:  10,
			offset: 0,
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, name, slug").
					WithArgs(10, 0).
					WillReturnRows(sqlmock.NewRows([]string{"id", "name", "slug", "description", "settings", "is_active", "created_at", "updated_at"}).
						AddRow("org-1", "Org 1", "org-1", "", nil, true, now, now).
						AddRow("org-2", "Org 2", "org-2", "", nil, true, now, now))
			},
			wantLen: 2,
			wantErr: false,
		},
		{
			name:   "empty list",
			limit:  10,
			offset: 100,
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, name, slug").
					WithArgs(10, 100).
					WillReturnRows(sqlmock.NewRows([]string{"id", "name", "slug", "description", "settings", "is_active", "created_at", "updated_at"}))
			},
			wantLen: 0,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			orgs, err := repo.List(ctx, tt.limit, tt.offset)
			if (err != nil) != tt.wantErr {
				t.Errorf("List() error = %v, wantErr %v", err, tt.wantErr)
			}
			if len(orgs) != tt.wantLen {
				t.Errorf("List() len = %v, want %v", len(orgs), tt.wantLen)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleOrgRepository_Update(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleOrgRepository(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		org      *Organization
		mockFunc func()
		wantErr  bool
	}{
		{
			name: "update org",
			org: &Organization{
				ID:          "org-1",
				Name:        "Updated Org",
				Slug:        "updated-org",
				Description: "Updated description",
				IsActive:    true,
			},
			mockFunc: func() {
				mock.ExpectExec("UPDATE organizations").
					WithArgs("org-1", "Updated Org", "updated-org", "Updated description", "", true, sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(0, 1))
			},
			wantErr: false,
		},
		{
			name: "org not found",
			org: &Organization{
				ID:   "org-999",
				Name: "Nonexistent",
				Slug: "nonexistent",
			},
			mockFunc: func() {
				mock.ExpectExec("UPDATE organizations").
					WithArgs("org-999", "Nonexistent", "nonexistent", "", "", false, sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(0, 0))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			err := repo.Update(ctx, tt.org)
			if (err != nil) != tt.wantErr {
				t.Errorf("Update() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleOrgRepository_Delete(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleOrgRepository(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		id       string
		mockFunc func()
		wantErr  bool
	}{
		{
			name: "delete org",
			id:   "org-1",
			mockFunc: func() {
				mock.ExpectExec("DELETE FROM organizations").
					WithArgs("org-1").
					WillReturnResult(sqlmock.NewResult(0, 1))
			},
			wantErr: false,
		},
		{
			name: "org not found",
			id:   "org-999",
			mockFunc: func() {
				mock.ExpectExec("DELETE FROM organizations").
					WithArgs("org-999").
					WillReturnResult(sqlmock.NewResult(0, 0))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			err := repo.Delete(ctx, tt.id)
			if (err != nil) != tt.wantErr {
				t.Errorf("Delete() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleOrgRepository_Exists(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleOrgRepository(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		id       string
		mockFunc func()
		want     bool
	}{
		{
			name: "org exists",
			id:   "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("org-1").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			},
			want: true,
		},
		{
			name: "org does not exist",
			id:   "org-999",
			mockFunc: func() {
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("org-999").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			got := repo.Exists(ctx, tt.id)
			if got != tt.want {
				t.Errorf("Exists() = %v, want %v", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleOrgRepository_SlugExists(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleOrgRepository(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		slug     string
		mockFunc func()
		want     bool
	}{
		{
			name: "slug exists",
			slug: "test-org",
			mockFunc: func() {
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("test-org").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			},
			want: true,
		},
		{
			name: "slug does not exist",
			slug: "new-slug",
			mockFunc: func() {
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("new-slug").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			got := repo.SlugExists(ctx, tt.slug)
			if got != tt.want {
				t.Errorf("SlugExists() = %v, want %v", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

// ============================================================================
// SimpleProjectRepository Tests
// ============================================================================

func TestSimpleProjectRepository_Create(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleProjectRepository(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		project  *Project
		mockFunc func()
		wantErr  bool
	}{
		{
			name: "create project",
			project: &Project{
				ID:             "proj-1",
				OrganizationID: "org-1",
				Name:           "Test Project",
				Slug:           "test-project",
				Description:    "A test project",
				IsActive:       true,
			},
			mockFunc: func() {
				mock.ExpectExec("INSERT INTO projects").
					WithArgs("proj-1", "org-1", "Test Project", "test-project", "A test project", "", true, sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(1, 1))
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			err := repo.Create(ctx, tt.project)
			if (err != nil) != tt.wantErr {
				t.Errorf("Create() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleProjectRepository_Get(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleProjectRepository(db)
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name     string
		id       string
		mockFunc func()
		wantErr  bool
	}{
		{
			name: "get existing project",
			id:   "proj-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, organization_id, name, slug").
					WithArgs("proj-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "organization_id", "name", "slug", "description", "settings", "is_active", "created_at", "updated_at"}).
						AddRow("proj-1", "org-1", "Test Project", "test-project", "", nil, true, now, now))
			},
			wantErr: false,
		},
		{
			name: "project not found",
			id:   "proj-999",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, organization_id, name, slug").
					WithArgs("proj-999").
					WillReturnError(sql.ErrNoRows)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			_, err := repo.Get(ctx, tt.id)
			if (err != nil) != tt.wantErr {
				t.Errorf("Get() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleProjectRepository_ListByOrg(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleProjectRepository(db)
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name     string
		orgID    string
		mockFunc func()
		wantLen  int
		wantErr  bool
	}{
		{
			name:  "list org projects",
			orgID: "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, organization_id, name, slug").
					WithArgs("org-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "organization_id", "name", "slug", "description", "settings", "is_active", "created_at", "updated_at"}).
						AddRow("proj-1", "org-1", "Project 1", "project-1", "", nil, true, now, now).
						AddRow("proj-2", "org-1", "Project 2", "project-2", "", nil, true, now, now))
			},
			wantLen: 2,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			projects, err := repo.ListByOrg(ctx, tt.orgID)
			if (err != nil) != tt.wantErr {
				t.Errorf("ListByOrg() error = %v, wantErr %v", err, tt.wantErr)
			}
			if len(projects) != tt.wantLen {
				t.Errorf("ListByOrg() len = %v, want %v", len(projects), tt.wantLen)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleProjectRepository_GetOrgID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	repo := NewSimpleProjectRepository(db)
	ctx := context.Background()

	tests := []struct {
		name      string
		projectID string
		mockFunc  func()
		wantOrgID string
		wantErr   bool
	}{
		{
			name:      "get org ID",
			projectID: "proj-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT organization_id FROM projects").
					WithArgs("proj-1").
					WillReturnRows(sqlmock.NewRows([]string{"organization_id"}).AddRow("org-1"))
			},
			wantOrgID: "org-1",
			wantErr:   false,
		},
		{
			name:      "project not found",
			projectID: "proj-999",
			mockFunc: func() {
				mock.ExpectQuery("SELECT organization_id FROM projects").
					WithArgs("proj-999").
					WillReturnError(sql.ErrNoRows)
			},
			wantOrgID: "",
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			orgID, err := repo.GetOrgID(ctx, tt.projectID)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetOrgID() error = %v, wantErr %v", err, tt.wantErr)
			}
			if orgID != tt.wantOrgID {
				t.Errorf("GetOrgID() = %v, want %v", orgID, tt.wantOrgID)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

// ============================================================================
// Factory Function Tests
// ============================================================================

func TestNewSimpleBackend(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	authz, members, orgRepo, projectRepo := NewSimpleBackend(db)

	if authz == nil {
		t.Error("NewSimpleBackend() authz is nil")
	}
	if members == nil {
		t.Error("NewSimpleBackend() members is nil")
	}
	if orgRepo == nil {
		t.Error("NewSimpleBackend() orgRepo is nil")
	}
	if projectRepo == nil {
		t.Error("NewSimpleBackend() projectRepo is nil")
	}
}

func TestVerifyMembershipNotFound(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "ErrNotFound",
			err:  ErrNotFound,
			want: true,
		},
		{
			name: "membership not found message",
			err:  sql.ErrNoRows,
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := VerifyMembershipNotFound(tt.err)
			if got != tt.want {
				t.Errorf("VerifyMembershipNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}
