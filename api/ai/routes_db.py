"""
Database routes for AI Agent API.
Handles CRUD operations for installed_plugins, marketplaces via raw SQL.

Split from claude_agent_api_v1.py for better code organization.
"""

import json
import logging
from fastapi import APIRouter, Request

from database_util import execute_query
from supabase_storage import extract_user_id_from_token

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api", tags=["database"])


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """
    Sanitize error messages to prevent information disclosure.
    """
    logger.error(f"❌ Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)

    if isinstance(error, (ConnectionError, TimeoutError)):
        return "Service temporarily unavailable. Please try again."
    elif isinstance(error, PermissionError):
        return "Access denied. Please check your permissions."
    elif isinstance(error, ValueError):
        return "Invalid input provided. Please check your request."
    elif "auth" in str(error).lower() or "token" in str(error).lower():
        return "Authentication failed. Please verify your credentials."
    elif "database" in str(error).lower() or "postgres" in str(error).lower():
        return "Database error. Please contact support if this persists."
    else:
        return "An internal error occurred. Please contact support if this persists."


def _get_user_id_from_request(request: Request) -> tuple[str | None, dict | None]:
    """
    Extract user_id from request. Returns (user_id, error_response).
    If error, user_id is None and error_response contains the error dict.
    """
    auth_token = request.query_params.get("auth_token") or request.headers.get(
        "authorization", ""
    )

    if not auth_token:
        return None, {"success": False, "error": "Missing auth_token"}

    user_id = extract_user_id_from_token(auth_token)
    if not user_id:
        return None, {"success": False, "error": "Invalid auth token"}

    return user_id, None


# ==========================================
# Installed Plugins Endpoints
# ==========================================

@router.get("/installed-plugins")
async def get_installed_plugins(request: Request):
    """
    Get all installed plugins for current user from PostgreSQL.

    Query params:
        auth_token: Bearer token (or from Authorization header)

    Returns:
        {
            "success": bool,
            "plugins": [
                {
                    "id": "uuid",
                    "user_id": "uuid",
                    "plugin_name": "example-plugin",
                    "marketplace_name": "my-marketplace",
                    "plugin_type": "skill",
                    "installed_at": "2024-01-01T00:00:00Z"
                }
            ]
        }
    """
    try:
        user_id, error = _get_user_id_from_request(request)
        if error:
            return error

        plugins = execute_query(
            """
            SELECT * FROM installed_plugins
            WHERE user_id = %s
            ORDER BY installed_at DESC
            """,
            (user_id,),
            fetch="all"
        )

        return {"success": True, "plugins": plugins or []}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "getting installed plugins")
        }


@router.post("/installed-plugins")
async def add_installed_plugin(request: Request):
    """
    Add or update an installed plugin for current user.

    Request body:
        {
            "auth_token": "Bearer ...",
            "plugin_name": "example-plugin",
            "marketplace_name": "my-marketplace",
            "plugin_type": "skill",
            "config": {}  // optional
        }

    Returns:
        {"success": bool, "plugin": {...} or "error": str}
    """
    try:
        import uuid as uuid_module

        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        plugin_name = body.get("plugin_name")
        marketplace_name = body.get("marketplace_name")
        plugin_type = body.get("plugin_type", "skill")
        config = body.get("config", {})

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not plugin_name or not marketplace_name:
            return {"success": False, "error": "Missing plugin_name or marketplace_name"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

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
            (plugin_id, user_id, plugin_name, marketplace_name, plugin_type, json.dumps(config)),
            fetch="none"
        )

        plugin = execute_query(
            """
            SELECT * FROM installed_plugins
            WHERE user_id = %s AND plugin_name = %s AND marketplace_name = %s
            """,
            (user_id, plugin_name, marketplace_name),
            fetch="one"
        )

        logger.info(f"✅ User {user_id}: Installed plugin '{plugin_name}' from '{marketplace_name}'")

        return {"success": True, "plugin": plugin}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "adding installed plugin")
        }


@router.delete("/installed-plugins/{plugin_id}")
async def delete_installed_plugin(plugin_id: str, request: Request):
    """
    Delete an installed plugin by ID.

    Path params:
        plugin_id: UUID of the plugin to delete

    Query params:
        auth_token: Bearer token (or from Authorization header)

    Returns:
        {"success": bool, "message": str or "error": str}
    """
    try:
        user_id, error = _get_user_id_from_request(request)
        if error:
            return error

        execute_query(
            """
            DELETE FROM installed_plugins
            WHERE id = %s AND user_id = %s
            """,
            (plugin_id, user_id),
            fetch="none"
        )

        logger.info(f"✅ User {user_id}: Deleted installed plugin '{plugin_id}'")

        return {"success": True, "message": f"Plugin {plugin_id} deleted successfully"}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "deleting installed plugin")
        }


# ==========================================
# Marketplaces Endpoints
# ==========================================

@router.get("/marketplaces")
async def get_all_marketplaces(request: Request):
    """
    Get all marketplaces for current user from PostgreSQL.

    Query params:
        auth_token: Bearer token (or from Authorization header)

    Returns:
        {
            "success": bool,
            "marketplaces": [
                {
                    "id": "uuid",
                    "user_id": "uuid",
                    "name": "my-marketplace",
                    "repo_url": "https://github.com/...",
                    "status": "ready",
                    "created_at": "2024-01-01T00:00:00Z"
                }
            ]
        }
    """
    try:
        user_id, error = _get_user_id_from_request(request)
        if error:
            return error

        marketplaces = execute_query(
            """
            SELECT * FROM marketplaces
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (user_id,),
            fetch="all"
        )

        return {"success": True, "marketplaces": marketplaces or []}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "getting marketplaces")
        }


@router.get("/marketplaces/{marketplace_name}")
async def get_marketplace_by_name(marketplace_name: str, request: Request):
    """
    Get a single marketplace by name for current user.

    Path params:
        marketplace_name: Name of the marketplace

    Query params:
        auth_token: Bearer token (or from Authorization header)

    Returns:
        {
            "success": bool,
            "marketplace": {
                "id": "uuid",
                "user_id": "uuid",
                "name": "my-marketplace",
                "repo_url": "https://github.com/...",
                "status": "ready",
                "created_at": "2024-01-01T00:00:00Z"
            } or null
        }
    """
    try:
        user_id, error = _get_user_id_from_request(request)
        if error:
            return error

        marketplace = execute_query(
            """
            SELECT * FROM marketplaces
            WHERE user_id = %s AND name = %s
            """,
            (user_id, marketplace_name),
            fetch="one"
        )

        if not marketplace:
            return {"success": False, "error": "Marketplace not found"}

        return {"success": True, "marketplace": marketplace}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "getting marketplace")
        }
