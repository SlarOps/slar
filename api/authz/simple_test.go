package authz

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestSimpleAuthorizer_GetOrgRole(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	authz := NewSimpleAuthorizer(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		userID   string
		orgID    string
		mockFunc func()
		want     Role
	}{
		{
			name:   "user is owner",
			userID: "user-1",
			orgID:  "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-1", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
			},
			want: RoleOwner,
		},
		{
			name:   "user is admin",
			userID: "user-2",
			orgID:  "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-2", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("admin"))
			},
			want: RoleAdmin,
		},
		{
			name:   "user is member",
			userID: "user-3",
			orgID:  "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-3", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
			},
			want: RoleMember,
		},
		{
			name:   "user not in org",
			userID: "user-4",
			orgID:  "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-4", "org-1").
					WillReturnError(sql.ErrNoRows)
			},
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			got := authz.GetOrgRole(ctx, tt.userID, tt.orgID)
			if got != tt.want {
				t.Errorf("GetOrgRole() = %v, want %v", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleAuthorizer_CanAccessOrg(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	authz := NewSimpleAuthorizer(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		userID   string
		orgID    string
		mockFunc func()
		want     bool
	}{
		{
			name:   "user has access",
			userID: "user-1",
			orgID:  "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-1", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
			},
			want: true,
		},
		{
			name:   "user has no access",
			userID: "user-2",
			orgID:  "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-2", "org-1").
					WillReturnError(sql.ErrNoRows)
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			got := authz.CanAccessOrg(ctx, tt.userID, tt.orgID)
			if got != tt.want {
				t.Errorf("CanAccessOrg() = %v, want %v", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleAuthorizer_CanPerformOrgAction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	authz := NewSimpleAuthorizer(db)
	ctx := context.Background()

	tests := []struct {
		name     string
		userID   string
		orgID    string
		action   Action
		mockFunc func()
		want     bool
	}{
		{
			name:   "owner can delete org",
			userID: "user-1",
			orgID:  "org-1",
			action: ActionDelete,
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-1", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
			},
			want: true,
		},
		{
			name:   "admin cannot delete org",
			userID: "user-2",
			orgID:  "org-1",
			action: ActionDelete,
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-2", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("admin"))
			},
			want: false,
		},
		{
			name:   "member can view org",
			userID: "user-3",
			orgID:  "org-1",
			action: ActionView,
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-3", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
			},
			want: true,
		},
		{
			name:   "member cannot manage org",
			userID: "user-3",
			orgID:  "org-1",
			action: ActionManage,
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-3", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
			},
			want: false,
		},
		{
			name:   "non-member cannot view",
			userID: "user-4",
			orgID:  "org-1",
			action: ActionView,
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-4", "org-1").
					WillReturnError(sql.ErrNoRows)
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			got := authz.CanPerformOrgAction(ctx, tt.userID, tt.orgID, tt.action)
			if got != tt.want {
				t.Errorf("CanPerformOrgAction() = %v, want %v", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleAuthorizer_GetProjectRole(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	authz := NewSimpleAuthorizer(db)
	ctx := context.Background()

	tests := []struct {
		name      string
		userID    string
		projectID string
		mockFunc  func()
		want      Role
	}{
		{
			name:      "explicit project admin",
			userID:    "user-1",
			projectID: "proj-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-1", "proj-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("admin"))
			},
			want: RoleAdmin,
		},
		{
			name:      "inherits from org owner - no explicit project members",
			userID:    "user-2",
			projectID: "proj-1",
			mockFunc: func() {
				// No explicit project membership
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-2", "proj-1").
					WillReturnError(sql.ErrNoRows)
				// Get project's org
				mock.ExpectQuery("SELECT organization_id FROM projects").
					WithArgs("proj-1").
					WillReturnRows(sqlmock.NewRows([]string{"organization_id"}).AddRow("org-1"))
				// Check if project has explicit members
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("proj-1").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				// Get org role
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-2", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
			},
			want: RoleAdmin, // owner -> admin
		},
		{
			name:      "inherits from org member - no explicit project members",
			userID:    "user-3",
			projectID: "proj-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-3", "proj-1").
					WillReturnError(sql.ErrNoRows)
				mock.ExpectQuery("SELECT organization_id FROM projects").
					WithArgs("proj-1").
					WillReturnRows(sqlmock.NewRows([]string{"organization_id"}).AddRow("org-1"))
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("proj-1").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-3", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
			},
			want: RoleMember,
		},
		{
			name:      "blocked - project has explicit members but user not in list",
			userID:    "user-4",
			projectID: "proj-2",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-4", "proj-2").
					WillReturnError(sql.ErrNoRows)
				mock.ExpectQuery("SELECT organization_id FROM projects").
					WithArgs("proj-2").
					WillReturnRows(sqlmock.NewRows([]string{"organization_id"}).AddRow("org-1"))
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("proj-2").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			},
			want: "", // No access
		},
		{
			name:      "project not found",
			userID:    "user-5",
			projectID: "proj-999",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-5", "proj-999").
					WillReturnError(sql.ErrNoRows)
				mock.ExpectQuery("SELECT organization_id FROM projects").
					WithArgs("proj-999").
					WillReturnError(sql.ErrNoRows)
			},
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			got := authz.GetProjectRole(ctx, tt.userID, tt.projectID)
			if got != tt.want {
				t.Errorf("GetProjectRole() = %v, want %v", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleAuthorizer_Check(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	authz := NewSimpleAuthorizer(db)
	ctx := context.Background()

	tests := []struct {
		name         string
		userID       string
		action       Action
		resourceType ResourceType
		resourceID   string
		mockFunc     func()
		want         bool
	}{
		{
			name:         "check org permission",
			userID:       "user-1",
			action:       ActionView,
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-1", "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))
			},
			want: true,
		},
		{
			name:         "check project permission",
			userID:       "user-1",
			action:       ActionUpdate,
			resourceType: ResourceProject,
			resourceID:   "proj-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT role FROM memberships").
					WithArgs("user-1", "proj-1").
					WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("admin"))
			},
			want: true,
		},
		{
			name:         "invalid resource type",
			userID:       "user-1",
			action:       ActionView,
			resourceType: ResourceType("invalid"),
			resourceID:   "res-1",
			mockFunc:     func() {},
			want:         false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			got := authz.Check(ctx, tt.userID, tt.action, tt.resourceType, tt.resourceID)
			if got != tt.want {
				t.Errorf("Check() = %v, want %v", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}
