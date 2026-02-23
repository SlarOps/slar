"""
Memory (CLAUDE.md) routes for AI Agent API (REFACTORED with dependency injection).

Handles:
- GET /api/memory - Get project memory content
- POST /api/memory - Create/update project memory
- DELETE /api/memory - Delete project memory

Memory is project-scoped: all users in the same project share one CLAUDE.md.
This matches Claude Code's "project" scope (.claude/CLAUDE.md).
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from typing import Optional

from dependencies import get_current_user, UserContext
from workspace_service import sync_memory_to_workspace
from database_util import execute_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["memory"])


# ============================================================================
# Pydantic Schemas
# ============================================================================

class MemoryResponse(BaseModel):
    """Response for GET /api/memory."""
    success: bool
    content: str = ""
    updated_at: Optional[str] = None
    last_updated_by: Optional[str] = None


class UpdateMemoryRequest(BaseModel):
    """Request to update memory."""
    content: str = Field(..., description="CLAUDE.md content")
    project_id: str = Field(..., description="Project ID (required - memory is project-scoped)")


class UpdateMemoryResponse(BaseModel):
    """Response for POST /api/memory."""
    success: bool
    content: str
    updated_at: str


class DeleteMemoryResponse(BaseModel):
    """Response for DELETE /api/memory."""
    success: bool
    message: str


# ============================================================================
# API Endpoints
# ============================================================================

@router.get("/memory", response_model=MemoryResponse)
async def get_memory(
    project_id: str = Query(..., description="Project UUID (required)"),
    user: UserContext = Depends(get_current_user)
):
    """
    Get CLAUDE.md content for a project.

    All users in the same project see the same memory.

    Authentication:
    - Requires valid Authorization header

    Query params:
    - project_id: Project UUID (required)

    Returns:
    - Memory content and metadata
    """
    try:
        result = execute_query(
            "SELECT content, updated_at, last_updated_by FROM claude_memory WHERE project_id = %s",
            (project_id,),
            fetch="one"
        )

        if result:
            return MemoryResponse(
                success=True,
                content=result.get("content", ""),
                updated_at=str(result.get("updated_at")) if result.get("updated_at") else None,
                last_updated_by=str(result.get("last_updated_by")) if result.get("last_updated_by") else None,
            )
        else:
            return MemoryResponse(
                success=True,
                content="",
                updated_at=None,
                last_updated_by=None
            )

    except Exception as e:
        logger.error(f"Error getting memory for project {project_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred getting memory. Please try again."
        )


@router.post("/memory", response_model=UpdateMemoryResponse)
async def update_memory(
    body: UpdateMemoryRequest,
    user: UserContext = Depends(get_current_user)
):
    """
    Create or update CLAUDE.md content for a project.

    All users in the same project share this memory.

    Authentication:
    - Requires valid Authorization header

    Request body:
    - content: CLAUDE.md content
    - project_id: Project UUID (required)

    Returns:
    - Updated memory content and timestamp
    """
    try:
        execute_query(
            """
            INSERT INTO claude_memory (project_id, content, last_updated_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (project_id) DO UPDATE SET
                content = EXCLUDED.content,
                last_updated_by = EXCLUDED.last_updated_by,
                updated_at = NOW()
            """,
            (body.project_id, body.content, user.user_id),
            fetch="none"
        )

        logger.info(f"Memory updated for project {body.project_id} by user {user.user_id} ({len(body.content)} chars)")

        # Sync to workspace file for the current user
        sync_result = await sync_memory_to_workspace(user.user_id, project_id=body.project_id)
        if sync_result["success"]:
            logger.info(f"Synced memory to file: {sync_result['message']}")
        else:
            logger.warning(f"Failed to sync memory: {sync_result['message']}")

        return UpdateMemoryResponse(
            success=True,
            content=body.content,
            updated_at=datetime.utcnow().isoformat(),
        )

    except Exception as e:
        logger.error(f"Error updating memory for project {body.project_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred updating memory. Please try again."
        )


@router.delete("/memory", response_model=DeleteMemoryResponse)
async def delete_memory(
    project_id: str = Query(..., description="Project UUID (required)"),
    user: UserContext = Depends(get_current_user)
):
    """
    Delete CLAUDE.md content for a project.

    Authentication:
    - Requires valid Authorization header

    Query params:
    - project_id: Project UUID (required)

    Returns:
    - Success message
    """
    try:
        execute_query(
            "DELETE FROM claude_memory WHERE project_id = %s",
            (project_id,),
            fetch="none"
        )

        logger.info(f"Memory deleted for project {project_id}")

        # Sync empty content to workspace file
        sync_result = await sync_memory_to_workspace(user.user_id, project_id=project_id)
        if sync_result["success"]:
            logger.info(f"Synced memory to file: {sync_result['message']}")
        else:
            logger.warning(f"Failed to sync memory: {sync_result['message']}")

        return DeleteMemoryResponse(
            success=True,
            message="Memory deleted successfully"
        )

    except Exception as e:
        logger.error(f"Error deleting memory for project {project_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred deleting memory. Please try again."
        )
