"""
Authorization types matching Go's api/authz/authz.go.

Defines:
- Role: owner, admin, member, viewer
- Action: view, create, update, delete, manage
- ResourceType: org, project
"""

from enum import Enum


class Role(str, Enum):
    """User role in an organization or project.
    Matches Go's authz.Role constants."""

    OWNER = "owner"    # Full control (org only)
    ADMIN = "admin"    # Manage members, settings
    MEMBER = "member"  # Full access to resources
    VIEWER = "viewer"  # Read-only access


class Action(str, Enum):
    """Operation that can be performed on a resource.
    Matches Go's authz.Action constants."""

    VIEW = "view"      # Read access
    CREATE = "create"  # Create new resources
    UPDATE = "update"  # Modify existing resources
    DELETE = "delete"  # Remove resources
    MANAGE = "manage"  # Administrative actions (manage members, settings)


class ResourceType(str, Enum):
    """Type of resource being accessed.
    Matches Go's authz.ResourceType constants."""

    ORG = "org"
    PROJECT = "project"
