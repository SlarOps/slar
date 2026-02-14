"""
MCP Server management routes for AI Agent API (REFACTORED with dependency injection).

Handles:
- GET /api/mcp-servers - List all MCP servers
- POST /api/mcp-servers - Create/update MCP server
- DELETE /api/mcp-servers/{server_name} - Delete MCP server
"""

import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from dependencies import require_org_context, AuthContext
from database_util import execute_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["mcp"])


# ============================================================================
# Pydantic Schemas (Request/Response Models)
# ============================================================================

class MCPServerResponse(BaseModel):
    """MCP Server model for API responses."""
    id: Optional[str] = None
    server_name: str
    server_type: str
    status: str
    command: Optional[str] = None
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    url: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    project_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CreateMCPServerRequest(BaseModel):
    """Request body for creating/updating MCP server."""
    server_name: str = Field(..., description="Unique name for the MCP server")
    server_type: str = Field(..., description="Server type: stdio, sse, or http")

    # stdio server fields
    command: Optional[str] = Field(None, description="Command for stdio server (required for stdio)")
    args: Optional[List[str]] = Field(default_factory=list, description="Command arguments")
    env: Optional[Dict[str, str]] = Field(default_factory=dict, description="Environment variables")

    # sse/http server fields
    url: Optional[str] = Field(None, description="URL for sse/http server (required for sse/http)")
    headers: Optional[Dict[str, str]] = Field(default_factory=dict, description="HTTP headers")

    # Optional project scoping
    project_id: Optional[str] = Field(None, description="Project ID to scope this server to")


class MCPServersListResponse(BaseModel):
    """Response for GET /mcp-servers."""
    success: bool
    servers: List[MCPServerResponse]


class MCPServerCreateResponse(BaseModel):
    """Response for POST /mcp-servers."""
    success: bool
    server: MCPServerResponse


class MCPServerDeleteResponse(BaseModel):
    """Response for DELETE /mcp-servers/{server_name}."""
    success: bool
    message: str


# ============================================================================
# API Endpoints
# ============================================================================

@router.get("/mcp-servers", response_model=MCPServersListResponse)
async def get_mcp_servers(
    ctx: AuthContext = Depends(require_org_context)
):
    """
    Get all MCP servers for current user from PostgreSQL.

    Authentication:
    - Requires valid Authorization header with Bearer token
    - Requires org_id for tenant isolation

    Query params (via dependency):
    - org_id: Organization ID (REQUIRED)
    - project_id: Optional - filter by specific project

    Returns:
    - List of MCP servers accessible to user
    - If project_id provided: returns project servers
    - If no project_id: returns personal servers (project_id IS NULL)
    """
    try:
        # Project-scoped servers
        if ctx.project_id:
            servers = execute_query(
                """
                SELECT * FROM user_mcp_servers
                WHERE project_id = %s
                ORDER BY created_at DESC
                """,
                (ctx.project_id,),
                fetch="all"
            )
        # Personal servers only (legacy behavior)
        else:
            servers = execute_query(
                """
                SELECT * FROM user_mcp_servers
                WHERE user_id = %s AND project_id IS NULL
                ORDER BY created_at DESC
                """,
                (ctx.user_id,),
                fetch="all"
            )

        # Convert datetime objects to ISO strings for Pydantic validation
        serialized_servers = []
        for server in (servers or []):
            server_dict = dict(server)
            if server_dict.get('created_at'):
                server_dict['created_at'] = server_dict['created_at'].isoformat()
            if server_dict.get('updated_at'):
                server_dict['updated_at'] = server_dict['updated_at'].isoformat()
            serialized_servers.append(server_dict)

        return MCPServersListResponse(
            success=True,
            servers=serialized_servers
        )

    except Exception as e:
        logger.error(f"Error getting MCP servers for user {ctx.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred getting MCP servers. Please try again."
        )


