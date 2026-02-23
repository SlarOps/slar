"""
Test permission matrices and role mapping.

These tests verify pure logic - no database needed.
They MUST pass immediately (permissions.py is fully implemented).

Reference: Go's api/authz/authz.go lines 64-150
"""

import pytest

from authz.types import Role, Action
from authz.permissions import (
    ORG_PERMISSIONS,
    PROJECT_PERMISSIONS,
    has_permission,
    map_org_role_to_project_role,
)


# ============================================================
# 1. Org Permission Matrix
#    Reference: Go's authz.OrgPermissions (authz.go:65-94)
# ============================================================

class TestOrgPermissions:
    """Verify org permission matrix matches Go implementation exactly."""

    # --- Owner: full control ---
    def test_owner_can_view(self):
        assert has_permission(ORG_PERMISSIONS, Role.OWNER, Action.VIEW) is True

    def test_owner_can_create(self):
        assert has_permission(ORG_PERMISSIONS, Role.OWNER, Action.CREATE) is True

    def test_owner_can_update(self):
        assert has_permission(ORG_PERMISSIONS, Role.OWNER, Action.UPDATE) is True

    def test_owner_can_delete(self):
        assert has_permission(ORG_PERMISSIONS, Role.OWNER, Action.DELETE) is True

    def test_owner_can_manage(self):
        assert has_permission(ORG_PERMISSIONS, Role.OWNER, Action.MANAGE) is True

    # --- Admin: all except delete ---
    def test_admin_can_view(self):
        assert has_permission(ORG_PERMISSIONS, Role.ADMIN, Action.VIEW) is True

    def test_admin_can_create(self):
        assert has_permission(ORG_PERMISSIONS, Role.ADMIN, Action.CREATE) is True

    def test_admin_can_update(self):
        assert has_permission(ORG_PERMISSIONS, Role.ADMIN, Action.UPDATE) is True

    def test_admin_cannot_delete(self):
        """Admin CANNOT delete org - only owner can."""
        assert has_permission(ORG_PERMISSIONS, Role.ADMIN, Action.DELETE) is False

    def test_admin_can_manage(self):
        assert has_permission(ORG_PERMISSIONS, Role.ADMIN, Action.MANAGE) is True

    # --- Member: view + create only ---
    def test_member_can_view(self):
        assert has_permission(ORG_PERMISSIONS, Role.MEMBER, Action.VIEW) is True

    def test_member_can_create(self):
        assert has_permission(ORG_PERMISSIONS, Role.MEMBER, Action.CREATE) is True

    def test_member_cannot_update(self):
        assert has_permission(ORG_PERMISSIONS, Role.MEMBER, Action.UPDATE) is False

    def test_member_cannot_delete(self):
        assert has_permission(ORG_PERMISSIONS, Role.MEMBER, Action.DELETE) is False

    def test_member_cannot_manage(self):
        assert has_permission(ORG_PERMISSIONS, Role.MEMBER, Action.MANAGE) is False

    # --- Viewer: view only ---
    def test_viewer_can_view(self):
        assert has_permission(ORG_PERMISSIONS, Role.VIEWER, Action.VIEW) is True

    def test_viewer_cannot_create(self):
        assert has_permission(ORG_PERMISSIONS, Role.VIEWER, Action.CREATE) is False

    def test_viewer_cannot_update(self):
        assert has_permission(ORG_PERMISSIONS, Role.VIEWER, Action.UPDATE) is False

    def test_viewer_cannot_delete(self):
        assert has_permission(ORG_PERMISSIONS, Role.VIEWER, Action.DELETE) is False

    def test_viewer_cannot_manage(self):
        assert has_permission(ORG_PERMISSIONS, Role.VIEWER, Action.MANAGE) is False


# ============================================================
# 2. Project Permission Matrix
#    Reference: Go's authz.ProjectPermissions (authz.go:97-126)
# ============================================================

