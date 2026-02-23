"""
Allowed tools routes for AI Agent API (REFACTORED with dependency injection).

Handles:
- GET /api/allowed-tools - List allowed tools
- POST /api/allowed-tools - Add allowed tool
- DELETE /api/allowed-tools - Remove allowed tool
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from dependencies import get_current_user, UserContext
from workspace_service import (
    get_user_allowed_tools,
    add_user_allowed_tool,
    delete_user_allowed_tool,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["tools"])


# ============================================================================
# Pydantic Schemas
# ============================================================================

class AddToolRequest(BaseModel):
    """Request to add an allowed tool."""
    tool_name: str = Field(..., description="Name of the tool to allow")


class ToolsListResponse(BaseModel):
    """Response for GET /allowed-tools."""
    success: bool
    tools: list[str]


class ToolActionResponse(BaseModel):
    """Response for POST/DELETE /allowed-tools."""
    success: bool
    message: str


# ============================================================================
# API Endpoints
# ============================================================================

@router.post("/allowed-tools", response_model=ToolActionResponse)
async def add_allowed_tool(
    body: AddToolRequest,
    user: UserContext = Depends(get_current_user)
):
    """
    Add a tool to the user's allowed tools list.

    Authentication:
    - Requires valid Authorization header with Bearer token

    Request body:
    - tool_name: Name of the tool to allow

    Returns:
    - Success message
    """
    try:
        success = await add_user_allowed_tool(user.user_id, body.tool_name)

        if success:
            return ToolActionResponse(
                success=True,
                message=f"Tool {body.tool_name} added to allowed list"
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to add tool to allowed list"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding allowed tool for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred adding allowed tool. Please try again."
        )


@router.get("/allowed-tools", response_model=ToolsListResponse)
async def get_allowed_tools(
    user: UserContext = Depends(get_current_user)
):
    """
    Get list of allowed tools for the user.

    Authentication:
    - Requires valid Authorization header with Bearer token

    Returns:
    - List of allowed tool names
    """
    try:
        allowed_tools = await get_user_allowed_tools(user.user_id)

        return ToolsListResponse(
            success=True,
            tools=allowed_tools
        )

    except Exception as e:
        logger.error(f"Error getting allowed tools for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred getting allowed tools. Please try again."
        )


@router.delete("/allowed-tools", response_model=ToolActionResponse)
async def remove_allowed_tool(
    tool_name: str,
    user: UserContext = Depends(get_current_user)
):
    """
    Remove a tool from the user's allowed tools list.

    Authentication:
    - Requires valid Authorization header with Bearer token

    Query params:
    - tool_name: Name of tool to remove

    Returns:
    - Success message
    """
    if not tool_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing tool_name query parameter"
        )

    try:
        success = await delete_user_allowed_tool(user.user_id, tool_name)

        if success:
            return ToolActionResponse(
                success=True,
                message=f"Tool {tool_name} removed from allowed list"
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to remove tool from allowed list"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing allowed tool for user {user.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred removing allowed tool. Please try again."
        )
