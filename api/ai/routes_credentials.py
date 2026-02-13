"""
Generic credential management API routes.

This module provides REST API endpoints for managing credentials of various types
(git, database, monitoring, cloud) in HashiCorp Vault.

Credentials are project-scoped (shared across team members in a project).
Authorization delegates to Go API via AuthzClient (Centralized Authority):
- admin/owner: full CRUD access
- member/viewer: read-only access (list/view)
"""

import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from credential_types import (
    CredentialType,
    CREDENTIAL_TYPE_METADATA,
)
from workspace_service import extract_user_id_from_token
from authz.dependencies import get_authz_client
from authz.types import Role
import vault_client

logger = logging.getLogger(__name__)


# ==========================================
# Authorization helpers (delegate to Go API)
# ==========================================

async def _get_project_role(user_id: str, project_id: str) -> Optional[str]:
    """Get user's effective role in a project via Go API."""
    client = get_authz_client()
    role = await client.get_project_role(user_id, project_id)
    return role.value if role else None


async def _require_project_access(user_id: str, project_id: str):
    """Raise 403 if user has no access to the project."""
    role = await _get_project_role(user_id, project_id)
    if not role:
        raise HTTPException(status_code=403, detail="You don't have access to this project")


async def _require_project_admin(user_id: str, project_id: str):
    """Raise 403 if user is not admin/owner in the project."""
    client = get_authz_client()
    role = await client.get_project_role(user_id, project_id)
    if role not in (Role.ADMIN, Role.OWNER):
        raise HTTPException(status_code=403, detail="Only project admins can manage credentials")

router = APIRouter(prefix="/api/credentials", tags=["credentials"])


# ==========================================
# Pydantic Models
# ==========================================

class StoreCredentialRequest(BaseModel):
    """Request to store a credential."""
    credential_type: CredentialType = Field(..., description="Type of credential")
    credential_name: str = Field(..., description="Name for this credential")
    data: Dict[str, Any] = Field(..., description="Credential data (type-specific fields)")
    project_id: str = Field(..., description="Project ID (credentials are project-scoped)")
    description: Optional[str] = Field(None, description="Optional description")
    tags: Optional[list[str]] = Field(None, description="Optional tags")
    export_to_agent: bool = Field(False, description="Whether to export this credential to AI agent env")
    env_mappings: Optional[Dict[str, str]] = Field(
        None,
        description="Mapping of ENV_VAR_NAME -> json_key in credential data. "
                    "e.g. {'OPENSEARCH_USERNAME': 'username', 'OPENSEARCH_PASSWORD': 'password'}"
    )

    class Config:
        json_schema_extra = {
            "examples": [
                {
                    "credential_type": "generic_api_key",
                    "credential_name": "datadog_api_key",
                    "data": {"value": "dd-api-xxxxxxxxxx"},
                    "description": "Datadog API key",
                    "export_to_agent": True,
                    "env_mappings": {"DATADOG_API_KEY": "value"}
                },
                {
                    "credential_type": "generic_api_key",
                    "credential_name": "opensearch_creds",
                    "data": {"username": "admin", "password": "secret123"},
                    "description": "OpenSearch credentials",
                    "export_to_agent": True,
                    "env_mappings": {
                        "OPENSEARCH_USERNAME": "username",
                        "OPENSEARCH_PASSWORD": "password"
                    }
                }
            ]
        }


class UpdateCredentialMetadataRequest(BaseModel):
    """Request to update credential metadata (export settings)."""
    project_id: str = Field(..., description="Project ID (credentials are project-scoped)")
    export_to_agent: Optional[bool] = Field(None, description="Whether to export to AI agent env")
    env_mappings: Optional[Dict[str, str]] = Field(
        None,
        description="Mapping of ENV_VAR_NAME -> json_key. Pass {} to clear."
    )


class CredentialResponse(BaseModel):
    """Response with credential information (without sensitive data)."""
    success: bool
    credential: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class CredentialListResponse(BaseModel):
    """Response with list of credentials."""
    success: bool
    credentials: list[Dict[str, Any]]
    vault_available: bool
    total: int


class CredentialTypesResponse(BaseModel):
    """Response with available credential types."""
    success: bool
    types: list[Dict[str, Any]]


class VaultStatusResponse(BaseModel):
    """Response with Vault status."""
    success: bool
    vault_available: bool
    vault_addr: Optional[str] = None
    vault_enabled: bool


# ==========================================
# API Routes
# ==========================================

@router.get("/types", response_model=CredentialTypesResponse)
async def list_credential_types():
    """
    List all available credential types and their metadata.
    
    Returns information about each credential type including:
    - Name and description
    - Category (git, database, monitoring, cloud, generic)
    - Required fields
    - Documentation link
    """
    types = []
    
    for cred_type in CredentialType:
        metadata = CREDENTIAL_TYPE_METADATA.get(cred_type, {})

        types.append({
            "type": cred_type.value,
            "name": metadata.get("name", cred_type.value),
            "category": metadata.get("category", "generic"),
            "icon": metadata.get("icon", "🔐"),
            "description": metadata.get("description", ""),
            "doc_url": metadata.get("doc_url"),
        })
    
    return CredentialTypesResponse(
        success=True,
        types=types
    )