class TestProjectPermissions:
    """Verify project permission matrix matches Go implementation exactly."""

    # --- Owner: full control (same as admin at project level) ---
    def test_owner_can_view(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.OWNER, Action.VIEW) is True

    def test_owner_can_create(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.OWNER, Action.CREATE) is True

    def test_owner_can_update(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.OWNER, Action.UPDATE) is True

    def test_owner_can_delete(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.OWNER, Action.DELETE) is True

    def test_owner_can_manage(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.OWNER, Action.MANAGE) is True

    # --- Admin: full control at project level ---
    def test_admin_can_view(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.ADMIN, Action.VIEW) is True

    def test_admin_can_create(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.ADMIN, Action.CREATE) is True

    def test_admin_can_update(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.ADMIN, Action.UPDATE) is True

    def test_admin_can_delete(self):
        """Admin CAN delete at project level (unlike org level)."""
        assert has_permission(PROJECT_PERMISSIONS, Role.ADMIN, Action.DELETE) is True

    def test_admin_can_manage(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.ADMIN, Action.MANAGE) is True

    # --- Member: view + create + update, no delete/manage ---
    def test_member_can_view(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.MEMBER, Action.VIEW) is True

    def test_member_can_create(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.MEMBER, Action.CREATE) is True

    def test_member_can_update(self):
        """Member CAN update project resources (unlike org level)."""
        assert has_permission(PROJECT_PERMISSIONS, Role.MEMBER, Action.UPDATE) is True

    def test_member_cannot_delete(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.MEMBER, Action.DELETE) is False

    def test_member_cannot_manage(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.MEMBER, Action.MANAGE) is False

    # --- Viewer: view only ---
    def test_viewer_can_view(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.VIEWER, Action.VIEW) is True

    def test_viewer_cannot_create(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.VIEWER, Action.CREATE) is False

    def test_viewer_cannot_update(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.VIEWER, Action.UPDATE) is False

    def test_viewer_cannot_delete(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.VIEWER, Action.DELETE) is False

    def test_viewer_cannot_manage(self):
        assert has_permission(PROJECT_PERMISSIONS, Role.VIEWER, Action.MANAGE) is False


# ============================================================
# 3. has_permission Edge Cases
# ============================================================

class TestHasPermissionEdgeCases:
    """Test edge cases and robustness."""

    def test_unknown_role_returns_false(self):
        """Unknown role should return False, not raise."""
        assert has_permission(ORG_PERMISSIONS, "superadmin", Action.VIEW) is False

    def test_empty_permissions_dict(self):
        """Empty permission matrix should return False."""
        assert has_permission({}, Role.OWNER, Action.VIEW) is False

    def test_all_org_roles_have_view(self):
        """Every defined role should have view permission at org level."""
        for role in Role:
            assert has_permission(ORG_PERMISSIONS, role, Action.VIEW) is True

    def test_all_project_roles_have_view(self):
        """Every defined role should have view permission at project level."""
        for role in Role:
            assert has_permission(PROJECT_PERMISSIONS, role, Action.VIEW) is True

    def test_only_owner_can_delete_org(self):
        """Only owner should be able to delete org."""
        for role in Role:
            if role == Role.OWNER:
                assert has_permission(ORG_PERMISSIONS, role, Action.DELETE) is True
            else:
                assert has_permission(ORG_PERMISSIONS, role, Action.DELETE) is False

    def test_admin_and_owner_can_delete_project(self):
        """Only owner and admin should be able to delete project resources."""
        for role in Role:
            if role in (Role.OWNER, Role.ADMIN):
                assert has_permission(PROJECT_PERMISSIONS, role, Action.DELETE) is True
            else:
                assert has_permission(PROJECT_PERMISSIONS, role, Action.DELETE) is False

    def test_permission_matrices_have_all_roles(self):
        """Both matrices should have entries for all 4 roles."""
        for role in Role:
            assert role in ORG_PERMISSIONS, f"ORG_PERMISSIONS missing {role}"
            assert role in PROJECT_PERMISSIONS, f"PROJECT_PERMISSIONS missing {role}"

    def test_permission_matrices_have_all_actions(self):
        """Every role in both matrices should have entries for all 5 actions."""
        for role in Role:
            for action in Action:
                assert action in ORG_PERMISSIONS[role], \
                    f"ORG_PERMISSIONS[{role}] missing {action}"
                assert action in PROJECT_PERMISSIONS[role], \
                    f"PROJECT_PERMISSIONS[{role}] missing {action}"

    def test_org_vs_project_key_differences(self):
        """Verify the key differences between org and project permissions."""
        # Admin can delete at project level but NOT at org level
        assert has_permission(ORG_PERMISSIONS, Role.ADMIN, Action.DELETE) is False
        assert has_permission(PROJECT_PERMISSIONS, Role.ADMIN, Action.DELETE) is True

        # Member can update at project level but NOT at org level
        assert has_permission(ORG_PERMISSIONS, Role.MEMBER, Action.UPDATE) is False
        assert has_permission(PROJECT_PERMISSIONS, Role.MEMBER, Action.UPDATE) is True


