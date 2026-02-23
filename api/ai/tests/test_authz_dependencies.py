"""
Test FastAPI authorization dependencies.

These tests verify the behavior of dependency injection functions
that protect API routes. Dependencies delegate to Go API via AuthzClient.

Uses mock AuthzClient - no real Go API or database needed.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from authz.types import Role
from authz.client import AuthzClient
from authz.dependencies import (
    init_authz_client,
    get_authz_client,
    get_current_user,
    require_org_access,
    require_project_access,
    require_project_admin,
)

from tests.test_data import (
    ORG_ALPHA_ID,
    PROJECT_WEB_ID,
    USER_ORG_OWNER_ID,
    USER_ORG_ADMIN_ID,
    USER_ORG_MEMBER_ID,
    USER_ORG_VIEWER_ID,
    USER_PROJECT_MEMBER_ID,
    USER_OUTSIDER_ID,
)


# ============================================================
# 1. init_authz_client / get_authz_client
# ============================================================

class TestAuthzClientLifecycle:
    """Test AuthzClient initialization and retrieval."""

    def test_init_creates_instance(self):
        """init_authz_client should create an AuthzClient."""
        init_authz_client("http://localhost:8080")
        client = get_authz_client()
        assert client is not None
        assert isinstance(client, AuthzClient)

    def test_get_before_init_raises(self):
        """get_authz_client before init should raise RuntimeError."""
        import authz.dependencies as deps
        original = deps._authz_client
        deps._authz_client = None
        try:
            with pytest.raises(RuntimeError, match="AuthzClient not initialized"):
                get_authz_client()
        finally:
            deps._authz_client = original

    def test_init_uses_env_fallback(self):
        """init_authz_client without arg should use API_BASE_URL env."""
        with patch.dict("os.environ", {"API_BASE_URL": "http://go-api:8080"}):
            init_authz_client()
            client = get_authz_client()
            assert client.base_url == "http://go-api:8080"


# ============================================================
# 2. get_current_user
# ============================================================

class TestGetCurrentUser:
    """Test user extraction from Authorization header."""

    @pytest.mark.asyncio
    async def test_missing_token_raises_401(self):
        """Missing Authorization header should raise 401."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(authorization=None)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_empty_token_raises_401(self):
        """Empty Authorization header should raise 401."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(authorization="")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_valid_token_returns_user_id(self):
        """Valid token should return extracted user_id."""
        with patch("workspace_service.extract_user_id_from_token") as mock_extract:
            mock_extract.return_value = USER_ORG_OWNER_ID
            user_id = await get_current_user(authorization="Bearer valid-token")
            assert user_id == USER_ORG_OWNER_ID

    @pytest.mark.asyncio
    async def test_invalid_token_raises_401(self):
        """Invalid token (extract returns None) should raise 401."""
        from fastapi import HTTPException
        with patch("workspace_service.extract_user_id_from_token") as mock_extract:
            mock_extract.return_value = None
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(authorization="Bearer invalid-token")
            assert exc_info.value.status_code == 401


# ============================================================
# 3. require_org_access (delegates to AuthzClient -> Go API)
# ============================================================

class TestRequireOrgAccess:
    """Test org access dependency - delegates to Go API."""

    @pytest.mark.asyncio
    async def test_missing_org_id_raises_400(self):
        """Missing X-Org-ID should raise 400."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await require_org_access(
                user_id=USER_ORG_OWNER_ID,
                org_id=None,
            )
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_valid_access_returns_tuple(self):
        """User with org access should get (user_id, org_id)."""
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.can_access_org.return_value = True

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            result = await require_org_access(
                user_id=USER_ORG_OWNER_ID,
                org_id=ORG_ALPHA_ID,
            )
        assert result == (USER_ORG_OWNER_ID, ORG_ALPHA_ID)
        mock_client.can_access_org.assert_awaited_once_with(USER_ORG_OWNER_ID, ORG_ALPHA_ID)

    @pytest.mark.asyncio
    async def test_no_access_raises_403(self):
        """User without org access should get 403."""
        from fastapi import HTTPException
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.can_access_org.return_value = False

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_access(
                    user_id=USER_OUTSIDER_ID,
                    org_id=ORG_ALPHA_ID,
                )
            assert exc_info.value.status_code == 403


