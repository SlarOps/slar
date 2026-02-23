"""
FastAPI dependency injection for authorization.

All authorization decisions are delegated to Go API via AuthzClient.
Agent NEVER queries the database directly for authorization.

Usage in routes:
    from authz.dependencies import require_project_admin

    @router.post("/endpoint")
    async def handler(auth: tuple[str, str] = Depends(require_project_admin)):
        user_id, project_id = auth
        ...
"""

import os
import logging
from typing import Optional, Tuple

from fastapi import HTTPException

from .client import AuthzClient
from .types import Role

logger = logging.getLogger(__name__)

# Global AuthzClient instance (initialized at startup)
_authz_client: Optional[AuthzClient] = None


def init_authz_client(go_api_url: str = None) -> None:
    """
    Initialize global AuthzClient. Call in app lifespan.

    Args:
        go_api_url: Go API base URL. Falls back to API_BASE_URL env var
                    or http://localhost:8080
    """
    global _authz_client
    url = go_api_url or os.getenv("API_BASE_URL", "http://localhost:8080")
    _authz_client = AuthzClient(go_api_url=url)
    logger.info(f"AuthzClient initialized -> {url}")


def get_authz_client() -> AuthzClient:
    """Get the global AuthzClient instance."""
    if _authz_client is None:
        raise RuntimeError(
            "AuthzClient not initialized. Call init_authz_client() first."
        )
    return _authz_client


async def get_current_user(authorization: Optional[str] = None) -> str:
    """
    Extract and verify user_id from Authorization header.

    Raises:
        HTTPException(401) if token is missing or invalid
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    from workspace_service import extract_user_id_from_token
    user_id = extract_user_id_from_token(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authorization token")

    return user_id


async def require_org_access(
    user_id: str = "",
    org_id: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Require user to have access to organization.
    Delegates check to Go API via AuthzClient.

    Returns: (user_id, org_id)

    Raises:
        HTTPException(400) if org_id missing
        HTTPException(403) if no org access
    """
    if not org_id:
        raise HTTPException(status_code=400, detail="Missing X-Org-ID header")

    client = get_authz_client()
    if not await client.can_access_org(user_id, org_id):
        raise HTTPException(status_code=403, detail="No access to this organization")

    return user_id, org_id


async def require_project_access(
    user_id: str = "",
    project_id: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Require user to have access to project.
    Delegates check to Go API via AuthzClient.

    Returns: (user_id, project_id)

    Raises:
        HTTPException(400) if project_id missing
        HTTPException(403) if no project access
    """
    if not project_id:
        raise HTTPException(status_code=400, detail="Missing X-Project-ID header")

    client = get_authz_client()
    if not await client.can_access_project(user_id, project_id):
        raise HTTPException(status_code=403, detail="No access to this project")

    return user_id, project_id


async def require_project_admin(
    user_id: str = "",
    project_id: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Require admin/owner role in project.
    Delegates role check to Go API via AuthzClient.

    Returns: (user_id, project_id)

    Raises:
        HTTPException(400) if project_id missing
        HTTPException(403) if not admin/owner
    """
    if not project_id:
        raise HTTPException(status_code=400, detail="Missing X-Project-ID header")

    client = get_authz_client()
    role = await client.get_project_role(user_id, project_id)
    if role not in (Role.ADMIN, Role.OWNER):
        raise HTTPException(status_code=403, detail="Requires admin or owner role")

    return user_id, project_id
