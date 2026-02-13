"""
Test AuthzClient - HTTP client to Go API for authorization.

Tests mock httpx responses to verify AuthzClient correctly:
- Calls the right Go API endpoints
- Parses responses into Role enums
- Handles errors gracefully (404, 500, network errors)

No real Go API or database needed.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

import httpx

from authz.client import AuthzClient
from authz.types import Role, Action, ResourceType

from tests.test_data import (
    ORG_ALPHA_ID,
    ORG_BETA_ID,
    PROJECT_WEB_ID,
    PROJECT_API_ID,
    USER_ORG_OWNER_ID,
    USER_ORG_ADMIN_ID,
    USER_ORG_MEMBER_ID,
    USER_ORG_VIEWER_ID,
    USER_OUTSIDER_ID,
)


@pytest.fixture
def client():
    """Create an AuthzClient pointing to a fake Go API."""
    return AuthzClient(go_api_url="http://go-api:8080")


def _mock_response(status_code: int = 200, json_data: dict = None):
    """Create a mock httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            message=f"HTTP {status_code}",
            request=MagicMock(),
            response=resp,
        )
    else:
        resp.raise_for_status.return_value = None
    return resp


# ============================================================
# 1. get_org_role
# ============================================================

class TestGetOrgRole:
    """Test org role lookup via Go API."""

    @pytest.mark.asyncio
    async def test_returns_role_on_success(self, client):
        """Should return Role enum when Go API returns role."""
        mock_resp = _mock_response(200, {"role": "owner"})

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get.return_value = mock_resp
            mock_get.return_value = mock_http

            role = await client.get_org_role(USER_ORG_OWNER_ID, ORG_ALPHA_ID)

        assert role == Role.OWNER
        mock_http.get.assert_awaited_once_with(
            f"/internal/authz/org/{ORG_ALPHA_ID}/role",
            params={"user_id": USER_ORG_OWNER_ID},
        )

    @pytest.mark.asyncio
    async def test_returns_none_on_404(self, client):
        """Should return None when Go API returns 404 (no membership)."""
        mock_resp = _mock_response(404)
        mock_resp.raise_for_status.side_effect = None  # 404 is handled before raise

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get.return_value = mock_resp
            mock_get.return_value = mock_http

            role = await client.get_org_role(USER_OUTSIDER_ID, ORG_ALPHA_ID)

        assert role is None

    @pytest.mark.asyncio
    async def test_returns_none_on_empty_role(self, client):
        """Should return None when Go API returns empty role."""
        mock_resp = _mock_response(200, {"role": None})

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get.return_value = mock_resp
            mock_get.return_value = mock_http

            role = await client.get_org_role(USER_OUTSIDER_ID, ORG_ALPHA_ID)

        assert role is None

    @pytest.mark.asyncio
    async def test_returns_none_on_500(self, client):
        """Should return None on server error (fail-safe)."""
        mock_resp = _mock_response(500)

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get.return_value = mock_resp
            mock_get.return_value = mock_http

            role = await client.get_org_role(USER_ORG_OWNER_ID, ORG_ALPHA_ID)

        assert role is None

    @pytest.mark.asyncio
    async def test_all_role_values(self, client):
        """Should correctly parse all role string values."""
        for role_enum in Role:
            mock_resp = _mock_response(200, {"role": role_enum.value})

            with patch.object(client, "_get_client") as mock_get:
                mock_http = AsyncMock()
                mock_http.get.return_value = mock_resp
                mock_get.return_value = mock_http

                result = await client.get_org_role(USER_ORG_OWNER_ID, ORG_ALPHA_ID)

            assert result == role_enum


# ============================================================
# 2. can_access_org
# ============================================================

class TestCanAccessOrg:
    """Test org access boolean check."""

    @pytest.mark.asyncio
    async def test_true_when_role_exists(self, client):
        """Should return True when user has any role."""
        with patch.object(client, "get_org_role", return_value=Role.VIEWER):
            result = await client.can_access_org(USER_ORG_VIEWER_ID, ORG_ALPHA_ID)
        assert result is True

    @pytest.mark.asyncio
    async def test_false_when_no_role(self, client):
        """Should return False when user has no role."""
        with patch.object(client, "get_org_role", return_value=None):
            result = await client.can_access_org(USER_OUTSIDER_ID, ORG_ALPHA_ID)
        assert result is False


# ============================================================
# 3. get_project_role
# ============================================================

class TestGetProjectRole:
    """Test project role lookup via Go API."""

    @pytest.mark.asyncio
    async def test_returns_role_on_success(self, client):
        """Should return Role enum when Go API returns role."""
        mock_resp = _mock_response(200, {"role": "admin"})

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get.return_value = mock_resp
            mock_get.return_value = mock_http

            role = await client.get_project_role(USER_ORG_OWNER_ID, PROJECT_WEB_ID)

        assert role == Role.ADMIN
        mock_http.get.assert_awaited_once_with(
            f"/internal/authz/project/{PROJECT_WEB_ID}/role",
            params={"user_id": USER_ORG_OWNER_ID},
        )

    @pytest.mark.asyncio
    async def test_returns_none_on_404(self, client):
        """Should return None when no project access."""
        mock_resp = _mock_response(404)
        mock_resp.raise_for_status.side_effect = None

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get.return_value = mock_resp
            mock_get.return_value = mock_http

            role = await client.get_project_role(USER_OUTSIDER_ID, PROJECT_WEB_ID)

        assert role is None

    @pytest.mark.asyncio
    async def test_returns_none_on_error(self, client):
        """Should return None on server error (fail-safe)."""
        mock_resp = _mock_response(500)

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get.return_value = mock_resp
            mock_get.return_value = mock_http

            role = await client.get_project_role(USER_ORG_OWNER_ID, PROJECT_WEB_ID)

        assert role is None


