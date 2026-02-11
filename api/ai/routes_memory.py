"""
Memory (CLAUDE.md) routes for AI Agent API.

Handles:
- GET /api/memory - Get project memory content
- POST /api/memory - Create/update project memory
- DELETE /api/memory - Delete project memory

Memory is project-scoped: all users in the same project share one CLAUDE.md.
This matches Claude Code's "project" scope (.claude/CLAUDE.md).
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Request

from workspace_service import extract_user_id_from_token, sync_memory_to_workspace
from database_util import execute_query, ensure_user_exists, extract_user_info_from_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["memory"])


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """Sanitize error messages to prevent information disclosure."""
    logger.error(f"Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)
    return f"An error occurred {context}. Please try again."


@router.get("/memory")
async def get_memory(request: Request):
    """
    Get CLAUDE.md content for a project.

    All users in the same project see the same memory.

    Query params:
        project_id: Project UUID (required)

    Returns:
        {
            "success": bool,
            "content": str,
            "updated_at": str,
            "last_updated_by": str
        }
    """
    try:
        auth_token = request.headers.get("authorization", "")
        project_id = request.query_params.get("project_id", "")

        if not auth_token:
            return {"success": False, "error": "Missing Authorization header"}

        if not project_id:
            return {"success": False, "error": "Missing project_id parameter"}

        # Verify auth (user must be authenticated, but memory is shared per project)
        provider_id = extract_user_id_from_token(auth_token)
        if not provider_id:
            return {"success": False, "error": "Invalid auth token"}

        result = execute_query(
            "SELECT content, updated_at, last_updated_by FROM claude_memory WHERE project_id = %s",
            (project_id,),
            fetch="one"
        )

        if result:
            return {
                "success": True,
                "content": result.get("content", ""),
                "updated_at": str(result.get("updated_at")) if result.get("updated_at") else None,
                "last_updated_by": str(result.get("last_updated_by")) if result.get("last_updated_by") else None,
            }
        else:
            return {"success": True, "content": "", "updated_at": None, "last_updated_by": None}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "getting memory")
        }


@router.post("/memory")
async def update_memory(request: Request):
    """
    Create or update CLAUDE.md content for a project.

    All users in the same project share this memory.

    Request body:
        {
            "auth_token": "Bearer ...",
            "content": "## My Context\\n\\n...",
            "project_id": "uuid" (required)
        }

    Returns:
        {
            "success": bool,
            "content": str,
            "updated_at": str
        }
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        content = body.get("content", "")
        project_id = body.get("project_id", "")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not project_id:
            return {"success": False, "error": "Missing project_id"}

        provider_id = extract_user_id_from_token(auth_token)
        if not provider_id:
            return {"success": False, "error": "Invalid auth token"}

        # Resolve user for last_updated_by tracking
        user_info = extract_user_info_from_token(auth_token)
        user_id = ensure_user_exists(
            provider_id,
            email=user_info.get("email") if user_info else None,
            name=user_info.get("name") if user_info else None
        )

        execute_query(
            """
            INSERT INTO claude_memory (project_id, content, last_updated_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (project_id) DO UPDATE SET
                content = EXCLUDED.content,
                last_updated_by = EXCLUDED.last_updated_by,
                updated_at = NOW()
            """,
            (project_id, content, user_id),
            fetch="none"
        )

        logger.info(f"Memory updated for project {project_id} by user {user_id} ({len(content)} chars)")

        # Sync to workspace file for the current user
        if user_id:
            sync_result = await sync_memory_to_workspace(user_id, project_id=project_id)
            if sync_result["success"]:
                logger.info(f"Synced memory to file: {sync_result['message']}")
            else:
                logger.warning(f"Failed to sync memory: {sync_result['message']}")

        return {
            "success": True,
            "content": content,
            "updated_at": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "updating memory")
        }


@router.delete("/memory")
async def delete_memory(request: Request):
    """
    Delete CLAUDE.md content for a project.

    Query params:
        project_id: Project UUID (required)

    Returns:
        {"success": bool, "message": str}
    """
    try:
        auth_token = request.headers.get("authorization", "")
        project_id = request.query_params.get("project_id", "")

        if not auth_token:
            return {"success": False, "error": "Missing Authorization header"}

        if not project_id:
            return {"success": False, "error": "Missing project_id parameter"}

        provider_id = extract_user_id_from_token(auth_token)
        if not provider_id:
            return {"success": False, "error": "Invalid auth token"}

        # Resolve user for sync
        user_info = extract_user_info_from_token(auth_token)
        user_id = ensure_user_exists(
            provider_id,
            email=user_info.get("email") if user_info else None,
            name=user_info.get("name") if user_info else None
        )

        execute_query(
            "DELETE FROM claude_memory WHERE project_id = %s",
            (project_id,),
            fetch="none"
        )

        logger.info(f"Memory deleted for project {project_id}")

        # Sync empty content to workspace file
        if user_id:
            sync_result = await sync_memory_to_workspace(user_id, project_id=project_id)
            if sync_result["success"]:
                logger.info(f"Synced memory to file: {sync_result['message']}")
            else:
                logger.warning(f"Failed to sync memory: {sync_result['message']}")

        return {"success": True, "message": "Memory deleted successfully"}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "deleting memory")
        }
