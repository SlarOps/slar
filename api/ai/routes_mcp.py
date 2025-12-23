"""
MCP Server management routes for AI Agent API.

Handles:
- GET /api/mcp-servers - List all MCP servers
- POST /api/mcp-servers - Create/update MCP server
- DELETE /api/mcp-servers/{server_name} - Delete MCP server
"""

import json
import logging
from fastapi import APIRouter, Request

from supabase_storage import extract_user_id_from_token, sync_mcp_config_to_local
from database_util import execute_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["mcp"])


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """Sanitize error messages to prevent information disclosure."""
    logger.error(f"Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)
    return f"An error occurred {context}. Please try again."


@router.get("/mcp-servers")
async def get_mcp_servers(request: Request):
    """
    Get all MCP servers for current user from PostgreSQL.

    Query params:
        auth_token: Bearer token (or from Authorization header)

    Returns:
        {
            "success": bool,
            "servers": [
                {
                    "id": "uuid",
                    "server_name": "context7",
                    "command": "npx",
                    "args": ["-y", "@uptudev/mcp-context7"],
                    "env": {},
                    "status": "active"
                }
            ]
        }
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        servers = execute_query(
            """
            SELECT * FROM user_mcp_servers
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (user_id,),
            fetch="all"
        )

        return {"success": True, "servers": servers or []}

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "getting MCP servers")
        }


@router.post("/mcp-servers")
async def create_mcp_server(request: Request):
    """
    Create or update MCP server configuration.

    Supports three server types:
    1. stdio (command-based): Requires command field
    2. sse (server-sent events): Requires url field
    3. http (HTTP API): Requires url field

    Request body (stdio):
        {
            "auth_token": "Bearer ...",
            "server_name": "context7",
            "server_type": "stdio",
            "command": "npx",
            "args": ["-y", "@uptudev/mcp-context7"],
            "env": {"API_KEY": "..."}
        }

    Request body (sse/http):
        {
            "auth_token": "Bearer ...",
            "server_name": "remote-api",
            "server_type": "sse",
            "url": "https://api.example.com/mcp/sse",
            "headers": {"Authorization": "Bearer ${API_TOKEN}"}
        }

    Returns:
        {"success": bool, "server": {...}}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        server_name = body.get("server_name")
        server_type = body.get("server_type", "stdio")

        if not auth_token or not server_name:
            return {
                "success": False,
                "error": "Missing required fields: auth_token, server_name",
            }

        if server_type not in ["stdio", "sse", "http"]:
            return {
                "success": False,
                "error": f"Invalid server_type: {server_type}. Must be 'stdio', 'sse', or 'http'",
            }

        if server_type == "stdio":
            command = body.get("command")
            if not command:
                return {
                    "success": False,
                    "error": "Missing required field for stdio server: command",
                }
        else:
            url = body.get("url")
            if not url:
                return {
                    "success": False,
                    "error": f"Missing required field for {server_type} server: url",
                }

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        server_record = {
            "user_id": user_id,
            "server_name": server_name,
            "server_type": server_type,
            "status": "active",
        }

        if server_type == "stdio":
            server_record["command"] = body.get("command")
            server_record["args"] = body.get("args", [])
            server_record["env"] = body.get("env", {})
        else:
            server_record["url"] = body.get("url")
            server_record["headers"] = body.get("headers", {})

        execute_query(
            """
            INSERT INTO user_mcp_servers (user_id, server_name, server_type, status, command, args, env, url, headers)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, server_name) DO UPDATE SET
                server_type = EXCLUDED.server_type,
                status = EXCLUDED.status,
                command = EXCLUDED.command,
                args = EXCLUDED.args,
                env = EXCLUDED.env,
                url = EXCLUDED.url,
                headers = EXCLUDED.headers,
                updated_at = NOW()
            """,
            (
                user_id,
                server_name,
                server_type,
                "active",
                server_record.get("command"),
                json.dumps(server_record.get("args", [])),
                json.dumps(server_record.get("env", {})),
                server_record.get("url"),
                json.dumps(server_record.get("headers", {})),
            ),
            fetch="none"
        )

        logger.info(f"Saved MCP server ({server_type}): {server_name} for user {user_id}")

        sync_result = await sync_mcp_config_to_local(user_id)
        if sync_result["success"]:
            logger.info(f"Synced MCP config to local file: {sync_result['message']}")
        else:
            logger.warning(f"Failed to sync MCP config to local: {sync_result['message']}")

        return {
            "success": True,
            "server": server_record,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "creating MCP server")
        }


@router.delete("/mcp-servers/{server_name}")
async def delete_mcp_server(server_name: str, request: Request):
    """
    Delete MCP server configuration.

    Path params:
        server_name: Name of server to delete

    Query params:
        auth_token: Bearer token

    Returns:
        {"success": bool, "message": str}
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        execute_query(
            "DELETE FROM user_mcp_servers WHERE user_id = %s AND server_name = %s",
            (user_id, server_name),
            fetch="none"
        )

        logger.info(f"Deleted MCP server: {server_name} for user {user_id}")

        sync_result = await sync_mcp_config_to_local(user_id)
        if sync_result["success"]:
            logger.info(f"Synced MCP config to local file: {sync_result['message']}")
        else:
            logger.warning(f"Failed to sync MCP config to local: {sync_result['message']}")

        return {
            "success": True,
            "message": f"Server {server_name} deleted successfully",
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "deleting MCP server")
        }
