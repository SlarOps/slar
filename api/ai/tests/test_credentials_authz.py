"""
Test credential route authorization enforcement.

Permission matrix (project-scoped credentials):
              Read    Create    Delete    Update
admin          ✓        ✓         ✓         ✓
member         ✓        ✗         ✗         ✗
outsider       ✗        ✗         ✗         ✗

Tests verify that:
- Admin can perform all CRUD operations (200)
- Member can only read (list/get), gets 403 on create/delete/update
- Outsider (no project role) gets 403 on everything

All authorization is delegated to Go API via AuthzClient.
Uses mock AuthzClient - no real Go API, database, or Vault needed.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from authz.types import Role

from tests.test_data import (
    PROJECT_WEB_ID,
    USER_ORG_ADMIN_ID,
    USER_PROJECT_MEMBER_ID,
    USER_OUTSIDER_ID,
)


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def app():
    """Create a minimal FastAPI app with credentials router."""
    from routes_credentials import router
    app = FastAPI()
    app.include_router(router)
    return app


def _mock_vault_available():
    """Create a mock vault client that is available."""
    vault = MagicMock()
    vault.is_available.return_value = True
    vault.vault_addr = "http://vault:8200"
    vault.enabled = True
    return vault


def _mock_authz_client(role: Role = None):
    """Create mock AuthzClient returning specified role for get_project_role."""
    mock_client = AsyncMock()
    mock_client.get_project_role.return_value = role
    return mock_client


# ============================================================
# Admin - Full CRUD Access
# ============================================================

class TestAdminCredentialAccess:
    """Admin (admin role) should have full CRUD access to credentials."""

    def test_admin_can_read_list(self, app):
        """Admin can list credentials (GET /api/credentials)."""
        mock_authz = _mock_authz_client(Role.ADMIN)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.list_project_credentials.return_value = []

            client = TestClient(app)
            resp = client.get(
                "/api/credentials",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        mock_authz.get_project_role.assert_awaited_once_with(USER_ORG_ADMIN_ID, PROJECT_WEB_ID)

    def test_admin_can_read_detail(self, app):
        """Admin can get credential metadata (GET /api/credentials/{type}/{name})."""
        mock_authz = _mock_authz_client(Role.ADMIN)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.get_project_credential.return_value = {
                "data": {"value": "secret"},
                "metadata": {"description": "test"},
            }

            client = TestClient(app)
            resp = client.get(
                "/api/credentials/generic_api_key/my_key",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_admin_can_create(self, app):
        """Admin can store a credential (POST /api/credentials)."""
        mock_authz = _mock_authz_client(Role.ADMIN)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.store_project_credential.return_value = True

            client = TestClient(app)
            resp = client.post(
                "/api/credentials",
                json={
                    "credential_type": "generic_api_key",
                    "credential_name": "test_key",
                    "data": {"value": "secret-123"},
                    "project_id": PROJECT_WEB_ID,
                },
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 200
        assert resp.json()["success"] is True
        mock_authz.get_project_role.assert_awaited_once_with(USER_ORG_ADMIN_ID, PROJECT_WEB_ID)

    def test_admin_can_update(self, app):
        """Admin can update credential metadata (PATCH /api/credentials/{type}/{name})."""
        mock_authz = _mock_authz_client(Role.ADMIN)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.get_project_credential.return_value = {
                "data": {"value": "secret"},
                "metadata": {"export_to_agent": False, "env_mappings": {}},
            }
            mock_vc.store_project_credential.return_value = True

            client = TestClient(app)
            resp = client.patch(
                "/api/credentials/generic_api_key/my_key",
                json={
                    "project_id": PROJECT_WEB_ID,
                    "export_to_agent": True,
                    "env_mappings": {"API_KEY": "value"},
                },
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_admin_can_delete(self, app):
        """Admin can delete a credential (DELETE /api/credentials/{type}/{name})."""
        mock_authz = _mock_authz_client(Role.ADMIN)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.delete_project_credential.return_value = True

            client = TestClient(app)
            resp = client.delete(
                "/api/credentials/generic_api_key/my_key",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 200
        assert resp.json()["success"] is True


# ============================================================
# Member - Read Only
# ============================================================

class TestMemberCredentialAccess:
    """Member (member role) can only read credentials."""

    def test_member_can_read_list(self, app):
        """Member can list credentials (GET /api/credentials)."""
        mock_authz = _mock_authz_client(Role.MEMBER)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_PROJECT_MEMBER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.list_project_credentials.return_value = []

            client = TestClient(app)
            resp = client.get(
                "/api/credentials",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_member_can_read_detail(self, app):
        """Member can get credential metadata (GET /api/credentials/{type}/{name})."""
        mock_authz = _mock_authz_client(Role.MEMBER)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_PROJECT_MEMBER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.get_project_credential.return_value = {
                "data": {"value": "secret"},
                "metadata": {"description": "test"},
            }

            client = TestClient(app)
            resp = client.get(
                "/api/credentials/generic_api_key/my_key",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_member_cannot_create(self, app):
        """Member gets 403 when trying to create a credential."""
        mock_authz = _mock_authz_client(Role.MEMBER)

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_PROJECT_MEMBER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz):

            client = TestClient(app)
            resp = client.post(
                "/api/credentials",
                json={
                    "credential_type": "generic_api_key",
                    "credential_name": "test_key",
                    "data": {"value": "secret"},
                    "project_id": PROJECT_WEB_ID,
                },
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 403
        assert "admin" in resp.json()["detail"].lower()

    def test_member_cannot_update(self, app):
        """Member gets 403 when trying to update a credential."""
        mock_authz = _mock_authz_client(Role.MEMBER)

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_PROJECT_MEMBER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz):

            client = TestClient(app)
            resp = client.patch(
                "/api/credentials/generic_api_key/my_key",
                json={
                    "project_id": PROJECT_WEB_ID,
                    "export_to_agent": True,
                },
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 403
        assert "admin" in resp.json()["detail"].lower()

    def test_member_cannot_delete(self, app):
        """Member gets 403 when trying to delete a credential."""
        mock_authz = _mock_authz_client(Role.MEMBER)

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_PROJECT_MEMBER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz):

            client = TestClient(app)
            resp = client.delete(
                "/api/credentials/generic_api_key/my_key",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 403
        assert "admin" in resp.json()["detail"].lower()


# ============================================================
# Outsider - No Access
# ============================================================

class TestOutsiderCredentialAccess:
    """Outsider (no project role) should get 403 on everything."""

    def test_outsider_cannot_read_list(self, app):
        """Outsider gets 403 when listing credentials."""
        mock_authz = _mock_authz_client(None)  # No role

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_OUTSIDER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz):

            client = TestClient(app)
            resp = client.get(
                "/api/credentials",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 403

    def test_outsider_cannot_read_detail(self, app):
        """Outsider gets 403 when getting credential metadata."""
        mock_authz = _mock_authz_client(None)

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_OUTSIDER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz):

            client = TestClient(app)
            resp = client.get(
                "/api/credentials/generic_api_key/my_key",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 403

    def test_outsider_cannot_create(self, app):
        """Outsider gets 403 when creating a credential."""
        mock_authz = _mock_authz_client(None)

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_OUTSIDER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz):

            client = TestClient(app)
            resp = client.post(
                "/api/credentials",
                json={
                    "credential_type": "generic_api_key",
                    "credential_name": "test_key",
                    "data": {"value": "secret"},
                    "project_id": PROJECT_WEB_ID,
                },
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 403

    def test_outsider_cannot_delete(self, app):
        """Outsider gets 403 when deleting a credential."""
        mock_authz = _mock_authz_client(None)

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_OUTSIDER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz):

            client = TestClient(app)
            resp = client.delete(
                "/api/credentials/generic_api_key/my_key",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 403


# ============================================================
# Unauthenticated - 401
# ============================================================

class TestUnauthenticatedAccess:
    """Missing or invalid token should return 401."""

    def test_no_token_returns_401(self, app):
        """Missing authorization token returns 401."""
        with patch("routes_credentials.extract_user_id_from_token", return_value=None):
            client = TestClient(app)
            resp = client.get(
                "/api/credentials",
                params={"project_id": PROJECT_WEB_ID},
            )

        assert resp.status_code == 401

    def test_invalid_token_returns_401(self, app):
        """Invalid token (extract returns None) returns 401."""
        with patch("routes_credentials.extract_user_id_from_token", return_value=None):
            client = TestClient(app)
            resp = client.post(
                "/api/credentials",
                json={
                    "credential_type": "generic_api_key",
                    "credential_name": "test_key",
                    "data": {"value": "secret"},
                    "project_id": PROJECT_WEB_ID,
                },
                headers={"Authorization": "Bearer bad-token"},
            )

        assert resp.status_code == 401


# ============================================================
# Missing project_id - 400
# ============================================================

class TestMissingProjectId:
    """Missing project_id should return 400."""

    def test_list_without_project_id_returns_400(self, app):
        """List credentials without project_id returns 400."""
        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID):
            client = TestClient(app)
            resp = client.get(
                "/api/credentials",
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 400

    def test_create_without_project_id_returns_400(self, app):
        """Create credential without project_id returns 400."""
        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID):
            client = TestClient(app)
            resp = client.post(
                "/api/credentials",
                json={
                    "credential_type": "generic_api_key",
                    "credential_name": "test_key",
                    "data": {"value": "secret"},
                    "project_id": "",
                },
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 400


# ============================================================
# Delegation verification
# ============================================================

class TestAuthzDelegation:
    """Verify authorization is delegated to Go API via AuthzClient."""

    def test_read_delegates_to_authz_client(self, app):
        """List credentials calls AuthzClient.get_project_role (not direct SQL)."""
        mock_authz = _mock_authz_client(Role.ADMIN)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.list_project_credentials.return_value = []

            client = TestClient(app)
            client.get(
                "/api/credentials",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        # AuthzClient was called (delegates to Go API)
        mock_authz.get_project_role.assert_awaited_once_with(USER_ORG_ADMIN_ID, PROJECT_WEB_ID)

    def test_create_delegates_to_authz_client(self, app):
        """Create credential calls AuthzClient.get_project_role for admin check."""
        mock_authz = _mock_authz_client(Role.ADMIN)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.store_project_credential.return_value = True

            client = TestClient(app)
            client.post(
                "/api/credentials",
                json={
                    "credential_type": "generic_api_key",
                    "credential_name": "key",
                    "data": {"value": "secret"},
                    "project_id": PROJECT_WEB_ID,
                },
                headers={"Authorization": "Bearer valid-token"},
            )

        mock_authz.get_project_role.assert_awaited_once_with(USER_ORG_ADMIN_ID, PROJECT_WEB_ID)

    def test_delete_delegates_to_authz_client(self, app):
        """Delete credential calls AuthzClient.get_project_role for admin check."""
        mock_authz = _mock_authz_client(Role.ADMIN)
        mock_vault = _mock_vault_available()

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_ORG_ADMIN_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz), \
             patch("routes_credentials.vault_client") as mock_vc:
            mock_vc.get_vault_client.return_value = mock_vault
            mock_vc.delete_project_credential.return_value = True

            client = TestClient(app)
            client.delete(
                "/api/credentials/generic_api_key/my_key",
                params={"project_id": PROJECT_WEB_ID},
                headers={"Authorization": "Bearer valid-token"},
            )

        mock_authz.get_project_role.assert_awaited_once_with(USER_ORG_ADMIN_ID, PROJECT_WEB_ID)

    def test_member_rejection_comes_from_authz_client(self, app):
        """Member 403 is based on AuthzClient role response, not local SQL."""
        mock_authz = _mock_authz_client(Role.MEMBER)

        with patch("routes_credentials.extract_user_id_from_token", return_value=USER_PROJECT_MEMBER_ID), \
             patch("routes_credentials.get_authz_client", return_value=mock_authz):

            client = TestClient(app)
            resp = client.post(
                "/api/credentials",
                json={
                    "credential_type": "generic_api_key",
                    "credential_name": "key",
                    "data": {"value": "secret"},
                    "project_id": PROJECT_WEB_ID,
                },
                headers={"Authorization": "Bearer valid-token"},
            )

        assert resp.status_code == 403
        # AuthzClient was called (Go API decided, not local SQL)
        mock_authz.get_project_role.assert_awaited_once_with(USER_PROJECT_MEMBER_ID, PROJECT_WEB_ID)
