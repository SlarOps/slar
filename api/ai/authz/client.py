"""
AuthzClient - HTTP client for authorization via Go API.

Follows "Centralized Authority, Distributed Execution" pattern:
- Agent (Python) NEVER queries memberships table directly
- Agent calls Go API for ALL authorization decisions
- Go API is the single source of truth for ReBAC

Usage:
    client = AuthzClient(go_api_url="http://localhost:8080")
    role = await client.get_project_role(user_id, project_id)
    allowed = await client.check_access(user_id, "project", project_id, "view")
"""

import logging
from typing import Optional

import httpx

from .types import Role, Action, ResourceType

logger = logging.getLogger(__name__)

# Default timeout for internal API calls (seconds)
DEFAULT_TIMEOUT = 5.0


class AuthzClient:
    """
    HTTP-based authorization client that delegates to Go API.

    The Agent NEVER makes authorization decisions itself.
    All checks go through Go API's /internal/authz/* endpoints.
    """

    def __init__(self, go_api_url: str, timeout: float = DEFAULT_TIMEOUT):
        """
        Args:
            go_api_url: Base URL of Go API (e.g. "http://localhost:8080")
            timeout: HTTP request timeout in seconds
        """
        self.base_url = go_api_url.rstrip("/")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create async HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
            )
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # ================================================================
    # Organization Access
    # ================================================================

    async def get_org_role(self, user_id: str, org_id: str) -> Optional[Role]:
        """
        Get user's role in an organization.
        Calls: GET /internal/authz/org/{org_id}/role?user_id={user_id}

        Returns:
            Role enum or None if no membership
        """
        client = await self._get_client()
        try:
            resp = await client.get(
                f"/internal/authz/org/{org_id}/role",
                params={"user_id": user_id},
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            role_str = data.get("role")
            return Role(role_str) if role_str else None
        except httpx.HTTPStatusError as e:
            logger.warning(f"AuthzClient.get_org_role failed: {e}")
            return None
        except Exception as e:
            logger.error(f"AuthzClient.get_org_role error: {e}")
            raise

    async def can_access_org(self, user_id: str, org_id: str) -> bool:
        """Check if user has any access to org."""
        role = await self.get_org_role(user_id, org_id)
        return role is not None

    # ================================================================
    # Project Access
    # ================================================================

    async def get_project_role(
        self, user_id: str, project_id: str
    ) -> Optional[Role]:
        """
        Get user's effective role in a project.
        Calls: GET /internal/authz/project/{project_id}/role?user_id={user_id}

        Go API handles all priority logic:
          Priority 0: Org owner/admin -> ALWAYS admin
          Priority 1: Explicit project membership
          Priority 2: Org member/viewer -> inherit if project is "open"

        Returns:
            Effective Role or None if no access
        """
        client = await self._get_client()
        try:
            resp = await client.get(
                f"/internal/authz/project/{project_id}/role",
                params={"user_id": user_id},
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            role_str = data.get("role")
            return Role(role_str) if role_str else None
        except httpx.HTTPStatusError as e:
            logger.warning(f"AuthzClient.get_project_role failed: {e}")
            return None
        except Exception as e:
            logger.error(f"AuthzClient.get_project_role error: {e}")
            raise

    async def can_access_project(self, user_id: str, project_id: str) -> bool:
        """Check if user has any access to project."""
        role = await self.get_project_role(user_id, project_id)
        return role is not None

    # ================================================================
    # Action-Level Checks
    # ================================================================

    async def check_access(
        self,
        user_id: str,
        resource_type: str,
        resource_id: str,
        action: str,
    ) -> bool:
        """
        Check if user can perform action on resource.
        Calls: POST /internal/authz/check

        Args:
            user_id: User UUID
            resource_type: "org" or "project"
            resource_id: Resource UUID
            action: "view", "create", "update", "delete", "manage"

        Returns:
            True if allowed
        """
        client = await self._get_client()
        try:
            resp = await client.post(
                "/internal/authz/check",
                json={
                    "user_id": user_id,
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                    "action": action,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("allowed", False)
        except httpx.HTTPStatusError as e:
            logger.warning(f"AuthzClient.check_access failed: {e}")
            return False
        except Exception as e:
            logger.error(f"AuthzClient.check_access error: {e}")
            raise

    async def can_perform_org_action(
        self, user_id: str, org_id: str, action: Action
    ) -> bool:
        """Check if user can perform action on org."""
        return await self.check_access(
            user_id, ResourceType.ORG, org_id, action
        )

    async def can_perform_project_action(
        self, user_id: str, project_id: str, action: Action
    ) -> bool:
        """Check if user can perform action on project."""
        return await self.check_access(
            user_id, ResourceType.PROJECT, project_id, action
        )
