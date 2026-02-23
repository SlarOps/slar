package authz

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestSimpleMembershipManager_AddMember(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()

	tests := []struct {
		name         string
		userID       string
		resourceType ResourceType
		resourceID   string
		role         Role
		mockFunc     func()
		wantErr      bool
	}{
		{
			name:         "add org member",
			userID:       "user-1",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			role:         RoleMember,
			mockFunc: func() {
				mock.ExpectExec("INSERT INTO memberships").
					WithArgs(sqlmock.AnyArg(), "user-1", ResourceOrg, "org-1", RoleMember, sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(1, 1))
			},
			wantErr: false,
		},
		{
			name:         "add project admin",
			userID:       "user-2",
			resourceType: ResourceProject,
			resourceID:   "proj-1",
			role:         RoleAdmin,
			mockFunc: func() {
				mock.ExpectExec("INSERT INTO memberships").
					WithArgs(sqlmock.AnyArg(), "user-2", ResourceProject, "proj-1", RoleAdmin, sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(1, 1))
			},
			wantErr: false,
		},
		{
			name:         "upsert existing membership",
			userID:       "user-1",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			role:         RoleAdmin,
			mockFunc: func() {
				mock.ExpectExec("INSERT INTO memberships").
					WithArgs(sqlmock.AnyArg(), "user-1", ResourceOrg, "org-1", RoleAdmin, sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnResult(sqlmock.NewResult(1, 1))
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			err := mgr.AddMember(ctx, tt.userID, tt.resourceType, tt.resourceID, tt.role)
			if (err != nil) != tt.wantErr {
				t.Errorf("AddMember() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleMembershipManager_UpdateMemberRole(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()

	tests := []struct {
		name         string
		userID       string
		resourceType ResourceType
		resourceID   string
		newRole      Role
		mockFunc     func()
		wantErr      bool
	}{
		{
			name:         "update role successfully",
			userID:       "user-1",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			newRole:      RoleAdmin,
			mockFunc: func() {
				mock.ExpectExec("UPDATE memberships").
					WithArgs(RoleAdmin, sqlmock.AnyArg(), "user-1", ResourceOrg, "org-1").
					WillReturnResult(sqlmock.NewResult(0, 1))
			},
			wantErr: false,
		},
		{
			name:         "membership not found",
			userID:       "user-2",
			resourceType: ResourceOrg,
			resourceID:   "org-999",
			newRole:      RoleAdmin,
			mockFunc: func() {
				mock.ExpectExec("UPDATE memberships").
					WithArgs(RoleAdmin, sqlmock.AnyArg(), "user-2", ResourceOrg, "org-999").
					WillReturnResult(sqlmock.NewResult(0, 0))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			err := mgr.UpdateMemberRole(ctx, tt.userID, tt.resourceType, tt.resourceID, tt.newRole)
			if (err != nil) != tt.wantErr {
				t.Errorf("UpdateMemberRole() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleMembershipManager_RemoveMember(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()

	tests := []struct {
		name         string
		userID       string
		resourceType ResourceType
		resourceID   string
		mockFunc     func()
		wantErr      bool
	}{
		{
			name:         "remove member successfully",
			userID:       "user-1",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			mockFunc: func() {
				mock.ExpectExec("DELETE FROM memberships").
					WithArgs("user-1", ResourceOrg, "org-1").
					WillReturnResult(sqlmock.NewResult(0, 1))
			},
			wantErr: false,
		},
		{
			name:         "membership not found",
			userID:       "user-2",
			resourceType: ResourceOrg,
			resourceID:   "org-999",
			mockFunc: func() {
				mock.ExpectExec("DELETE FROM memberships").
					WithArgs("user-2", ResourceOrg, "org-999").
					WillReturnResult(sqlmock.NewResult(0, 0))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			err := mgr.RemoveMember(ctx, tt.userID, tt.resourceType, tt.resourceID)
			if (err != nil) != tt.wantErr {
				t.Errorf("RemoveMember() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleMembershipManager_GetMembership(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name         string
		userID       string
		resourceType ResourceType
		resourceID   string
		mockFunc     func()
		wantRole     Role
		wantErr      bool
	}{
		{
			name:         "get existing membership",
			userID:       "user-1",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at").
					WithArgs("user-1", ResourceOrg, "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by"}).
						AddRow("mem-1", "user-1", "org", "org-1", "admin", now, now, ""))
			},
			wantRole: RoleAdmin,
			wantErr:  false,
		},
		{
			name:         "membership not found",
			userID:       "user-2",
			resourceType: ResourceOrg,
			resourceID:   "org-999",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at").
					WithArgs("user-2", ResourceOrg, "org-999").
					WillReturnError(sql.ErrNoRows)
			},
			wantRole: "",
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			mem, err := mgr.GetMembership(ctx, tt.userID, tt.resourceType, tt.resourceID)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetMembership() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && mem.Role != tt.wantRole {
				t.Errorf("GetMembership() role = %v, want %v", mem.Role, tt.wantRole)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleMembershipManager_GetUserMemberships(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name     string
		userID   string
		mockFunc func()
		wantLen  int
		wantErr  bool
	}{
		{
			name:   "get all memberships",
			userID: "user-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at").
					WithArgs("user-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by"}).
						AddRow("mem-1", "user-1", "org", "org-1", "owner", now, now, "").
						AddRow("mem-2", "user-1", "org", "org-2", "member", now, now, "").
						AddRow("mem-3", "user-1", "project", "proj-1", "admin", now, now, ""))
			},
			wantLen: 3,
			wantErr: false,
		},
		{
			name:   "no memberships",
			userID: "user-2",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at").
					WithArgs("user-2").
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by"}))
			},
			wantLen: 0,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			memberships, err := mgr.GetUserMemberships(ctx, tt.userID)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetUserMemberships() error = %v, wantErr %v", err, tt.wantErr)
			}
			if len(memberships) != tt.wantLen {
				t.Errorf("GetUserMemberships() len = %v, want %v", len(memberships), tt.wantLen)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleMembershipManager_GetResourceMembers(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name         string
		resourceType ResourceType
		resourceID   string
		mockFunc     func()
		wantLen      int
		wantErr      bool
	}{
		{
			name:         "get org members with user info",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			mockFunc: func() {
				// Query now JOINs with users table and includes name, email
				mock.ExpectQuery("SELECT m.id, m.user_id, m.resource_type, m.resource_id, m.role, m.created_at, m.updated_at").
					WithArgs(ResourceOrg, "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by", "name", "email"}).
						AddRow("mem-1", "user-1", "org", "org-1", "owner", now, now, "", "John Doe", "john@example.com").
						AddRow("mem-2", "user-2", "org", "org-1", "admin", now, now, "user-1", "Jane Smith", "jane@example.com").
						AddRow("mem-3", "user-3", "org", "org-1", "member", now, now, "user-1", "Bob Wilson", "bob@example.com"))
			},
			wantLen: 3,
			wantErr: false,
		},
		{
			name:         "no members",
			resourceType: ResourceProject,
			resourceID:   "proj-empty",
			mockFunc: func() {
				mock.ExpectQuery("SELECT m.id, m.user_id, m.resource_type, m.resource_id, m.role, m.created_at, m.updated_at").
					WithArgs(ResourceProject, "proj-empty").
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by", "name", "email"}))
			},
			wantLen: 0,
			wantErr: false,
		},
		{
			name:         "members with NULL user info (LEFT JOIN)",
			resourceType: ResourceOrg,
			resourceID:   "org-2",
			mockFunc: func() {
				// When user doesn't exist in users table, name/email should be empty
				mock.ExpectQuery("SELECT m.id, m.user_id, m.resource_type, m.resource_id, m.role, m.created_at, m.updated_at").
					WithArgs(ResourceOrg, "org-2").
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by", "name", "email"}).
						AddRow("mem-4", "user-4", "org", "org-2", "owner", now, now, "", "", ""))
			},
			wantLen: 1,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			members, err := mgr.GetResourceMembers(ctx, tt.resourceType, tt.resourceID)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetResourceMembers() error = %v, wantErr %v", err, tt.wantErr)
			}
			if len(members) != tt.wantLen {
				t.Errorf("GetResourceMembers() len = %v, want %v", len(members), tt.wantLen)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}

func TestSimpleMembershipManager_GetResourceMembers_UserInfo(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()
	now := time.Now()

	// Test that user info (name, email) is correctly populated
	mock.ExpectQuery("SELECT m.id, m.user_id, m.resource_type, m.resource_id, m.role, m.created_at, m.updated_at").
		WithArgs(ResourceOrg, "org-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by", "name", "email"}).
			AddRow("mem-1", "user-1", "org", "org-1", "owner", now, now, "", "Chon Le", "chon@example.com").
			AddRow("mem-2", "user-2", "org", "org-1", "member", now, now, "user-1", "Test User", "test@example.com"))

	members, err := mgr.GetResourceMembers(ctx, ResourceOrg, "org-1")
	if err != nil {
		t.Fatalf("GetResourceMembers() error = %v", err)
	}

	if len(members) != 2 {
		t.Fatalf("GetResourceMembers() len = %v, want 2", len(members))
	}

	// Verify first member (owner)
	if members[0].Name != "Chon Le" {
		t.Errorf("members[0].Name = %v, want 'Chon Le'", members[0].Name)
	}
	if members[0].Email != "chon@example.com" {
		t.Errorf("members[0].Email = %v, want 'chon@example.com'", members[0].Email)
	}
	if members[0].Role != RoleOwner {
		t.Errorf("members[0].Role = %v, want 'owner'", members[0].Role)
	}

	// Verify second member
	if members[1].Name != "Test User" {
		t.Errorf("members[1].Name = %v, want 'Test User'", members[1].Name)
	}
	if members[1].Email != "test@example.com" {
		t.Errorf("members[1].Email = %v, want 'test@example.com'", members[1].Email)
	}
	if members[1].InvitedBy != "user-1" {
		t.Errorf("members[1].InvitedBy = %v, want 'user-1'", members[1].InvitedBy)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestSimpleMembershipManager_GetResourceMembers_EmptyUserInfo(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()
	now := time.Now()

	// Test LEFT JOIN behavior - when user doesn't exist, name/email should be empty strings
	mock.ExpectQuery("SELECT m.id, m.user_id, m.resource_type, m.resource_id, m.role, m.created_at, m.updated_at").
		WithArgs(ResourceOrg, "org-orphan").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by", "name", "email"}).
			AddRow("mem-orphan", "deleted-user", "org", "org-orphan", "member", now, now, "", "", ""))

	members, err := mgr.GetResourceMembers(ctx, ResourceOrg, "org-orphan")
	if err != nil {
		t.Fatalf("GetResourceMembers() error = %v", err)
	}

	if len(members) != 1 {
		t.Fatalf("GetResourceMembers() len = %v, want 1", len(members))
	}

	// User info should be empty but not cause error
	if members[0].Name != "" {
		t.Errorf("members[0].Name = %v, want empty string", members[0].Name)
	}
	if members[0].Email != "" {
		t.Errorf("members[0].Email = %v, want empty string", members[0].Email)
	}
	// UserID should still be present
	if members[0].UserID != "deleted-user" {
		t.Errorf("members[0].UserID = %v, want 'deleted-user'", members[0].UserID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestSimpleMembershipManager_IsMember(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock: %v", err)
	}
	defer db.Close()

	mgr := NewSimpleMembershipManager(db)
	ctx := context.Background()

	tests := []struct {
		name         string
		userID       string
		resourceType ResourceType
		resourceID   string
		mockFunc     func()
		want         bool
	}{
		{
			name:         "is member",
			userID:       "user-1",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("user-1", ResourceOrg, "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
			},
			want: true,
		},
		{
			name:         "not member",
			userID:       "user-2",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT EXISTS").
					WithArgs("user-2", ResourceOrg, "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.mockFunc()
			got := mgr.IsMember(ctx, tt.userID, tt.resourceType, tt.resourceID)
			if got != tt.want {
				t.Errorf("IsMember() = %v, want %v", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("unfulfilled expectations: %v", err)
			}
		})
	}
}