# ============================================================
# 4. Role Mapping (org -> project inheritance)
#    Reference: Go's authz.MapOrgRoleToProjectRole (authz.go:138-150)
# ============================================================

class TestMapOrgRoleToProjectRole:
    """Verify role inheritance mapping matches Go implementation."""

    def test_owner_maps_to_admin(self):
        """Org owner inherits as project admin (not owner)."""
        assert map_org_role_to_project_role(Role.OWNER) == Role.ADMIN

    def test_admin_maps_to_admin(self):
        """Org admin inherits as project admin."""
        assert map_org_role_to_project_role(Role.ADMIN) == Role.ADMIN

    def test_member_maps_to_member(self):
        """Org member inherits as project member."""
        assert map_org_role_to_project_role(Role.MEMBER) == Role.MEMBER

    def test_viewer_maps_to_viewer(self):
        """Org viewer inherits as project viewer."""
        assert map_org_role_to_project_role(Role.VIEWER) == Role.VIEWER

    def test_unknown_role_returns_none(self):
        """Unknown role should return None."""
        assert map_org_role_to_project_role("superadmin") is None

    def test_owner_and_admin_have_same_inherited_role(self):
        """Both owner and admin map to admin - no 'owner' at project level."""
        owner_mapped = map_org_role_to_project_role(Role.OWNER)
        admin_mapped = map_org_role_to_project_role(Role.ADMIN)
        assert owner_mapped == admin_mapped == Role.ADMIN


# ============================================================
# 5. Enum Value Tests (ensure sync with Go constants)
# ============================================================

class TestEnumValues:
    """Verify enum values match Go string constants exactly."""

    def test_role_values(self):
        assert Role.OWNER.value == "owner"
        assert Role.ADMIN.value == "admin"
        assert Role.MEMBER.value == "member"
        assert Role.VIEWER.value == "viewer"

    def test_action_values(self):
        assert Action.VIEW.value == "view"
        assert Action.CREATE.value == "create"
        assert Action.UPDATE.value == "update"
        assert Action.DELETE.value == "delete"
        assert Action.MANAGE.value == "manage"

    def test_role_count(self):
        """Exactly 4 roles defined (same as Go)."""
        assert len(Role) == 4

    def test_action_count(self):
        """Exactly 5 actions defined (same as Go)."""
        assert len(Action) == 5

    def test_roles_are_strings(self):
        """Roles should be usable as strings (for DB queries)."""
        assert str(Role.OWNER) == "Role.OWNER"
        assert Role.OWNER.value == "owner"
        # Should work in string comparisons
        assert Role.OWNER == "owner"

    def test_actions_are_strings(self):
        """Actions should be usable as strings."""
        assert Action.VIEW == "view"