# ============================================================
# 4. require_project_access (delegates to AuthzClient -> Go API)
# ============================================================

class TestRequireProjectAccess:
    """Test project access dependency - delegates to Go API."""

    @pytest.mark.asyncio
    async def test_missing_project_id_raises_400(self):
        """Missing X-Project-ID should raise 400."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await require_project_access(
                user_id=USER_ORG_OWNER_ID,
                project_id=None,
            )
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_valid_access_returns_tuple(self):
        """User with project access should get (user_id, project_id)."""
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.can_access_project.return_value = True

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            result = await require_project_access(
                user_id=USER_ORG_OWNER_ID,
                project_id=PROJECT_WEB_ID,
            )
        assert result == (USER_ORG_OWNER_ID, PROJECT_WEB_ID)
        mock_client.can_access_project.assert_awaited_once_with(USER_ORG_OWNER_ID, PROJECT_WEB_ID)

    @pytest.mark.asyncio
    async def test_no_access_raises_403(self):
        """User without project access should get 403."""
        from fastapi import HTTPException
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.can_access_project.return_value = False

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await require_project_access(
                    user_id=USER_OUTSIDER_ID,
                    project_id=PROJECT_WEB_ID,
                )
            assert exc_info.value.status_code == 403


# ============================================================
# 5. require_project_admin (delegates to AuthzClient -> Go API)
# ============================================================

class TestRequireProjectAdmin:
    """Test project admin requirement - delegates to Go API."""

    @pytest.mark.asyncio
    async def test_missing_project_id_raises_400(self):
        """Missing project_id should raise 400."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            await require_project_admin(
                user_id=USER_ORG_OWNER_ID,
                project_id=None,
            )
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_admin_allowed(self):
        """User with admin role should pass."""
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.get_project_role.return_value = Role.ADMIN

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            result = await require_project_admin(
                user_id=USER_ORG_ADMIN_ID,
                project_id=PROJECT_WEB_ID,
            )
        assert result == (USER_ORG_ADMIN_ID, PROJECT_WEB_ID)

    @pytest.mark.asyncio
    async def test_owner_allowed(self):
        """User with owner role should pass."""
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.get_project_role.return_value = Role.OWNER

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            result = await require_project_admin(
                user_id=USER_ORG_OWNER_ID,
                project_id=PROJECT_WEB_ID,
            )
        assert result == (USER_ORG_OWNER_ID, PROJECT_WEB_ID)

    @pytest.mark.asyncio
    async def test_member_rejected(self):
        """User with member role should be rejected (403)."""
        from fastapi import HTTPException
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.get_project_role.return_value = Role.MEMBER

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await require_project_admin(
                    user_id=USER_PROJECT_MEMBER_ID,
                    project_id=PROJECT_WEB_ID,
                )
            assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_viewer_rejected(self):
        """User with viewer role should be rejected (403)."""
        from fastapi import HTTPException
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.get_project_role.return_value = Role.VIEWER

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await require_project_admin(
                    user_id=USER_ORG_VIEWER_ID,
                    project_id=PROJECT_WEB_ID,
                )
            assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_no_role_rejected(self):
        """User with no role (None) should be rejected (403)."""
        from fastapi import HTTPException
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.get_project_role.return_value = None

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await require_project_admin(
                    user_id=USER_OUTSIDER_ID,
                    project_id=PROJECT_WEB_ID,
                )
            assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_delegates_to_go_api(self):
        """Verify the dependency calls AuthzClient (which calls Go API)."""
        mock_client = AsyncMock(spec=AuthzClient)
        mock_client.get_project_role.return_value = Role.ADMIN

        with patch("authz.dependencies.get_authz_client", return_value=mock_client):
            await require_project_admin(
                user_id=USER_ORG_ADMIN_ID,
                project_id=PROJECT_WEB_ID,
            )

        # Verify AuthzClient was called with correct args
        mock_client.get_project_role.assert_awaited_once_with(
            USER_ORG_ADMIN_ID, PROJECT_WEB_ID
        )
