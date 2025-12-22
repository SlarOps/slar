"""
Allowed tools routes for AI Agent API.

Handles:
- GET /api/allowed-tools - List allowed tools
- POST /api/allowed-tools - Add allowed tool
- DELETE /api/allowed-tools - Remove allowed tool
"""

import logging
from fastapi import APIRouter, Request

from supabase_storage import (
    extract_user_id_from_token,
    get_user_allowed_tools,
    add_user_allowed_tool,
    delete_user_allowed_tool,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["tools"])


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """Sanitize error messages to prevent information disclosure."""
    logger.error(f"Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)
    return f"An error occurred {context}. Please try again."


@router.post("/allowed-tools")
async def add_allowed_tool(request: Request):
    """
    Add a tool to the user's allowed tools list.

    Request body:
        {
            "auth_token": "Bearer ...",
            "tool_name": "tool_name"
        }

    Returns:
        {"success": bool, "message": str}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        tool_name = body.get("tool_name")

        if not auth_token:
            return {"success": False, "message": "Missing auth_token"}

        if not tool_name:
            return {"success": False, "message": "Missing tool_name"}

        user_id = extract_user_id_from_token(auth_token)

        if not user_id:
            return {"success": False, "message": "Invalid auth_token"}

        success = await add_user_allowed_tool(user_id, tool_name)

        if success:
            return {"success": True, "message": f"Tool {tool_name} added to allowed list"}
        else:
            return {"success": False, "message": "Failed to add tool to allowed list"}

    except Exception as e:
        return {"success": False, "message": sanitize_error_message(e, "adding allowed tool")}


@router.get("/allowed-tools")
async def get_allowed_tools(request: Request):
    """
    Get list of allowed tools for the user.

    Query params:
        auth_token: Bearer token

    Returns:
        {"success": bool, "tools": [str]}
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)

        if not user_id:
            return {"success": False, "error": "Invalid auth_token"}

        allowed_tools = await get_user_allowed_tools(user_id)
        return {"success": True, "tools": allowed_tools}

    except Exception as e:
        return {"success": False, "error": sanitize_error_message(e, "getting allowed tools")}


@router.delete("/allowed-tools")
async def remove_allowed_tool(request: Request):
    """
    Remove a tool from the user's allowed tools list.

    Query params:
        auth_token: Bearer token
        tool_name: Name of tool to remove

    Returns:
        {"success": bool, "message": str}
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get("authorization", "")
        tool_name = request.query_params.get("tool_name")

        if not auth_token:
            return {"success": False, "message": "Missing auth_token"}

        if not tool_name:
            return {"success": False, "message": "Missing tool_name"}

        user_id = extract_user_id_from_token(auth_token)

        if not user_id:
            return {"success": False, "message": "Invalid auth_token"}

        success = await delete_user_allowed_tool(user_id, tool_name)

        if success:
            return {"success": True, "message": f"Tool {tool_name} removed from allowed list"}
        else:
            return {"success": False, "message": "Failed to remove tool from allowed list"}

    except Exception as e:
        return {"success": False, "message": sanitize_error_message(e, "removing allowed tool")}
