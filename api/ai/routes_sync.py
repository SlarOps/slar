"""
Sync routes for AI Agent API.

Handles:
- /api/sync-bucket - Sync all files from bucket to workspace
- /api/sync-mcp-config - Sync MCP config after save
- /api/sync-skills - Sync skills after upload
"""

import logging
from fastapi import APIRouter, Request

from supabase_storage import (
    extract_user_id_from_token,
    get_user_mcp_servers,
    sync_all_from_bucket,
    sync_user_skills,
    unzip_installed_plugins,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["sync"])

# Reference to shared cache (set by main app)
user_mcp_cache = {}


def set_mcp_cache(cache: dict):
    """Set reference to shared MCP cache from main app."""
    global user_mcp_cache
    user_mcp_cache = cache


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """Sanitize error messages to prevent information disclosure."""
    logger.error(f"Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)
    return f"An error occurred {context}. Please try again."


@router.post("/sync-bucket")
async def sync_bucket(request: Request):
    """
    Sync all files (MCP config + skills) from bucket to workspace.

    Flow:
    1. Sync all regular files from bucket (.mcp.json, .claude/skills/, etc.)
    2. Unzip ONLY installed plugins from marketplace ZIPs

    This endpoint should be called by frontend when user opens AI agent page,
    BEFORE opening WebSocket connection.

    Request body: {"auth_token": "Bearer ..."}

    Returns:
        {
            "success": bool,
            "skipped": bool,
            "message": str,
            "files_synced": int,
            "plugins_unzipped": int
        }
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            logger.warning("No auth token provided for bucket sync")
            return {
                "success": False,
                "skipped": False,
                "message": "No auth token provided",
            }

        logger.info("Starting bucket sync...")

        # Step 1: Sync all from bucket (MCP config + skills)
        sync_result = await sync_all_from_bucket(auth_token)

        if not sync_result["success"]:
            return sync_result

        # Log sync status
        if sync_result.get("skipped"):
            logger.info("Bucket sync skipped (unchanged)")
        else:
            logger.info(f"Bucket synced: {sync_result['message']}")

        # Step 2: ALWAYS unzip installed plugins (even if sync skipped)
        user_id = extract_user_id_from_token(auth_token)
        if user_id:
            logger.info(f"Unzipping installed plugins for user: {user_id}")
            unzip_result = await unzip_installed_plugins(user_id)

            if unzip_result["success"]:
                logger.info(f"Unzipped {unzip_result['unzipped_count']} plugins")

                if sync_result.get("skipped"):
                    message = f"Sync skipped (unchanged), unzipped {unzip_result['unzipped_count']} plugins"
                else:
                    message = f"Synced {sync_result.get('files_synced', 0)} files, unzipped {unzip_result['unzipped_count']} plugins"

                return {
                    "success": True,
                    "skipped": sync_result.get("skipped", False),
                    "message": message,
                    "files_synced": sync_result.get("files_synced", 0),
                    "plugins_unzipped": unzip_result["unzipped_count"],
                }
            else:
                logger.warning(f"Failed to unzip plugins: {unzip_result['message']}")

                if sync_result.get("skipped"):
                    error_message = f"Sync skipped (unchanged), but failed to unzip plugins: {unzip_result['message']}"
                else:
                    error_message = f"Synced {sync_result.get('files_synced', 0)} files, but failed to unzip plugins: {unzip_result['message']}"

                return {
                    "success": True,
                    "skipped": sync_result.get("skipped", False),
                    "message": error_message,
                    "files_synced": sync_result.get("files_synced", 0),
                    "plugins_unzipped": 0,
                }
        else:
            logger.warning("Could not extract user_id from token for plugin unzip")

        return sync_result

    except Exception as e:
        return {
            "success": False,
            "skipped": False,
            "message": sanitize_error_message(e, "syncing bucket"),
        }


@router.post("/sync-mcp-config")
async def sync_mcp_config(request: Request):
    """
    Event-driven sync endpoint - called by frontend after successful save.

    This endpoint:
    1. Extracts user_id from auth token
    2. Downloads latest .mcp.json from Supabase Storage
    3. Updates in-memory cache

    Request body: {"auth_token": "Bearer ..."}

    Returns:
        {"success": bool, "message": str, "servers_count": int}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            logger.warning("No auth token provided for sync")
            return {"success": False, "message": "No auth token provided"}

        user_id = extract_user_id_from_token(auth_token)

        if not user_id:
            logger.warning("Could not extract user_id from token")
            return {"success": False, "message": "Invalid auth token"}

        logger.info(f"Syncing MCP config for user: {user_id}")

        # Download fresh config from Supabase
        user_mcp_servers = await get_user_mcp_servers(user_id=user_id)

        if user_mcp_servers:
            # Update cache
            user_mcp_cache[user_id] = user_mcp_servers
            logger.info(f"Config synced and cached for user: {user_id}")
            logger.info(f"   Servers: {list(user_mcp_servers.keys())}")

            return {
                "success": True,
                "message": "MCP config synced successfully",
                "servers_count": len(user_mcp_servers),
                "servers": list(user_mcp_servers.keys()),
            }
        else:
            logger.info(f"No MCP config found for user: {user_id}")
            if user_id in user_mcp_cache:
                del user_mcp_cache[user_id]

            return {
                "success": True,
                "message": "No MCP config found - cache cleared",
                "servers_count": 0,
                "servers": [],
            }

    except Exception as e:
        return {
            "success": False,
            "message": sanitize_error_message(e, "syncing MCP config")
        }


@router.post("/sync-skills")
async def sync_skills(request: Request):
    """
    Event-driven sync endpoint - called by frontend after successful skill upload.

    This endpoint:
    1. Extracts user_id from auth token
    2. Lists all skill files in Supabase Storage
    3. Downloads each skill file
    4. Extracts/copies to .claude/skills directory in user's workspace

    Request body: {"auth_token": "Bearer ..."}

    Returns:
        {
            "success": bool,
            "message": str,
            "synced_count": int,
            "failed_count": int,
            "skills": ["skill1.skill", "skill2.skill"],
            "errors": []
        }
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            logger.warning("No auth token provided for skill sync")
            return {
                "success": False,
                "message": "No auth token provided",
                "synced_count": 0,
                "failed_count": 0,
                "skills": [],
                "errors": ["No auth token provided"],
            }

        logger.info("Starting skill sync...")

        result = await sync_user_skills(auth_token)

        if result["success"]:
            logger.info(
                f"Skills synced successfully: "
                f"{result['synced_count']} synced, {result['failed_count']} failed"
            )
        else:
            logger.warning(
                f"Skill sync completed with errors: "
                f"{result['synced_count']} synced, {result['failed_count']} failed"
            )

        return {
            "success": result["success"],
            "message": result.get("message", "Skill sync completed"),
            "synced_count": result["synced_count"],
            "failed_count": result["failed_count"],
            "skills": result["skills"],
            "errors": result.get("errors", []),
        }

    except Exception as e:
        error_message = sanitize_error_message(e, "syncing skills")
        return {
            "success": False,
            "message": error_message,
            "synced_count": 0,
            "failed_count": 0,
            "skills": [],
            "errors": [error_message],
        }
