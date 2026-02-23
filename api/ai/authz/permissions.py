"""
Permission matrices matching Go's api/authz/authz.go.

These define what actions each role can perform at org and project levels.
MUST stay in sync with Go implementation.

Reference: api/authz/authz.go lines 64-126
"""

from .types import Role, Action


# OrgPermissions: what actions each role can perform at org level
# Matches Go's authz.OrgPermissions exactly
ORG_PERMISSIONS: dict[Role, dict[Action, bool]] = {
    Role.OWNER: {
        Action.VIEW: True,
        Action.CREATE: True,
        Action.UPDATE: True,
        Action.DELETE: True,
        Action.MANAGE: True,
    },
    Role.ADMIN: {
        Action.VIEW: True,
        Action.CREATE: True,
        Action.UPDATE: True,
        Action.DELETE: False,   # Admin cannot delete org
        Action.MANAGE: True,
    },
    Role.MEMBER: {
        Action.VIEW: True,
        Action.CREATE: True,
        Action.UPDATE: False,   # Member cannot update org settings
        Action.DELETE: False,
        Action.MANAGE: False,
    },
    Role.VIEWER: {
        Action.VIEW: True,
        Action.CREATE: False,   # Viewer is read-only
        Action.UPDATE: False,
        Action.DELETE: False,
        Action.MANAGE: False,
    },
}


# ProjectPermissions: what actions each role can perform at project level
# Matches Go's authz.ProjectPermissions exactly
PROJECT_PERMISSIONS: dict[Role, dict[Action, bool]] = {
    Role.OWNER: {
        Action.VIEW: True,
        Action.CREATE: True,
        Action.UPDATE: True,
        Action.DELETE: True,
        Action.MANAGE: True,
    },
    Role.ADMIN: {
        Action.VIEW: True,
        Action.CREATE: True,
        Action.UPDATE: True,
        Action.DELETE: True,
        Action.MANAGE: True,
    },
    Role.MEMBER: {
        Action.VIEW: True,
        Action.CREATE: True,
        Action.UPDATE: True,
        Action.DELETE: False,   # Member cannot delete project resources
        Action.MANAGE: False,   # Member cannot manage project settings
    },
    Role.VIEWER: {
        Action.VIEW: True,
        Action.CREATE: False,   # Viewer is read-only
        Action.UPDATE: False,
        Action.DELETE: False,
        Action.MANAGE: False,
    },
}


def has_permission(
    permissions: dict[Role, dict[Action, bool]],
    role: Role,
    action: Action,
) -> bool:
    """
    Check if a role has permission to perform an action.

    Matches Go's authz.HasPermission exactly.
    Returns False for unknown roles or actions.

    Args:
        permissions: Permission matrix (ORG_PERMISSIONS or PROJECT_PERMISSIONS)
        role: User's role
        action: Action to check

    Returns:
        True if allowed, False otherwise
    """
    role_perms = permissions.get(role)
    if role_perms is None:
        return False
    return role_perms.get(action, False)


def map_org_role_to_project_role(org_role: Role) -> Role | None:
    """
    Map an organization role to a project role for inheritance.

    Matches Go's authz.MapOrgRoleToProjectRole exactly:
    - owner/admin -> admin (highest inherited project role)
    - member -> member
    - viewer -> viewer
    - unknown -> None

    Args:
        org_role: User's role in the organization

    Returns:
        Inherited project role, or None for unknown roles
    """
    if org_role in (Role.OWNER, Role.ADMIN):
        return Role.ADMIN
    elif org_role == Role.MEMBER:
        return Role.MEMBER
    elif org_role == Role.VIEWER:
        return Role.VIEWER
    else:
        return None