# ============================================================
# 4. can_access_project
# ============================================================

class TestCanAccessProject:
    """Test project access boolean check."""

    @pytest.mark.asyncio
    async def test_true_when_role_exists(self, client):
        """Should return True when user has any project role."""
        with patch.object(client, "get_project_role", return_value=Role.MEMBER):
            result = await client.can_access_project(USER_ORG_MEMBER_ID, PROJECT_API_ID)
        assert result is True

    @pytest.mark.asyncio
    async def test_false_when_no_role(self, client):
        """Should return False when user has no project role."""
        with patch.object(client, "get_project_role", return_value=None):
            result = await client.can_access_project(USER_OUTSIDER_ID, PROJECT_WEB_ID)
        assert result is False


# ============================================================
# 5. check_access
# ============================================================

class TestCheckAccess:
    """Test generic access check via Go API."""

    @pytest.mark.asyncio
    async def test_returns_true_when_allowed(self, client):
        """Should return True when Go API allows action."""
        mock_resp = _mock_response(200, {"allowed": True})

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.post.return_value = mock_resp
            mock_get.return_value = mock_http

            result = await client.check_access(
                USER_ORG_OWNER_ID, "org", ORG_ALPHA_ID, "delete"
            )

        assert result is True
        mock_http.post.assert_awaited_once_with(
            "/internal/authz/check",
            json={
                "user_id": USER_ORG_OWNER_ID,
                "resource_type": "org",
                "resource_id": ORG_ALPHA_ID,
                "action": "delete",
            },
        )

    @pytest.mark.asyncio
    async def test_returns_false_when_denied(self, client):
        """Should return False when Go API denies action."""
        mock_resp = _mock_response(200, {"allowed": False})

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.post.return_value = mock_resp
            mock_get.return_value = mock_http

            result = await client.check_access(
                USER_ORG_ADMIN_ID, "org", ORG_ALPHA_ID, "delete"
            )

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_on_error(self, client):
        """Should return False on server error (fail-safe: deny by default)."""
        mock_resp = _mock_response(500)

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.post.return_value = mock_resp
            mock_get.return_value = mock_http

            result = await client.check_access(
                USER_ORG_OWNER_ID, "org", ORG_ALPHA_ID, "view"
            )

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_missing_allowed_field(self, client):
        """Should return False when response missing 'allowed' field."""
        mock_resp = _mock_response(200, {"error": "unexpected"})

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.post.return_value = mock_resp
            mock_get.return_value = mock_http

            result = await client.check_access(
                USER_ORG_OWNER_ID, "org", ORG_ALPHA_ID, "view"
            )

        assert result is False


# ============================================================
# 6. Convenience methods
# ============================================================

class TestConvenienceMethods:
    """Test can_perform_org_action and can_perform_project_action."""

    @pytest.mark.asyncio
    async def test_can_perform_org_action_delegates(self, client):
        """can_perform_org_action should delegate to check_access."""
        with patch.object(client, "check_access", return_value=True) as mock_check:
            result = await client.can_perform_org_action(
                USER_ORG_OWNER_ID, ORG_ALPHA_ID, Action.DELETE
            )

        assert result is True
        mock_check.assert_awaited_once_with(
            USER_ORG_OWNER_ID, ResourceType.ORG, ORG_ALPHA_ID, Action.DELETE
        )

    @pytest.mark.asyncio
    async def test_can_perform_project_action_delegates(self, client):
        """can_perform_project_action should delegate to check_access."""
        with patch.object(client, "check_access", return_value=False) as mock_check:
            result = await client.can_perform_project_action(
                USER_ORG_MEMBER_ID, PROJECT_WEB_ID, Action.DELETE
            )

        assert result is False
        mock_check.assert_awaited_once_with(
            USER_ORG_MEMBER_ID, ResourceType.PROJECT, PROJECT_WEB_ID, Action.DELETE
        )


# ============================================================
# 7. Client lifecycle
# ============================================================

class TestClientLifecycle:
    """Test client initialization and cleanup."""

    def test_base_url_strips_trailing_slash(self):
        """Should strip trailing slash from base URL."""
        client = AuthzClient(go_api_url="http://go-api:8080/")
        assert client.base_url == "http://go-api:8080"

    def test_default_timeout(self):
        """Should have sensible default timeout."""
        client = AuthzClient(go_api_url="http://go-api:8080")
        assert client.timeout == 5.0

    def test_custom_timeout(self):
        """Should accept custom timeout."""
        client = AuthzClient(go_api_url="http://go-api:8080", timeout=10.0)
        assert client.timeout == 10.0

    @pytest.mark.asyncio
    async def test_close(self, client):
        """Should close HTTP client without error."""
        await client.close()  # Should not raise
