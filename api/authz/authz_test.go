package authz

import (
	"testing"
)

func TestHasPermission(t *testing.T) {
	tests := []struct {
		name        string
		permissions map[Role]map[Action]bool
		role        Role
		action      Action
		want        bool
	}{
		// Org Owner permissions
		{"org owner can view", OrgPermissions, RoleOwner, ActionView, true},
		{"org owner can create", OrgPermissions, RoleOwner, ActionCreate, true},
		{"org owner can update", OrgPermissions, RoleOwner, ActionUpdate, true},
		{"org owner can delete", OrgPermissions, RoleOwner, ActionDelete, true},
		{"org owner can manage", OrgPermissions, RoleOwner, ActionManage, true},

		// Org Admin permissions
		{"org admin can view", OrgPermissions, RoleAdmin, ActionView, true},
		{"org admin can create", OrgPermissions, RoleAdmin, ActionCreate, true},
		{"org admin can update", OrgPermissions, RoleAdmin, ActionUpdate, true},
		{"org admin cannot delete", OrgPermissions, RoleAdmin, ActionDelete, false},
		{"org admin can manage", OrgPermissions, RoleAdmin, ActionManage, true},

		// Org Member permissions
		{"org member can view", OrgPermissions, RoleMember, ActionView, true},
		{"org member can create", OrgPermissions, RoleMember, ActionCreate, true},
		{"org member cannot update", OrgPermissions, RoleMember, ActionUpdate, false},
		{"org member cannot delete", OrgPermissions, RoleMember, ActionDelete, false},
		{"org member cannot manage", OrgPermissions, RoleMember, ActionManage, false},

		// Org Viewer permissions
		{"org viewer can view", OrgPermissions, RoleViewer, ActionView, true},
		{"org viewer cannot create", OrgPermissions, RoleViewer, ActionCreate, false},
		{"org viewer cannot update", OrgPermissions, RoleViewer, ActionUpdate, false},
		{"org viewer cannot delete", OrgPermissions, RoleViewer, ActionDelete, false},
		{"org viewer cannot manage", OrgPermissions, RoleViewer, ActionManage, false},

		// Project Admin permissions
		{"project admin can view", ProjectPermissions, RoleAdmin, ActionView, true},
		{"project admin can create", ProjectPermissions, RoleAdmin, ActionCreate, true},
		{"project admin can update", ProjectPermissions, RoleAdmin, ActionUpdate, true},
		{"project admin can delete", ProjectPermissions, RoleAdmin, ActionDelete, true},
		{"project admin can manage", ProjectPermissions, RoleAdmin, ActionManage, true},

		// Project Member permissions
		{"project member can view", ProjectPermissions, RoleMember, ActionView, true},
		{"project member can create", ProjectPermissions, RoleMember, ActionCreate, true},
		{"project member can update", ProjectPermissions, RoleMember, ActionUpdate, true},
		{"project member cannot delete", ProjectPermissions, RoleMember, ActionDelete, false},
		{"project member cannot manage", ProjectPermissions, RoleMember, ActionManage, false},

		// Project Viewer permissions
		{"project viewer can view", ProjectPermissions, RoleViewer, ActionView, true},
		{"project viewer cannot create", ProjectPermissions, RoleViewer, ActionCreate, false},
		{"project viewer cannot update", ProjectPermissions, RoleViewer, ActionUpdate, false},
		{"project viewer cannot delete", ProjectPermissions, RoleViewer, ActionDelete, false},
		{"project viewer cannot manage", ProjectPermissions, RoleViewer, ActionManage, false},

		// Invalid role
		{"invalid role returns false", OrgPermissions, Role("invalid"), ActionView, false},
		{"empty role returns false", OrgPermissions, Role(""), ActionView, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := HasPermission(tt.permissions, tt.role, tt.action)
			if got != tt.want {
				t.Errorf("HasPermission() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMapOrgRoleToProjectRole(t *testing.T) {
	tests := []struct {
		name    string
		orgRole Role
		want    Role
	}{
		{"owner maps to admin", RoleOwner, RoleAdmin},
		{"admin maps to admin", RoleAdmin, RoleAdmin},
		{"member maps to member", RoleMember, RoleMember},
		{"viewer maps to viewer", RoleViewer, RoleViewer},
		{"empty maps to empty", Role(""), Role("")},
		{"invalid maps to empty", Role("invalid"), Role("")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MapOrgRoleToProjectRole(tt.orgRole)
			if got != tt.want {
				t.Errorf("MapOrgRoleToProjectRole() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRoleConstants(t *testing.T) {
	// Ensure role constants have expected values
	if RoleOwner != "owner" {
		t.Errorf("RoleOwner = %v, want owner", RoleOwner)
	}
	if RoleAdmin != "admin" {
		t.Errorf("RoleAdmin = %v, want admin", RoleAdmin)
	}
	if RoleMember != "member" {
		t.Errorf("RoleMember = %v, want member", RoleMember)
	}
	if RoleViewer != "viewer" {
		t.Errorf("RoleViewer = %v, want viewer", RoleViewer)
	}
}

func TestActionConstants(t *testing.T) {
	// Ensure action constants have expected values
	if ActionView != "view" {
		t.Errorf("ActionView = %v, want view", ActionView)
	}
	if ActionCreate != "create" {
		t.Errorf("ActionCreate = %v, want create", ActionCreate)
	}
	if ActionUpdate != "update" {
		t.Errorf("ActionUpdate = %v, want update", ActionUpdate)
	}
	if ActionDelete != "delete" {
		t.Errorf("ActionDelete = %v, want delete", ActionDelete)
	}
	if ActionManage != "manage" {
		t.Errorf("ActionManage = %v, want manage", ActionManage)
	}
}

func TestResourceTypeConstants(t *testing.T) {
	if ResourceOrg != "org" {
		t.Errorf("ResourceOrg = %v, want org", ResourceOrg)
	}
	if ResourceProject != "project" {
		t.Errorf("ResourceProject = %v, want project", ResourceProject)
	}
}
