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
			name:         "get org members",
			resourceType: ResourceOrg,
			resourceID:   "org-1",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at").
					WithArgs(ResourceOrg, "org-1").
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by"}).
						AddRow("mem-1", "user-1", "org", "org-1", "owner", now, now, "").
						AddRow("mem-2", "user-2", "org", "org-1", "admin", now, now, "user-1").
						AddRow("mem-3", "user-3", "org", "org-1", "member", now, now, "user-1"))
			},
			wantLen: 3,
			wantErr: false,
		},
		{
			name:         "no members",
			resourceType: ResourceProject,
			resourceID:   "proj-empty",
			mockFunc: func() {
				mock.ExpectQuery("SELECT id, user_id, resource_type, resource_id, role, created_at, updated_at").
					WithArgs(ResourceProject, "proj-empty").
					WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "resource_type", "resource_id", "role", "created_at", "updated_at", "invited_by"}))
			},
			wantLen: 0,
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
