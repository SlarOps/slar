"""
Authorization module for AI Agent service.

Architecture: "Centralized Authority, Distributed Execution"
- Go API is the single source of truth for all authorization decisions
- Agent delegates ALL authz checks to Go API via AuthzClient (HTTP)
- Agent NEVER queries memberships table directly

Components:
- types.py: Role, Action, ResourceType enums (shared vocabulary)
- permissions.py: Permission matrices (reference data for client-side hints)
- client.py: AuthzClient - HTTP client to Go API for authorization
- dependencies.py: FastAPI dependency injection using AuthzClient
- exceptions.py: Custom authorization exceptions
"""

from .types import Role, Action, ResourceType
from .permissions import (
    ORG_PERMISSIONS,
    PROJECT_PERMISSIONS,
    has_permission,
    map_org_role_to_project_role,
)
from .client import AuthzClient
from .exceptions import (
    AuthzError,
    ForbiddenError,
    UnauthorizedError,
    MissingContextError,
)

__all__ = [
    "Role",
    "Action",
    "ResourceType",
    "ORG_PERMISSIONS",
    "PROJECT_PERMISSIONS",
    "has_permission",
    "map_org_role_to_project_role",
    "AuthzClient",
    "AuthzError",
    "ForbiddenError",
    "UnauthorizedError",
    "MissingContextError",
]