@router.get("/role")
async def get_credential_role(request: Request, project_id: str = None):
    """
    Get the user's role in a project for credential authorization.

    Returns the user's effective role (owner, admin, member, viewer)
    which determines what credential operations they can perform.
    """
    auth_token = request.headers.get("authorization", "")
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authorization token")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    role = await _get_project_role(user_id, project_id)
    return {"success": True, "role": role}


@router.post("", response_model=CredentialResponse)
async def store_credential(request: Request, body: StoreCredentialRequest):
    """
    Store a credential in Vault (project-scoped).

    Requires admin or owner role in the project.
    The credential data is validated against the schema for the specified type.
    Sensitive data is stored encrypted in Vault.
    """
    # Get user ID from auth token
    auth_token = request.headers.get("authorization", "")
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authorization token")
    if not body.project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    # ReBAC: Only admin/owner can create credentials
    await _require_project_admin(user_id, body.project_id)

    # Check if Vault is available
    vault = vault_client.get_vault_client()
    if not vault.is_available():
        raise HTTPException(status_code=503, detail="Vault is not available")

    try:
        # Store raw data as-is — client sends { "value": "..." } or any dict
        data_dict = body.data

        # Prepare metadata (includes export settings)
        metadata = {
            "description": body.description,
            "tags": body.tags or [],
            "export_to_agent": body.export_to_agent,
            "env_mappings": body.env_mappings or {},
        }

        # Store in Vault (project-scoped)
        success = vault_client.store_project_credential(
            project_id=body.project_id,
            credential_type=body.credential_type.value,
            credential_name=body.credential_name,
            data=data_dict,
            metadata=metadata
        )

        if not success:
            raise HTTPException(status_code=500, detail="Failed to store credential in Vault")

        return CredentialResponse(
            success=True,
            message=f"Credential '{body.credential_name}' stored successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to store credential: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to store credential: {str(e)}")


