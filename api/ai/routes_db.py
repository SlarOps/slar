"""
Database routes for AI Agent API (REFACTORED with dependency injection).
Handles CRUD operations for installed_plugins, marketplaces via raw SQL.

Split from claude_agent_api_v1.py for better code organization.
"""

import json
import logging
import uuid as uuid_module
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional

from dependencies import get_current_user, UserContext
from database_util import execute_query, ensure_user_exists, extract_user_info_from_token
from workspace_service import extract_user_id_from_token

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api", tags=["database"])


# ==========================================
# Pydantic Schemas
# ==========================================

class PluginListResponse(BaseModel):
    """Response for GET /installed-plugins."""
    success: bool
    plugins: list


class AddPluginRequest(BaseModel):
    """Request to add installed plugin."""
    plugin_name: str = Field(..., description="Plugin name")
    marketplace_name: str = Field(..., description="Marketplace name")
    plugin_type: str = Field(default="skill", description="Plugin type")
    config: dict = Field(default_factory=dict, description="Plugin configuration")


class PluginResponse(BaseModel):
    """Response for POST /installed-plugins."""
    success: bool
    plugin: dict


class DeletePluginResponse(BaseModel):
    """Response for DELETE /installed-plugins/{id}."""
    success: bool
    message: str


class MarketplaceListResponse(BaseModel):
    """Response for GET /marketplaces."""
    success: bool
    marketplaces: list


class MarketplaceResponse(BaseModel):
    """Response for GET /marketplaces/{name}."""
    success: bool
    marketplace: Optional[dict] = None


# ==========================================
# Installed Plugins Endpoints
# ==========================================

@router.get("/installed-plugins", response_model=PluginListResponse)
async def get_installed_plugins(
    user: UserContext = Depends(get_current_user)
):
    """
    Get all installed plugins for current user from PostgreSQL.

    Authentication:
    - Requires valid Authorization header

    Returns:
    - List of installed plugins
    """
    try:
        plugins = execute_query(
            """
            SELECT * FROM installed_plugins
            WHERE user_id = %s
            ORDER BY installed_at DESC
            """,
            (user.user_id,),
            fetch="all"
        )

        return PluginListResponse(
            success=True,
            plugins=plugins or []
        )

    except Exception as e:
        logger.error(f"Error getting installed plugins for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred getting installed plugins. Please try again."
        )


@router.post("/installed-plugins", response_model=PluginResponse)
async def add_installed_plugin(
    body: AddPluginRequest,
    user: UserContext = Depends(get_current_user)
):
    """
    Add or update an installed plugin for current user.

    Authentication:
    - Requires valid Authorization header

    Request body:
    - plugin_name: Plugin name
    - marketplace_name: Marketplace name
    - plugin_type: Plugin type (default: skill)
    - config: Plugin configuration (optional)

    Returns:
    - Added/updated plugin
    """
    try:
        plugin_id = str(uuid_module.uuid4())

        execute_query(
            """
            INSERT INTO installed_plugins (id, user_id, plugin_name, marketplace_name, plugin_type, config)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, plugin_name, marketplace_name)
            DO UPDATE SET
                plugin_type = EXCLUDED.plugin_type,
                config = EXCLUDED.config,
                installed_at = NOW()
            """,
            (plugin_id, user.user_id, body.plugin_name, body.marketplace_name, body.plugin_type, json.dumps(body.config)),
            fetch="none"
        )

        plugin = execute_query(
            """
            SELECT * FROM installed_plugins
            WHERE user_id = %s AND plugin_name = %s AND marketplace_name = %s
            """,
            (user.user_id, body.plugin_name, body.marketplace_name),
            fetch="one"
        )

        logger.info(f"✅ User {user.user_id}: Installed plugin '{body.plugin_name}' from '{body.marketplace_name}'")

        return PluginResponse(
            success=True,
            plugin=plugin or {}
        )

    except Exception as e:
        logger.error(f"Error adding installed plugin for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred adding installed plugin. Please try again."
        )


@router.delete("/installed-plugins/{plugin_id}", response_model=DeletePluginResponse)
async def delete_installed_plugin(
    plugin_id: str,
    user: UserContext = Depends(get_current_user)
):
    """
    Delete an installed plugin by ID.

    Authentication:
    - Requires valid Authorization header

    Path params:
    - plugin_id: UUID of the plugin to delete

    Returns:
    - Success message
    """
    try:
        execute_query(
            """
            DELETE FROM installed_plugins
            WHERE id = %s AND user_id = %s
            """,
            (plugin_id, user.user_id),
            fetch="none"
        )

        logger.info(f"✅ User {user.user_id}: Deleted installed plugin '{plugin_id}'")

        return DeletePluginResponse(
            success=True,
            message=f"Plugin {plugin_id} deleted successfully"
        )

    except Exception as e:
        logger.error(f"Error deleting installed plugin for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred deleting installed plugin. Please try again."
        )


# ==========================================
# Marketplaces Endpoints
# ==========================================

@router.get("/marketplaces", response_model=MarketplaceListResponse)
async def get_all_marketplaces(
    user: UserContext = Depends(get_current_user)
):
    """
    Get all marketplaces for current user from PostgreSQL.

    Authentication:
    - Requires valid Authorization header

    Returns:
    - List of marketplaces
    """
    try:
        marketplaces = execute_query(
            """
            SELECT * FROM marketplaces
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (user.user_id,),
            fetch="all"
        )

        return MarketplaceListResponse(
            success=True,
            marketplaces=marketplaces or []
        )

    except Exception as e:
        logger.error(f"Error getting marketplaces for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred getting marketplaces. Please try again."
        )


@router.get("/marketplaces/{marketplace_name}", response_model=MarketplaceResponse)
async def get_marketplace_by_name(
    marketplace_name: str,
    user: UserContext = Depends(get_current_user)
):
    """
    Get a single marketplace by name for current user.

    Authentication:
    - Requires valid Authorization header

    Path params:
    - marketplace_name: Name of the marketplace

    Returns:
    - Marketplace details
    """
    try:
        marketplace = execute_query(
            """
            SELECT * FROM marketplaces
            WHERE user_id = %s AND name = %s
            """,
            (user.user_id, marketplace_name),
            fetch="one"
        )

        if not marketplace:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Marketplace not found"
            )

        return MarketplaceResponse(
            success=True,
            marketplace=marketplace
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting marketplace for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred getting marketplace. Please try again."
        )
