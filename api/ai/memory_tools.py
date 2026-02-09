"""
SLAR Memory Tools for Claude Agent SDK

Tools for managing project memory (CLAUDE.md) directly from the database.
This allows the agent to update its own context/memory.
"""

import json
import logging
import os
from datetime import datetime
from contextvars import ContextVar
from typing import Any, Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from claude_agent_sdk import create_sdk_mcp_server, tool

from config import config
from supabase_storage import sync_memory_to_workspace

logger = logging.getLogger(__name__)

# Context variables for tenant isolation (ReBAC) and user tracking
_org_id_ctx: ContextVar[Optional[str]] = ContextVar("org_id", default=None)
_project_id_ctx: ContextVar[Optional[str]] = ContextVar("project_id", default=None)
_user_id_ctx: ContextVar[Optional[str]] = ContextVar("user_id", default=None)


def set_org_id(org_id: str) -> None:
    """Set the organization ID for tenant isolation."""
    _org_id_ctx.set(org_id)


def get_org_id() -> str:
    """Get the current organization ID."""
    return _org_id_ctx.get() or os.getenv("SLAR_ORG_ID", "")


def set_project_id(project_id: str) -> None:
    """Set the project ID for context."""
    _project_id_ctx.set(project_id)


def get_project_id() -> str:
    """Get the current project ID."""
    return _project_id_ctx.get() or ""


def set_user_id(user_id: str) -> None:
    """Set the user ID for tracking updates."""
    _user_id_ctx.set(user_id)


def get_user_id() -> str:
    """Get the current user ID."""
    return _user_id_ctx.get() or ""


def _get_db_connection():
    """Get database connection using centralized config."""
    db_url = config.database_url
    if not db_url:
        raise Exception("DATABASE_URL not configured")
    return psycopg2.connect(db_url, cursor_factory=RealDictCursor)


async def _update_memory_impl(args: dict[str, Any]) -> dict[str, Any]:
    """
    Update CLAUDE.md content for a project.

    Args:
        content: The new Markdown content for memory
        project_id: Optional project UUID (defaults to context)

    Returns:
        Dictionary with update result
    """
    content = args.get("content", "")
    project_id = args.get("project_id") or get_project_id()
    user_id = get_user_id()

    if not content:
        return {
            "content": [{"type": "text", "text": "Error: Content is required"}],
            "isError": True,
        }

    if not project_id:
        return {
            "content": [{"type": "text", "text": "Error: project_id is missing from context and arguments"}],
            "isError": True,
        }

    try:
        conn = _get_db_connection()
        with conn.cursor() as cursor:
            # Upsert memory
            cursor.execute(
                """
                INSERT INTO claude_memory (project_id, content, last_updated_by)
                VALUES (%s, %s, %s)
                ON CONFLICT (project_id) DO UPDATE SET
                    content = EXCLUDED.content,
                    last_updated_by = EXCLUDED.last_updated_by,
                    updated_at = NOW()
                """,
                (project_id, content, user_id or None)
            )
            conn.commit()
        conn.close()

        logger.info(f"Memory updated for project {project_id} by user {user_id} ({len(content)} chars)")

        # Sync to workspace file if user_id is present (to update local agent state immediately)
        sync_msg = ""
        if user_id:
            sync_result = await sync_memory_to_workspace(user_id, project_id=project_id)
            if sync_result["success"]:
                sync_msg = "\n(Synced to local CLAUDE.md)"
                logger.info(f"Synced memory to file: {sync_result['message']}")
            else:
                sync_msg = f"\n(Warning: Failed to sync to local file: {sync_result['message']})"
                logger.warning(f"Failed to sync memory: {sync_result['message']}")

        return {
            "content": [
                {
                    "type": "text", 
                    "text": f"Successfully updated memory for project {project_id}.{sync_msg}"
                }
            ]
        }

    except Exception as e:
        logger.error(f"Error updating memory: {e}", exc_info=True)
        return {
            "content": [{"type": "text", "text": f"Error updating memory: {str(e)}"}],
            "isError": True,
        }


@tool(
    "update_memory",
    "Update the project's memory (CLAUDE.md). BEFORE calling this tool, you MUST read the existing memory to ensure you don't overwrite important information. Use this to save important context, decisions, or learnings for future sessions.",
    {
        "content": str,
        # project_id is optional - defaults to current project from context
    },
)
async def update_memory(args: dict[str, Any]) -> dict[str, Any]:
    return await _update_memory_impl(args)


# Export all tools as a list
MEMORY_TOOLS = [
    update_memory,
]


def create_memory_tools_server():
    """
    Create and return an MCP server with memory management tools.
    """
    return create_sdk_mcp_server(
        name="memory_tools", version="1.0.0", tools=MEMORY_TOOLS
    )