@router.get("", response_model=CredentialListResponse)
async def list_credentials(
    request: Request,
    credential_type: Optional[str] = None,
    project_id: Optional[str] = None
):
    """
    List all credentials for a project.

    Requires any role in the project (member, viewer, admin, owner).
    Optionally filter by credential type.
    Returns only metadata, not sensitive data.
    """
    # Get user ID from auth token
    auth_token = request.headers.get("authorization", "")
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authorization token")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    # ReBAC: Any project role can list credentials
    await _require_project_access(user_id, project_id)

    # Check if Vault is available
    vault = vault_client.get_vault_client()
    if not vault.is_available():
        return CredentialListResponse(
            success=True,
            credentials=[],
            vault_available=False,
            total=0
        )

    try:
        # List project-scoped credentials from Vault
        credentials = vault_client.list_project_credentials(
            project_id=project_id,
            credential_type=credential_type
        )

        # Enrich with metadata (includes reading export settings from Vault)
        enriched_credentials = []
        for cred in credentials:
            cred_type = cred.get("type")
            type_metadata = CREDENTIAL_TYPE_METADATA.get(cred_type, {})

            # Read full credential to get export metadata
            cred_detail = vault_client.get_project_credential(
                project_id=project_id,
                credential_type=cred_type,
                credential_name=cred.get("name")
            )
            cred_metadata = cred_detail.get("metadata", {}) if cred_detail else {}

            # Return data_keys so UI can build env_mappings dropdown
            cred_data = cred_detail.get("data", {}) if cred_detail else {}

            enriched_credentials.append({
                "name": cred.get("name"),
                "type": cred_type,
                "type_name": type_metadata.get("name", cred_type),
                "category": type_metadata.get("category", "generic"),
                "icon": type_metadata.get("icon", "🔐"),
                "export_to_agent": cred_metadata.get("export_to_agent", False),
                "env_mappings": cred_metadata.get("env_mappings", {}),
                "data_keys": list(cred_data.keys()),
            })

        return CredentialListResponse(
            success=True,
            credentials=enriched_credentials,
            vault_available=True,
            total=len(enriched_credentials)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list credentials: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list credentials: {str(e)}")


@router.get("/{credential_type}/{credential_name}", response_model=CredentialResponse)
async def get_credential_metadata(
    request: Request,
    credential_type: str,
    credential_name: str,
    project_id: Optional[str] = None
):
    """
    Get metadata for a specific credential (project-scoped).

    Requires any role in the project.
    Does NOT return sensitive data (tokens, passwords, etc.).
    Only returns non-sensitive metadata.
    """
    # Get user ID from auth token
    auth_token = request.headers.get("authorization", "")
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authorization token")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    # ReBAC: Any project role can view credentials
    await _require_project_access(user_id, project_id)

    # Check if Vault is available
    vault = vault_client.get_vault_client()
    if not vault.is_available():
        raise HTTPException(status_code=503, detail="Vault is not available")

    try:
        # Get project-scoped credential from Vault
        credential = vault_client.get_project_credential(
            project_id=project_id,
            credential_type=credential_type,
            credential_name=credential_name
        )

        if not credential:
            raise HTTPException(status_code=404, detail="Credential not found")

        # Extract only non-sensitive metadata
        metadata = credential.get("metadata", {})

        # Get type metadata
        type_metadata = CREDENTIAL_TYPE_METADATA.get(credential_type, {})

        return CredentialResponse(
            success=True,
            credential={
                "name": credential_name,
                "type": credential_type,
                "type_name": type_metadata.get("name", credential_type),
                "category": type_metadata.get("category", "generic"),
                "icon": type_metadata.get("icon", "🔐"),
                "description": metadata.get("description"),
                "tags": metadata.get("tags", []),
                "created_at": credential.get("created_at"),
                "has_data": bool(credential.get("data"))
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get credential: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get credential: {str(e)}")


@router.patch("/{credential_type}/{credential_name}", response_model=CredentialResponse)
async def update_credential_metadata(
    request: Request,
    credential_type: str,
    credential_name: str,
    body: UpdateCredentialMetadataRequest
):
    """
    Update credential metadata (export settings) without re-submitting sensitive data.

    Requires admin or owner role in the project.
    Use this to toggle export_to_agent or change env_var_name.
    """
    auth_token = request.headers.get("authorization", "")
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authorization token")
    if not body.project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    # ReBAC: Only admin/owner can update credentials
    await _require_project_admin(user_id, body.project_id)

    vault = vault_client.get_vault_client()
    if not vault.is_available():
        raise HTTPException(status_code=503, detail="Vault is not available")

    try:
        # Read existing project-scoped credential
        existing = vault_client.get_project_credential(
            project_id=body.project_id,
            credential_type=credential_type,
            credential_name=credential_name
        )

        if not existing:
            raise HTTPException(status_code=404, detail="Credential not found")

        # Update only the metadata fields that were provided
        metadata = existing.get("metadata", {})
        if body.export_to_agent is not None:
            metadata["export_to_agent"] = body.export_to_agent
        if body.env_mappings is not None:
            metadata["env_mappings"] = body.env_mappings

        # Re-store with updated metadata (data unchanged)
        success = vault_client.store_project_credential(
            project_id=body.project_id,
            credential_type=credential_type,
            credential_name=credential_name,
            data=existing.get("data", {}),
            metadata=metadata
        )

        if not success:
            raise HTTPException(status_code=500, detail="Failed to update credential metadata")

        # Build response with updated credential info
        type_metadata = CREDENTIAL_TYPE_METADATA.get(credential_type, {})
        cred_data = existing.get("data", {})

        return CredentialResponse(
            success=True,
            credential={
                "name": credential_name,
                "type": credential_type,
                "type_name": type_metadata.get("name", credential_type),
                "category": type_metadata.get("category", "generic"),
                "icon": type_metadata.get("icon", "🔐"),
                "export_to_agent": metadata.get("export_to_agent", False),
                "env_mappings": metadata.get("env_mappings", {}),
                "data_keys": list(cred_data.keys()),
            },
            message=f"Credential '{credential_name}' updated successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update credential metadata: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update credential: {str(e)}")


@router.delete("/{credential_type}/{credential_name}", response_model=CredentialResponse)
async def delete_credential(
    request: Request,
    credential_type: str,
    credential_name: str,
    project_id: Optional[str] = None
):
    """
    Delete a credential from Vault (project-scoped).

    Requires admin or owner role in the project.
    This permanently removes the credential and all its versions.
    """
    # Get user ID from auth token
    auth_token = request.headers.get("authorization", "")
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authorization token")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    # ReBAC: Only admin/owner can delete credentials
    await _require_project_admin(user_id, project_id)

    # Check if Vault is available
    vault = vault_client.get_vault_client()
    if not vault.is_available():
        raise HTTPException(status_code=503, detail="Vault is not available")

    try:
        # Delete project-scoped credential from Vault
        success = vault_client.delete_project_credential(
            project_id=project_id,
            credential_type=credential_type,
            credential_name=credential_name
        )

        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete credential from Vault")

        return CredentialResponse(
            success=True,
            message=f"Credential '{credential_name}' deleted successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete credential: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete credential: {str(e)}")


@router.get("/status", response_model=VaultStatusResponse)
async def get_vault_status():
    """
    Check Vault connection status.
    
    Returns whether Vault is available and configured.
    """
    vault = vault_client.get_vault_client()
    
    return VaultStatusResponse(
        success=True,
        vault_available=vault.is_available(),
        vault_addr=vault.vault_addr if vault else None,
        vault_enabled=vault.enabled if vault else False
    )
