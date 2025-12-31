"""
Sync routes for AI Agent API.

Handles:
- /api/sync-workspace - Verify plugins and sync memory (git-based approach)
- /api/sync-mcp-config - Sync MCP config after save
- /api/sync-skills - Sync skills after upload
- /api/sync-marketplaces - Sync all git-based marketplaces

NOTE: Bucket sync removed - plugins now come from git clone, MCP from PostgreSQL.
"""

import logging
from fastapi import APIRouter, Request

from supabase_storage import (
    extract_user_id_from_token,
    get_user_mcp_servers,
    get_user_workspace_path,
    sync_memory_to_workspace,
    sync_user_skills,
    unzip_installed_plugins,
)
from database_util import execute_query
from git_utils import (
    fetch_and_reset,
    get_marketplace_dir,
    is_git_repository,
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
@router.post("/sync-workspace")
async def sync_workspace(request: Request):
    """
    Sync workspace: verify plugins and sync memory from PostgreSQL.

    Git-based approach (v2):
    - MCP servers: Loaded from PostgreSQL (no sync needed)
    - Plugins: Come from git clone, just verify they exist
    - Memory (CLAUDE.md): Synced from PostgreSQL to workspace
    - Skills: Still synced from bucket (if using skills)

    This endpoint should be called by frontend when user opens AI agent page,
    BEFORE opening WebSocket connection.

    Request body: {"auth_token": "Bearer ..."}

    Returns:
        {
            "success": bool,
            "message": str,
            "plugins_verified": int,
            "missing_plugins": list
        }
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            logger.warning("No auth token provided for workspace sync")
            return {
                "success": False,
                "message": "No auth token provided",
            }

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "message": "Invalid auth token"}

        logger.info(f"Starting workspace sync for user: {user_id}")

        # Step 1: Sync memory (CLAUDE.md) from PostgreSQL to workspace
        memory_result = await sync_memory_to_workspace(user_id)
        if memory_result["success"]:
            logger.info(f"Memory synced: {memory_result['message']}")
        else:
            logger.warning(f"Memory sync failed: {memory_result['message']}")

        # Step 2: Verify installed plugins exist (git-based approach)
        logger.info(f"Verifying installed plugins for user: {user_id}")
        verify_result = await unzip_installed_plugins(user_id)

        verified_count = verify_result.get("verified_count", 0)
        missing_plugins = verify_result.get("missing_plugins", [])

        if verify_result["success"]:
            logger.info(f"Verified {verified_count} plugins")

            message = f"Verified {verified_count} plugins"
            if missing_plugins:
                message += f" ({len(missing_plugins)} missing)"

            return {
                "success": True,
                "message": message,
                "plugins_verified": verified_count,
                "missing_plugins": missing_plugins,
                "memory_synced": memory_result["success"],
            }
        else:
            logger.warning(f"Failed to verify plugins: {verify_result['message']}")
            return {
                "success": True,  # Still success, just plugin verification issue
                "message": f"Memory synced, but failed to verify plugins: {verify_result['message']}",
                "plugins_verified": 0,
                "missing_plugins": [],
                "memory_synced": memory_result["success"],
            }

    except Exception as e:
        return {
            "success": False,
            "message": sanitize_error_message(e, "syncing workspace"),
        }


@router.post("/sync-marketplaces")
async def sync_marketplaces(request: Request):
    """
    Sync all git-based marketplaces using git fetch.

    This performs incremental updates for all cloned marketplaces.
    Much faster than re-downloading ZIPs.

    Request body: {"auth_token": "Bearer ..."}

    Returns:
        {
            "success": bool,
            "message": str,
            "updated_count": int,
            "results": [...]
        }
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        logger.info(f"User {user_id}: Syncing all marketplaces via git fetch")

        # Get all marketplaces from PostgreSQL
        marketplaces = execute_query(
            "SELECT name, branch, git_commit_sha FROM marketplaces WHERE user_id = %s AND status = 'active'",
            (user_id,),
            fetch="all"
        )

        if not marketplaces:
            return {
                "success": True,
                "message": "No marketplaces to sync",
                "updated_count": 0,
                "results": [],
            }

        workspace_path = get_user_workspace_path(user_id)
        results = []

        for mp in marketplaces:
            mp_name = mp["name"]
            mp_branch = mp.get("branch", "main")
            mp_dir = get_marketplace_dir(workspace_path, mp_name)

            # Check if it's a git repository
            if not await is_git_repository(mp_dir):
                results.append({
                    "marketplace": mp_name,
                    "success": False,
                    "error": "Not a git repository - needs clone",
                })
                continue

            # Fetch and reset
            success, result, had_changes = await fetch_and_reset(mp_dir, mp_branch)

            if success:
                # Update commit SHA in database
                execute_query(
                    """
                    UPDATE marketplaces SET
                        git_commit_sha = %s,
                        last_synced_at = NOW()
                    WHERE user_id = %s AND name = %s
                    """,
                    (result, user_id, mp_name),
                    fetch="none"
                )

                results.append({
                    "marketplace": mp_name,
                    "success": True,
                    "had_changes": had_changes,
                    "commit_sha": result,
                })
            else:
                results.append({
                    "marketplace": mp_name,
                    "success": False,
                    "error": result,
                })

        updated_count = sum(1 for r in results if r.get("success") and r.get("had_changes"))
        total_success = sum(1 for r in results if r.get("success"))

        logger.info(f"Marketplace sync complete: {updated_count} updated, {total_success}/{len(marketplaces)} successful")

        return {
            "success": True,
            "message": f"Synced {total_success} marketplaces ({updated_count} had updates)",
            "updated_count": updated_count,
            "total_synced": total_success,
            "results": results,
        }

    except Exception as e:
        return {
            "success": False,
            "message": sanitize_error_message(e, "syncing marketplaces"),
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