@router.post("/mcp-servers", response_model=MCPServerCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_mcp_server(
    request: CreateMCPServerRequest,
    ctx: AuthContext = Depends(require_org_context)
):
    """
    Create or update MCP server configuration.

    Supports three server types:
    1. stdio (command-based): Requires command field
    2. sse (server-sent events): Requires url field
    3. http (HTTP API): Requires url field

    Authentication:
    - Requires valid Authorization header
    - Requires org_id for tenant isolation

    Request body:
    - See CreateMCPServerRequest schema

    Returns:
    - Created/updated server configuration
    """
    try:
        # Validate server type
        if request.server_type not in ["stdio", "sse", "http"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid server_type: {request.server_type}. Must be 'stdio', 'sse', or 'http'"
            )

        # Validate required fields per server type
        if request.server_type == "stdio":
            if not request.command:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Missing required field for stdio server: command"
                )
        else:  # sse or http
            if not request.url:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Missing required field for {request.server_type} server: url"
                )

        # Use project_id from request body, or fallback to context
        final_project_id = request.project_id or ctx.project_id

        # Build server record
        server_record = {
            "user_id": ctx.user_id,
            "project_id": final_project_id,
            "server_name": request.server_name,
            "server_type": request.server_type,
            "status": "active",
        }

        if request.server_type == "stdio":
            server_record["command"] = request.command
            server_record["args"] = request.args
            server_record["env"] = request.env
        else:
            server_record["url"] = request.url
            server_record["headers"] = request.headers

        # Construct INSERT query based on whether project_id is present
        if final_project_id:
            # Project server
            query = """
                INSERT INTO user_mcp_servers (user_id, project_id, server_name, server_type, status, command, args, env, url, headers)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (project_id, server_name) WHERE project_id IS NOT NULL DO UPDATE SET
                    server_type = EXCLUDED.server_type,
                    status = EXCLUDED.status,
                    command = EXCLUDED.command,
                    args = EXCLUDED.args,
                    env = EXCLUDED.env,
                    url = EXCLUDED.url,
                    headers = EXCLUDED.headers,
                    updated_at = NOW()
            """
            params = (
                ctx.user_id,
                final_project_id,
                request.server_name,
                request.server_type,
                "active",
                server_record.get("command"),
                json.dumps(server_record.get("args", [])),
                json.dumps(server_record.get("env", {})),
                server_record.get("url"),
                json.dumps(server_record.get("headers", {})),
            )
        else:
            # Personal server
            query = """
                INSERT INTO user_mcp_servers (user_id, server_name, server_type, status, command, args, env, url, headers)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, server_name) WHERE project_id IS NULL DO UPDATE SET
                    server_type = EXCLUDED.server_type,
                    status = EXCLUDED.status,
                    command = EXCLUDED.command,
                    args = EXCLUDED.args,
                    env = EXCLUDED.env,
                    url = EXCLUDED.url,
                    headers = EXCLUDED.headers,
                    updated_at = NOW()
            """
            params = (
                ctx.user_id,
                request.server_name,
                request.server_type,
                "active",
                server_record.get("command"),
                json.dumps(server_record.get("args", [])),
                json.dumps(server_record.get("env", {})),
                server_record.get("url"),
                json.dumps(server_record.get("headers", {})),
            )

        execute_query(query, params, fetch="none")

        logger.info(
            f"Saved MCP server ({request.server_type}): {request.server_name} "
            f"for user {ctx.user_id} (project: {final_project_id})"
        )

        return MCPServerCreateResponse(
            success=True,
            server=MCPServerResponse(**server_record)
        )

    except HTTPException:
        # Re-raise FastAPI HTTPExceptions
        raise
    except Exception as e:
        logger.error(f"Error creating MCP server for user {ctx.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred creating MCP server. Please try again."
        )


@router.delete("/mcp-servers/{server_name}", response_model=MCPServerDeleteResponse)
async def delete_mcp_server(
    server_name: str,
    ctx: AuthContext = Depends(require_org_context)
):
    """
    Delete MCP server configuration.

    Authentication:
    - Requires valid Authorization header
    - Requires org_id for tenant isolation

    Path params:
    - server_name: Name of server to delete

    Query params (via dependency):
    - project_id: Optional - delete project server vs personal server

    Returns:
    - Success message
    """
    try:
        if ctx.project_id:
            # Delete project server
            # TODO: Add permission check (only project admin/owner can delete shared servers?)
            execute_query(
                "DELETE FROM user_mcp_servers WHERE project_id = %s AND server_name = %s",
                (ctx.project_id, server_name),
                fetch="none"
            )
            logger.info(
                f"Deleted MCP server: {server_name} for project {ctx.project_id} "
                f"(by user {ctx.user_id})"
            )
        else:
            # Delete personal server
            execute_query(
                "DELETE FROM user_mcp_servers WHERE user_id = %s AND project_id IS NULL AND server_name = %s",
                (ctx.user_id, server_name),
                fetch="none"
            )
            logger.info(f"Deleted MCP server: {server_name} for user {ctx.user_id}")

        return MCPServerDeleteResponse(
            success=True,
            message=f"Server {server_name} deleted successfully"
        )

    except Exception as e:
        logger.error(f"Error deleting MCP server for user {ctx.user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred deleting MCP server. Please try again."
        )
