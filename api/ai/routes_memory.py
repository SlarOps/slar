"""
Memory (CLAUDE.md) routes for AI Agent API.

Handles:
- GET /api/memory - Get memory content
- POST /api/memory - Create/update memory
- DELETE /api/memory - Delete memory
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Request

from supabase_storage import extract_user_id_from_token, sync_memory_to_workspace
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
    Get CLAUDE.md content (memory/context) for current user from PostgreSQL.

    Query params:
        auth_token: Bearer token (or from Authorization header)
        scope: Memory scope ('local' or 'user', default: 'local')

    Returns:
        {
            "success": bool,
            "content": str,
            "updated_at": str
        }
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )
        scope = request.query_params.get("scope", "local")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        result = execute_query(
            "SELECT * FROM claude_memory WHERE user_id = %s AND scope = %s",
            (user_id, scope),
            fetch="one"
        )

        if result:
            return {
                "success": True,
                "content": result.get("content", ""),
                "updated_at": str(result.get("updated_at")) if result.get("updated_at") else None,
            }
        else:
            return {"success": True, "content": "", "updated_at": None}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "getting memory")
        }


@router.post("/memory")
async def update_memory(request: Request):
    """
    Create or update CLAUDE.md content (memory/context).

    Request body:
        {
            "auth_token": "Bearer ...",
            "content": "## My Context\\n\\n...",
            "scope": "local" or "user" (optional, default: "local")
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
        scope = body.get("scope", "local")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Ensure user exists in users table (required for foreign key)
        user_info = extract_user_info_from_token(auth_token)
        ensure_user_exists(
            user_id,
            email=user_info.get("email") if user_info else None,
            name=user_info.get("name") if user_info else None
        )

        execute_query(
            """
            INSERT INTO claude_memory (user_id, content, scope)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, scope) DO UPDATE SET
                content = EXCLUDED.content,
                updated_at = NOW()
            """,
            (user_id, content, scope),
            fetch="none"
        )

        logger.info(f"Memory updated for user {user_id} ({len(content)} chars)")

        sync_result = await sync_memory_to_workspace(user_id, scope)
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
    Delete CLAUDE.md content (memory/context).

    Query params:
        auth_token: Bearer token
        scope: Memory scope ('local' or 'user', default: 'local')

    Returns:
        {"success": bool, "message": str}
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )
        scope = request.query_params.get("scope", "local")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        execute_query(
            "DELETE FROM claude_memory WHERE user_id = %s AND scope = %s",
            (user_id, scope),
            fetch="none"
        )

        logger.info(f"Memory deleted for user {user_id}")

        sync_result = await sync_memory_to_workspace(user_id, scope)
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
