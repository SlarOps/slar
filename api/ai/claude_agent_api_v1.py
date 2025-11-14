import asyncio
import json
import logging
import time
import uuid
from asyncio import Lock
from typing import Any, Dict

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolPermissionContext,
    ToolResultBlock,
)
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from incident_tools import create_incident_tools_server, set_auth_token
from supabase_storage import (
    extract_user_id_from_token,
    get_user_mcp_servers,
    get_user_workspace_path,
    load_user_plugins,
    sync_all_from_bucket,
    sync_user_skills,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Track tool usage for demonstration
tool_usage_log = []

app = FastAPI(
    title="Claude Agent API",
    description="WebSocket API for Claude Agent SDK with session management",
    version="2.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory cache for user MCP configs
# Simple dict cache - cleared on restart
user_mcp_cache: Dict[str, Dict[str, Any]] = {}

# Per-user locks for plugin installation (prevents race conditions)
# Key: user_id, Value: asyncio.Lock
user_plugin_locks: Dict[str, Lock] = {}


async def heartbeat_task(websocket: WebSocket, interval: int = 10):
    """Send periodic ping messages to keep the connection alive."""
    try:
        while True:
            await asyncio.sleep(interval)
            try:
                await websocket.send_json({"type": "ping", "timestamp": time.time()})
                print("📡 Sent heartbeat ping")
            except Exception as e:
                print(f"❌ Heartbeat failed: {e}")
                break
    except asyncio.CancelledError:
        print("🛑 Heartbeat task cancelled")
        raise


async def message_router(
    websocket: WebSocket,
    agent_queue: asyncio.Queue,
    interrupt_queue: asyncio.Queue,
    permission_response_queue: asyncio.Queue,
):
    """
    Route incoming WebSocket messages to appropriate queues.

    This is the ONLY place that reads from websocket.receive_json()
    to avoid race conditions.
    """
    try:
        while True:
            data = await websocket.receive_json()

            # Handle pong messages immediately
            if data.get("type") == "pong":
                logger.debug(f"📡 Received pong at {data.get('timestamp')}")
                continue

            # Route to appropriate queue based on message type
            msg_type = data.get("type")

            if msg_type == "interrupt":
                logger.info("📬 Routing interrupt message to interrupt_queue")
                await interrupt_queue.put(data)
            elif msg_type == "permission_response" or data.get("allow") is not None:
                # Permission approval/denial from user
                logger.info(
                    "📬 Routing permission response to permission_response_queue"
                )
                await permission_response_queue.put(data)
            else:
                logger.info("📬 Routing agent message to agent_queue")
                await agent_queue.put(data)

    except WebSocketDisconnect:
        logger.info("🔌 Message router: WebSocket disconnected")
    except Exception as e:
        logger.error(f"❌ Message router error: {e}", exc_info=True)
        raise  # Propagate error
    finally:
        # Signal end of messages to all queues
        await agent_queue.put(None)
        await interrupt_queue.put(None)
        await permission_response_queue.put(None)
        logger.info("📭 Router signaled end of messages")


async def websocket_sender(websocket: WebSocket, output_queue: asyncio.Queue):
    """
    Send messages from output queue to WebSocket.

    This task handles all WebSocket sending, isolated from agent processing.
    If WebSocket fails, only this task fails - agent continues processing.
    """
    try:
        while True:
            # Get message from output queue
            message = await output_queue.get()

            # Check for end signal
            if message is None:
                logger.info("📭 WebSocket sender: End of messages")
                break

            # Try to send, but don't crash if WebSocket closed
            try:
                await websocket.send_json(message)
                logger.debug(f"📤 Sent message: {message.get('type')}")
            except Exception as e:
                logger.warning(f"⚠️ Failed to send message (WebSocket closed?): {e}")
                # Don't crash - message lost but agent continues
                # Could implement retry or persistent queue here

    except asyncio.CancelledError:
        logger.info("🛑 WebSocket sender: Cancelled")
        raise
    except Exception as e:
        logger.error(f"❌ WebSocket sender error: {e}", exc_info=True)
    finally:
        logger.info("🧹 WebSocket sender finished")


async def interrupt_task(
    interrupt_queue: asyncio.Queue,
    stop_events: Dict[str, asyncio.Event],
    websocket: WebSocket,
):
    """Handle interrupt requests from the interrupt queue."""
    try:
        while True:
            data = await interrupt_queue.get()

            # Check for end of messages
            if data is None:
                logger.info("🛑 Interrupt task: End of messages")
                break

            # Handle interrupt request
            if data.get("type") == "interrupt":
                session_id = data.get("session_id")
                if session_id:
                    logger.info(
                        f"🛑 Interrupt task: Setting stop event for session: {session_id}"
                    )

                    # Ensure event exists
                    if session_id not in stop_events:
                        stop_events[session_id] = asyncio.Event()

                    # Set the event
                    stop_events[session_id].set()

                    await websocket.send_json(
                        {"type": "interrupt_acknowledged", "session_id": session_id}
                    )

    except asyncio.CancelledError:
        logger.info("🛑 Interrupt task: Cancelled")
        raise
    except Exception as e:
        logger.error(f"❌ Interrupt task error: {e}", exc_info=True)
        raise  # Propagate error
    finally:
        logger.info("🧹 Interrupt task finished")


async def agent_task(
    agent_queue: asyncio.Queue,
    stop_events: Dict[str, asyncio.Event],
    output_queue: asyncio.Queue,
    permission_callback,
    websocket: WebSocket = None,  # Optional, only for sync
):
    """Process agent messages and handle responses."""
    current_auth_token = None
    current_session_id = None

    try:
        while True:
            # Get message from agent queue
            data = await agent_queue.get()

            # Check for end of messages
            if data is None:
                logger.info("🤖 Agent task: End of messages")
                break

            # Get session id and auth token from data
            session_id = data.get("session_id", "")
            auth_token = data.get("auth_token", "")

            # Update current session
            if session_id:
                current_session_id = session_id

                # Initialize stop event for this session
                if session_id not in stop_events:
                    stop_events[session_id] = asyncio.Event()

                # Clear the event (reset for new message)
                stop_events[session_id].clear()

            # Update current auth token
            if auth_token:
                current_auth_token = auth_token
                logger.info(f"🔑 Auth token received (length: {len(auth_token)})")

            # Note: Bucket sync is now handled by frontend via /api/sync-bucket
            # before WebSocket connection to ensure skills are ready

            # Set the auth token for incident_tools to use
            set_auth_token(current_auth_token or "")

            # Extract user_id from token
            user_id = extract_user_id_from_token(current_auth_token or "")

            # Get user workspace directory (isolated per user)
            if user_id:
                user_workspace = str(get_user_workspace_path(user_id))
            else:
                user_workspace = "."

            logger.info(f"📁 User workspace: {user_workspace}")

            # Create MCP server with all incident tools
            incident_tools_server = create_incident_tools_server()

            mcp_servers = {"incident_tools": incident_tools_server}

            user_mcp_servers = await get_user_mcp_servers(current_auth_token or "")

            if user_mcp_servers:
                mcp_servers.update(user_mcp_servers)

            logger.info(f"📁 User MCP servers: {mcp_servers}")

            # Load user plugins from installed_plugins.json
            user_plugins = []
            if user_id:
                user_plugins = load_user_plugins(user_id)
                if user_plugins:
                    logger.info(f"📦 Loaded {len(user_plugins)} user plugins")
                else:
                    logger.debug(f"ℹ️  No plugins installed for user {user_id}")

            options = ClaudeAgentOptions(
                can_use_tool=permission_callback,
                permission_mode="default",
                cwd=user_workspace,
                model="sonnet",
                resume=session_id,
                mcp_servers=mcp_servers,
                plugins=user_plugins,
                setting_sources=["project"],
            )

            async with ClaudeSDKClient(options) as client:
                logger.info("\n📝 Sending query to Claude...")

                await client.query(data["prompt"])

                logger.info("\n📨 Receiving response...")
                async for message in client.receive_response():
                    # Check for interrupt (stop event)

                    logger.info(f"Message: {message}")

                    if (
                        session_id
                        and stop_events.get(session_id)
                        and stop_events[session_id].is_set()
                    ):
                        logger.info(
                            f"🛑 Agent task: Stop event detected for session: {session_id}"
                        )
                        try:
                            await client.interrupt()
                            stop_events[session_id].clear()
                            await output_queue.put(
                                {"type": "interrupted", "session_id": session_id}
                            )
                            logger.info("✅ Agent interrupted successfully")
                            break
                        except Exception as e:
                            logger.error(f"❌ Error interrupting: {e}", exc_info=True)

                    # Process message normally
                    logger.debug(f"Received message: {message}")
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, ThinkingBlock):
                                await output_queue.put(
                                    {"type": "thinking", "content": block.thinking}
                                )
                            elif isinstance(block, TextBlock):
                                await output_queue.put(
                                    {"type": "text", "content": block.text}
                                )
                            elif isinstance(block, ToolResultBlock):
                                await output_queue.put(
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": block.tool_use_id,
                                        "content": block.content,
                                        "is_error": block.is_error,
                                    }
                                )

                    if isinstance(message, SystemMessage):
                        if isinstance(message.data, dict):
                            if message.data.get("subtype") == "init":
                                session_id = message.data.get("session_id")
                                current_session_id = session_id

                                # Initialize stop event
                                if session_id not in stop_events:
                                    stop_events[session_id] = asyncio.Event()
                                stop_events[session_id].clear()

                                await output_queue.put(
                                    {"type": "session_init", "session_id": session_id}
                                )

                    if isinstance(message, ResultMessage):
                        await output_queue.put(
                            {"type": message.subtype, "result": message.result}
                        )

    except asyncio.CancelledError:
        logger.info("🤖 Agent task: Cancelled")
        raise
    except Exception as e:
        logger.error(f"❌ Agent task error: {e}", exc_info=True)
        try:
            await output_queue.put({"type": "error", "error": str(e)})
        except Exception:
            pass
        raise  # Propagate error
    finally:
        # Cleanup session
        if current_session_id and current_session_id in stop_events:
            del stop_events[current_session_id]
            logger.info(f"🧹 Cleaned up stop event for session: {current_session_id}")
        logger.info("🧹 Agent task finished")


@app.post("/api/sync-bucket")
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
        from supabase_storage import extract_user_id_from_token, unzip_installed_plugins

        body = await request.json()
        auth_token = body.get("auth_token", "")

        if not auth_token:
            logger.warning("⚠️  No auth token provided for bucket sync")
            return {
                "success": False,
                "skipped": False,
                "message": "No auth token provided",
            }

        logger.info("🔄 Starting bucket sync...")

        # Step 1: Sync all from bucket (MCP config + skills)
        sync_result = await sync_all_from_bucket(auth_token)

        if not sync_result["success"]:
            return sync_result

        # Log sync status
        if sync_result.get("skipped"):
            logger.info("⏭️  Bucket sync skipped (unchanged)")
        else:
            logger.info(f"✅ Bucket synced: {sync_result['message']}")

        # Step 2: ALWAYS unzip installed plugins (even if sync skipped)
        # This ensures plugins are extracted when user installs new ones
        user_id = extract_user_id_from_token(auth_token)
        if user_id:
            logger.info(f"📦 Unzipping installed plugins for user: {user_id}")
            unzip_result = await unzip_installed_plugins(user_id)

            if unzip_result["success"]:
                logger.info(f"✅ Unzipped {unzip_result['unzipped_count']} plugins")

                # Build message based on sync status
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
                logger.warning(f"⚠️  Failed to unzip plugins: {unzip_result['message']}")

                # Build error message based on sync status
                if sync_result.get("skipped"):
                    error_message = f"Sync skipped (unchanged), but failed to unzip plugins: {unzip_result['message']}"
                else:
                    error_message = f"Synced {sync_result.get('files_synced', 0)} files, but failed to unzip plugins: {unzip_result['message']}"

                # Don't fail the entire sync if unzip fails
                return {
                    "success": True,
                    "skipped": sync_result.get("skipped", False),
                    "message": error_message,
                    "files_synced": sync_result.get("files_synced", 0),
                    "plugins_unzipped": 0,
                }
        else:
            logger.warning("⚠️  Could not extract user_id from token for plugin unzip")

        return sync_result

    except Exception as e:
        logger.error(f"❌ Error syncing bucket: {e}", exc_info=True)
        return {
            "success": False,
            "skipped": False,
            "message": f"Error syncing bucket: {str(e)}",
        }


@app.post("/api/sync-mcp-config")
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
        auth_token = body.get("auth_token", "")

        if not auth_token:
            logger.warning("⚠️  No auth token provided for sync")
            return {"success": False, "message": "No auth token provided"}

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)

        if not user_id:
            logger.warning("⚠️  Could not extract user_id from token")
            return {"success": False, "message": "Invalid auth token"}

        logger.info(f"🔄 Syncing MCP config for user: {user_id}")

        # Download fresh config from Supabase
        user_mcp_servers = await get_user_mcp_servers(auth_token)

        if user_mcp_servers:
            # Update cache
            user_mcp_cache[user_id] = user_mcp_servers
            logger.info(f"✅ Config synced and cached for user: {user_id}")
            logger.info(f"   Servers: {list(user_mcp_servers.keys())}")

            return {
                "success": True,
                "message": "MCP config synced successfully",
                "servers_count": len(user_mcp_servers),
                "servers": list(user_mcp_servers.keys()),
            }
        else:
            logger.info(f"ℹ️  No MCP config found for user: {user_id}")
            # Clear cache if no config found
            if user_id in user_mcp_cache:
                del user_mcp_cache[user_id]

            return {
                "success": True,
                "message": "No MCP config found - cache cleared",
                "servers_count": 0,
                "servers": [],
            }

    except Exception as e:
        logger.error(f"❌ Error syncing MCP config: {e}", exc_info=True)
        return {"success": False, "message": f"Error syncing config: {str(e)}"}


@app.get("/api/mcp-servers")
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
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        # Get auth token from query or header
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Query from PostgreSQL
        supabase = get_supabase_client()
        result = (
            supabase.table("user_mcp_servers")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )

        return {"success": True, "servers": result.data or []}

    except Exception as e:
        logger.error(f"❌ Error getting MCP servers: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.post("/api/mcp-servers")
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
            "server_type": "sse",  # or "http"
            "url": "https://api.example.com/mcp/sse",
            "headers": {"Authorization": "Bearer ${API_TOKEN}"}
        }

    Returns:
        {"success": bool, "server": {...}}
    """
    try:
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        body = await request.json()
        auth_token = body.get("auth_token", "")
        server_name = body.get("server_name")
        server_type = body.get(
            "server_type", "stdio"
        )  # Default to stdio for backward compatibility

        # Basic validation
        if not auth_token or not server_name:
            return {
                "success": False,
                "error": "Missing required fields: auth_token, server_name",
            }

        # Validate server_type
        if server_type not in ["stdio", "sse", "http"]:
            return {
                "success": False,
                "error": f"Invalid server_type: {server_type}. Must be 'stdio', 'sse', or 'http'",
            }

        # Validate based on server_type
        if server_type == "stdio":
            command = body.get("command")
            if not command:
                return {
                    "success": False,
                    "error": "Missing required field for stdio server: command",
                }
        else:  # sse or http
            url = body.get("url")
            if not url:
                return {
                    "success": False,
                    "error": f"Missing required field for {server_type} server: url",
                }

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Build server record based on type
        supabase = get_supabase_client()
        server_record = {
            "user_id": user_id,
            "server_name": server_name,
            "server_type": server_type,
            "status": "active",
        }

        # Add type-specific fields
        if server_type == "stdio":
            server_record["command"] = body.get("command")
            server_record["args"] = body.get("args", [])
            server_record["env"] = body.get("env", {})
        else:  # sse or http
            server_record["url"] = body.get("url")
            server_record["headers"] = body.get("headers", {})

        # Upsert to PostgreSQL
        result = (
            supabase.table("user_mcp_servers")
            .upsert(server_record, on_conflict="user_id,server_name")
            .execute()
        )

        logger.info(
            f"✅ Saved MCP server ({server_type}): {server_name} for user {user_id}"
        )

        return {
            "success": True,
            "server": result.data[0] if result.data else server_record,
        }

    except Exception as e:
        logger.error(f"❌ Error creating MCP server: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.delete("/api/mcp-servers/{server_name}")
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
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        # Get auth token from query or header
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Delete from PostgreSQL
        supabase = get_supabase_client()
        supabase.table("user_mcp_servers").delete().eq("user_id", user_id).eq(
            "server_name", server_name
        ).execute()

        logger.info(f"✅ Deleted MCP server: {server_name} for user {user_id}")

        return {
            "success": True,
            "message": f"Server {server_name} deleted successfully",
        }

    except Exception as e:
        logger.error(f"❌ Error deleting MCP server: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.get("/api/memory")
async def get_memory(request: Request):
    """
    Get CLAUDE.md content (memory/context) for current user from PostgreSQL.

    Query params:
        auth_token: Bearer token (or from Authorization header)

    Returns:
        {
            "success": bool,
            "content": str,
            "updated_at": str
        }
    """
    try:
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        # Get auth token from query or header
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Query from PostgreSQL
        supabase = get_supabase_client()
        result = (
            supabase.table("claude_memory")
            .select("*")
            .eq("user_id", user_id)
            .single()
            .execute()
        )

        if result.data:
            return {
                "success": True,
                "content": result.data.get("content", ""),
                "updated_at": result.data.get("updated_at"),
            }
        else:
            # No memory yet, return empty
            return {"success": True, "content": "", "updated_at": None}

    except Exception as e:
        # User doesn't have memory yet - this is normal
        if "PGRST116" in str(e) or "not found" in str(e).lower():
            logger.info("ℹ️  No memory found for user (first time)")
            return {"success": True, "content": "", "updated_at": None}

        logger.error(f"❌ Error getting memory: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.post("/api/memory")
async def update_memory(request: Request):
    """
    Create or update CLAUDE.md content (memory/context).

    Request body:
        {
            "auth_token": "Bearer ...",
            "content": "## My Context\\n\\n..."
        }

    Returns:
        {
            "success": bool,
            "content": str,
            "updated_at": str
        }
    """
    try:
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        body = await request.json()
        auth_token = body.get("auth_token", "")
        content = body.get("content", "")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Upsert to PostgreSQL (instant, no S3 lag!)
        supabase = get_supabase_client()
        memory_record = {"user_id": user_id, "content": content}

        result = (
            supabase.table("claude_memory")
            .upsert(memory_record, on_conflict="user_id")
            .execute()
        )

        logger.info(f"✅ Memory updated for user {user_id} ({len(content)} chars)")

        return {
            "success": True,
            "content": result.data[0].get("content") if result.data else content,
            "updated_at": result.data[0].get("updated_at") if result.data else None,
        }

    except Exception as e:
        logger.error(f"❌ Error updating memory: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.delete("/api/memory")
async def delete_memory(request: Request):
    """
    Delete CLAUDE.md content (memory/context).

    Query params:
        auth_token: Bearer token

    Returns:
        {"success": bool, "message": str}
    """
    try:
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        # Get auth token from query or header
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Delete from PostgreSQL
        supabase = get_supabase_client()
        supabase.table("claude_memory").delete().eq("user_id", user_id).execute()

        logger.info(f"✅ Memory deleted for user {user_id}")

        return {"success": True, "message": "Memory deleted successfully"}

    except Exception as e:
        logger.error(f"❌ Error deleting memory: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.post("/api/sync-skills")
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
        auth_token = body.get("auth_token", "")

        if not auth_token:
            logger.warning("⚠️  No auth token provided for skill sync")
            return {
                "success": False,
                "message": "No auth token provided",
                "synced_count": 0,
                "failed_count": 0,
                "skills": [],
                "errors": ["No auth token provided"],
            }

        logger.info("🔄 Starting skill sync...")

        # Sync all skills to workspace
        result = await sync_user_skills(auth_token)

        if result["success"]:
            logger.info(
                f"✅ Skills synced successfully: "
                f"{result['synced_count']} synced, {result['failed_count']} failed"
            )
        else:
            logger.warning(
                f"⚠️  Skill sync completed with errors: "
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
        logger.error(f"❌ Error syncing skills: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"Error syncing skills: {str(e)}",
            "synced_count": 0,
            "failed_count": 0,
            "skills": [],
            "errors": [str(e)],
        }


@app.post("/api/marketplace/install-plugin")
async def install_plugin_from_marketplace(request: Request):
    """
    Mark a plugin as installed (files already in S3 from marketplace ZIP).

    This endpoint ONLY updates the database to mark a plugin as installed.
    The actual plugin files are already in S3 (uploaded when marketplace was added).
    When user opens AI agent, sync_bucket will unzip only installed plugins.

    Request body:
        {
            "auth_token": "Bearer ...",
            "marketplace_name": "anthropic-agent-skills",
            "plugin_name": "internal-comms",
            "version": "1.0.0"
        }

    Returns:
        {
            "success": bool,
            "message": str,
            "plugin": {
                "id": "uuid",
                "plugin_name": "internal-comms",
                "marketplace_name": "anthropic-agent-skills",
                "status": "active"
            }
        }
    """
    try:
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        body = await request.json()
        auth_token = body.get("auth_token", "")
        marketplace_name = body.get("marketplace_name")
        plugin_name = body.get("plugin_name")
        version = body.get("version", "1.0.0")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not all([marketplace_name, plugin_name]):
            return {
                "success": False,
                "error": "Missing required fields: marketplace_name, plugin_name",
            }

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)
        logger.info(
            f"📦 User {user_id}: Installing plugin {plugin_name} from {marketplace_name}"
        )

        # Get plugin source path from PostgreSQL marketplace metadata
        # (marketplace.json might not be unzipped yet from bucket)
        install_path = f".claude/plugins/marketplaces/{marketplace_name}/{plugin_name}"  # Default fallback

        supabase = get_supabase_client()

        def get_marketplace_metadata_sync():
            """Get marketplace metadata from PostgreSQL"""
            try:
                result = (
                    supabase.table("marketplaces")
                    .select("*")
                    .eq("user_id", user_id)
                    .eq("name", marketplace_name)
                    .execute()
                )
                if result.data and len(result.data) > 0:
                    return result.data[0]
            except Exception as e:
                logger.error(f"Failed to fetch marketplace from PostgreSQL: {e}")
            return None

        marketplace_record = await asyncio.get_event_loop().run_in_executor(
            None, get_marketplace_metadata_sync
        )

        if not marketplace_record:
            return {
                "success": False,
                "error": f"Marketplace '{marketplace_name}' not found in database",
            }

        # Verify ZIP file exists (should be uploaded when marketplace was added)
        if not marketplace_record.get("zip_path"):
            logger.warning(f"⚠️  No ZIP file for marketplace '{marketplace_name}'")
            return {
                "success": False,
                "error": "Marketplace ZIP not found. Please re-add the marketplace to download plugin files.",
            }

        if marketplace_record and marketplace_record.get("plugins"):
            # Find plugin in marketplace metadata (stored as JSONB in PostgreSQL)
            for plugin_def in marketplace_record["plugins"]:
                if plugin_def.get("name") == plugin_name:
                    # Install path = marketplace + plugin.source
                    source_path = plugin_def.get("source", "./")
                    logger.info(
                        f"✅ Found plugin '{plugin_name}' in PostgreSQL with source: {source_path}"
                    )

                    # Clean source path: "./plugins/code-documentation" → "plugins/code-documentation"
                    source_path_clean = source_path.replace("./", "")

                    if source_path_clean:
                        install_path = f".claude/plugins/marketplaces/{marketplace_name}/{source_path_clean}"
                    else:
                        # Source is "./" means plugin root
                        install_path = (
                            f".claude/plugins/marketplaces/{marketplace_name}"
                        )

                    logger.info(f"📁 Calculated install path: {install_path}")
                    break
            else:
                logger.warning(
                    f"⚠️  Plugin '{plugin_name}' not found in marketplace metadata"
                )
        else:
            logger.warning(
                f"⚠️  No marketplace metadata found in PostgreSQL for '{marketplace_name}'"
            )

        # Update database with correct install_path
        def add_to_db_sync():
            plugin_record = {
                "user_id": user_id,
                "plugin_name": plugin_name,
                "marketplace_name": marketplace_name,
                "version": version,
                "install_path": install_path,
                "status": "active",
                "is_local": False,
            }

            result = (
                supabase.table("installed_plugins")
                .upsert(
                    plugin_record, on_conflict="user_id,plugin_name,marketplace_name"
                )
                .execute()
            )

            return result.data[0] if result.data else plugin_record

        plugin_record = await asyncio.get_event_loop().run_in_executor(
            None, add_to_db_sync
        )
        logger.info("✅ Plugin marked as installed in PostgreSQL")

        return {
            "success": True,
            "message": f"Plugin '{plugin_name}' installed successfully",
            "plugin": plugin_record,
        }

    except Exception as e:
        logger.error(f"❌ Error installing plugin: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.post("/api/plugins/install")
async def install_plugin(request: Request):
    """
    Install a plugin to user's installed_plugins.json.

    Solves race condition problem when installing multiple plugins concurrently:
    - Uses per-user lock to serialize access to installed_plugins.json
    - Ensures atomic read-modify-write operations
    - No more lost updates from concurrent installs

    Request body:
        {
            "auth_token": "Bearer ...",
            "plugin": {
                "name": "skill-name",
                "marketplaceName": "anthropic-agent-skills",
                "version": "1.0.0",
                "installPath": ".claude/plugins/marketplaces/anthropic-agent-skills/skill-name",
                "isLocal": false,
                "gitCommitSha": "abc123"  # optional
            }
        }

    Returns:
        {
            "success": bool,
            "message": str,
            "pluginKey": "skill-name@anthropic-agent-skills"
        }
    """
    try:
        from datetime import datetime

        from supabase_storage import extract_user_id_from_token, get_supabase_client

        body = await request.json()
        auth_token = body.get("auth_token", "")
        plugin = body.get("plugin", {})

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not plugin or not plugin.get("name") or not plugin.get("marketplaceName"):
            return {
                "success": False,
                "error": "Missing required plugin fields: name, marketplaceName",
            }

        # Extract user_id from token
        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        # Get or create lock for this user
        if user_id not in user_plugin_locks:
            user_plugin_locks[user_id] = Lock()

        user_lock = user_plugin_locks[user_id]

        logger.info(
            f"🔒 Acquiring lock for user {user_id} to install plugin: {plugin['name']}"
        )

        # Acquire lock (serialize access)
        async with user_lock:
            logger.info(f"✅ Lock acquired for user {user_id}")

            supabase = get_supabase_client()

            # Path to installed_plugins.json
            plugins_json_path = ".claude/plugins/installed_plugins.json"

            # Read current installed_plugins.json
            try:
                response = supabase.storage.from_(user_id).download(plugins_json_path)
                current_data = json.loads(response)
                plugins = current_data.get("plugins", {})
            except Exception as e:
                logger.info(f"ℹ️  No installed_plugins.json found, creating new: {e}")
                plugins = {}

            # Create plugin key: pluginName@marketplaceName
            plugin_key = f"{plugin['name']}@{plugin['marketplaceName']}"
            now = datetime.utcnow().isoformat() + "Z"

            # Check if already installed
            if plugin_key in plugins:
                logger.info(f"📦 Updating existing plugin: {plugin_key}")
                # Update existing
                plugins[plugin_key] = {
                    **plugins[plugin_key],
                    "version": plugin.get(
                        "version", plugins[plugin_key].get("version", "unknown")
                    ),
                    "lastUpdated": now,
                    "installPath": plugin.get(
                        "installPath", plugins[plugin_key].get("installPath", "")
                    ),
                    "gitCommitSha": plugin.get(
                        "gitCommitSha", plugins[plugin_key].get("gitCommitSha")
                    ),
                    "isLocal": plugin.get(
                        "isLocal", plugins[plugin_key].get("isLocal", False)
                    ),
                }
            else:
                logger.info(f"📦 Adding new plugin: {plugin_key}")
                # Add new
                plugins[plugin_key] = {
                    "version": plugin.get("version", "unknown"),
                    "installedAt": now,
                    "lastUpdated": now,
                    "installPath": plugin.get(
                        "installPath",
                        f".claude/plugins/marketplaces/{plugin['marketplaceName']}/{plugin['name']}",
                    ),
                    "isLocal": plugin.get("isLocal", False),
                }

                if plugin.get("gitCommitSha"):
                    plugins[plugin_key]["gitCommitSha"] = plugin["gitCommitSha"]

            # Write back to storage
            updated_data = {"version": 1, "plugins": plugins}

            json_blob = json.dumps(updated_data, indent=2).encode("utf-8")

            supabase.storage.from_(user_id).upload(
                path=plugins_json_path,
                file=json_blob,
                file_options={"content-type": "application/json", "upsert": "true"},
            )

            logger.info(f"✅ Plugin installed successfully: {plugin_key}")

        logger.info(f"🔓 Lock released for user {user_id}")

        return {
            "success": True,
            "message": f"Plugin {plugin['name']} installed successfully",
            "pluginKey": plugin_key,
        }

    except Exception as e:
        logger.error(f"❌ Error installing plugin: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.post("/api/marketplace/fetch-metadata")
async def fetch_marketplace_metadata(request: Request):
    """
    Fetch marketplace metadata from GitHub API (lightweight, fast!).

    New approach (Option 4: GitHub API + PostgreSQL):
    - Fetch marketplace.json từ GitHub API (~10-50KB)
    - Save metadata to PostgreSQL (instant!)
    - NO ZIP download (save bandwidth & storage)
    - Download plugin files only when installing (lazy loading)

    Request body:
        {
            "auth_token": "Bearer ...",
            "owner": "anthropics",
            "repo": "skills",
            "branch": "main",  # optional, defaults to "main"
            "marketplace_name": "anthropic-agent-skills"  # optional
        }

    Returns:
        {
            "success": bool,
            "message": str,
            "marketplace": {
                "id": "uuid",
                "name": "anthropic-agent-skills",
                "repository_url": "https://github.com/anthropics/skills",
                "plugins": [...],
                "version": "1.0.0"
            }
        }
    """
    try:
        import json

        import httpx
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        body = await request.json()
        auth_token = body.get("auth_token", "")
        owner = body.get("owner")
        repo = body.get("repo")
        branch = body.get("branch", "main")
        marketplace_name = body.get("marketplace_name") or f"{owner}-{repo}"

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not owner or not repo:
            return {"success": False, "error": "Missing required fields: owner, repo"}

        # Extract user_id from token
        try:
            user_id = extract_user_id_from_token(auth_token)
            logger.info(
                f"📦 User {user_id}: Fetching metadata for {owner}/{repo}@{branch}"
            )
        except Exception as e:
            return {"success": False, "error": f"Invalid auth token: {str(e)}"}

        # Fetch marketplace.json from GitHub API (lightweight!)
        marketplace_json_url = f"https://api.github.com/repos/{owner}/{repo}/contents/.claude-plugin/marketplace.json?ref={branch}"
        repository_url = f"https://github.com/{owner}/{repo}"

        logger.info(
            f"🌐 Fetching marketplace.json from GitHub API: {marketplace_json_url}"
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                marketplace_json_url,
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "SLAR-Marketplace-Client",
                },
            )

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Failed to fetch marketplace.json: HTTP {response.status_code}",
                }

            # GitHub API returns base64 encoded content
            github_response = response.json()
            import base64

            marketplace_json_content = base64.b64decode(
                github_response["content"]
            ).decode("utf-8")
            marketplace_metadata = json.loads(marketplace_json_content)

        logger.info(
            f"✅ Fetched marketplace.json ({len(marketplace_json_content)} bytes)"
        )
        logger.info(f"   Marketplace: {marketplace_metadata.get('name')}")
        logger.info(f"   Plugins: {len(marketplace_metadata.get('plugins', []))}")

        # Save marketplace metadata to PostgreSQL (instant, no lag!)
        logger.info("💾 Saving marketplace metadata to PostgreSQL...")

        def save_to_db_sync():
            """Save marketplace to PostgreSQL via Supabase PostgREST"""
            supabase = get_supabase_client()
            marketplace_record = {
                "user_id": user_id,
                "name": marketplace_name,
                "repository_url": repository_url,
                "branch": branch,
                "display_name": marketplace_metadata.get("name", marketplace_name),
                "description": marketplace_metadata.get("description"),
                "version": marketplace_metadata.get("version", "1.0.0"),
                "plugins": marketplace_metadata.get("plugins", []),
                "zip_path": None,  # No ZIP file
                "zip_size": 0,
                "status": "active",
                "last_synced_at": "now()",
            }

            # Upsert to PostgreSQL
            result = (
                supabase.table("marketplaces")
                .upsert(marketplace_record, on_conflict="user_id,name")
                .execute()
            )

            return result.data[0] if result.data else marketplace_record

        db_record = await asyncio.get_event_loop().run_in_executor(
            None, save_to_db_sync
        )
        logger.info("✅ Marketplace metadata saved to PostgreSQL")

        # Return marketplace data immediately (no lag!)
        return {
            "success": True,
            "message": f"Marketplace '{marketplace_name}' metadata fetched successfully",
            "marketplace": db_record,
        }

    except Exception as e:
        logger.error(f"❌ Error fetching marketplace metadata: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.post("/api/marketplace/download-repo-zip")
async def download_repo_zip(request: Request):
    """
    Download GitHub repository and save metadata to PostgreSQL + ZIP to S3.

    New approach (Option 3.5):
    - Metadata → PostgreSQL (instant reads, no lag)
    - Files → S3 Storage (actual ZIP file)
    - Returns marketplace data immediately (no need to GET again)

    Solves the 10-15s lag problem by storing metadata in PostgreSQL instead of S3.

    Request body:
        {
            "auth_token": "Bearer ...",  # Supabase JWT token
            "owner": "anthropics",
            "repo": "skills",
            "branch": "main",  # optional, defaults to "main"
            "marketplace_name": "anthropic-agent-skills"  # optional, defaults to repo name
        }

    Returns:
        {
            "success": bool,
            "message": str,
            "marketplace": {  # Full marketplace data for immediate use
                "id": "uuid",
                "name": "anthropic-agent-skills",
                "repository_url": "https://github.com/anthropics/skills",
                "plugins": [...],
                "version": "1.0.0",
                "zip_path": ".claude/plugins/marketplaces/...",
                "status": "active"
            },
            "error": str  # if success=False
        }
    """
    try:
        import io
        import json
        import zipfile

        import httpx
        from supabase_storage import extract_user_id_from_token, get_supabase_client

        body = await request.json()
        auth_token = body.get("auth_token", "")
        owner = body.get("owner")
        repo = body.get("repo")
        branch = body.get("branch", "main")
        marketplace_name = body.get("marketplace_name") or repo

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not owner or not repo:
            return {"success": False, "error": "Missing required fields: owner, repo"}

        # Extract user_id from token
        try:
            user_id = extract_user_id_from_token(auth_token)
            logger.info(f"📦 User {user_id}: Downloading {owner}/{repo}@{branch}")
        except Exception as e:
            return {"success": False, "error": f"Invalid auth token: {str(e)}"}

        # Download ZIP from GitHub
        zip_url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip"
        repository_url = f"https://github.com/{owner}/{repo}"

        logger.info(f"⬇️  Downloading from {zip_url}...")
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(zip_url, follow_redirects=True)

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Failed to download ZIP: HTTP {response.status_code}",
                }

            zip_data = response.content

        zip_size = len(zip_data)
        logger.info(f"📦 Downloaded {zip_size} bytes ({zip_size / 1024 / 1024:.2f} MB)")

        # Parse marketplace.json from ZIP to get metadata
        marketplace_metadata = None
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data)) as zip_ref:
                # Find marketplace.json in ZIP (usually in .claude-plugin/marketplace.json)
                marketplace_json_path = None
                for file_info in zip_ref.filelist:
                    if file_info.filename.endswith(".claude-plugin/marketplace.json"):
                        marketplace_json_path = file_info.filename
                        break

                if marketplace_json_path:
                    marketplace_json_content = zip_ref.read(marketplace_json_path)
                    marketplace_metadata = json.loads(marketplace_json_content)
                    logger.info("✅ Parsed marketplace.json from ZIP")
                else:
                    logger.warning("⚠️  No marketplace.json found in ZIP")
                    # Use default metadata
                    marketplace_metadata = {
                        "name": marketplace_name,
                        "version": "unknown",
                        "plugins": [],
                    }
        except Exception as e:
            logger.error(f"❌ Failed to parse marketplace.json from ZIP: {e}")
            marketplace_metadata = {
                "name": marketplace_name,
                "version": "unknown",
                "plugins": [],
            }

        # Upload ZIP to S3 storage (background, non-blocking)
        supabase = get_supabase_client()
        storage_path = (
            f".claude/plugins/marketplaces/{marketplace_name}/{repo}-{branch}.zip"
        )

        logger.info(f"⬆️  Uploading ZIP to storage: {storage_path}")

        def upload_zip_sync():
            """Synchronous upload function for executor"""
            supabase.storage.from_(user_id).upload(
                path=storage_path,
                file=zip_data,
                file_options={"content-type": "application/zip", "upsert": "true"},
            )

        await asyncio.get_event_loop().run_in_executor(None, upload_zip_sync)
        logger.info("✅ ZIP uploaded to storage")

        # Save marketplace metadata to PostgreSQL (instant, no lag!)
        logger.info("💾 Saving marketplace metadata to PostgreSQL...")

        def save_to_db_sync():
            """Save marketplace to PostgreSQL via Supabase PostgREST"""
            marketplace_record = {
                "user_id": user_id,
                "name": marketplace_name,
                "repository_url": repository_url,
                "branch": branch,
                "display_name": marketplace_metadata.get("name", marketplace_name),
                "description": marketplace_metadata.get("description"),
                "version": marketplace_metadata.get("version", "unknown"),
                "plugins": marketplace_metadata.get("plugins", []),
                "zip_path": storage_path,
                "zip_size": zip_size,
                "status": "active",
                "last_synced_at": "now()",
            }

            # Upsert to PostgreSQL
            result = (
                supabase.table("marketplaces")
                .upsert(marketplace_record, on_conflict="user_id,name")
                .execute()
            )

            return result.data[0] if result.data else marketplace_record

        db_record = await asyncio.get_event_loop().run_in_executor(
            None, save_to_db_sync
        )
        logger.info("✅ Marketplace metadata saved to PostgreSQL")

        # Return marketplace data immediately (no lag!)
        return {
            "success": True,
            "message": f"Marketplace '{marketplace_name}' downloaded and saved to database",
            "marketplace": db_record,  # Return data immediately for frontend
        }

    except Exception as e:
        logger.error(f"❌ Error downloading/uploading repository: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()

    # Create separate queues with size limits
    agent_queue = asyncio.Queue(maxsize=100)
    interrupt_queue = asyncio.Queue(maxsize=10)
    permission_response_queue = asyncio.Queue(maxsize=20)

    # Shared stop events dictionary (per session) - using asyncio.Event for thread safety
    stop_events: Dict[str, asyncio.Event] = {}

    # Create output queue for agent messages
    output_queue = asyncio.Queue(maxsize=100)

    try:
        # Define permission callback that uses queues instead of direct WebSocket read
        async def _my_permission_callback(
            tool_name: str, input_data: dict, context: ToolPermissionContext
        ) -> PermissionResultAllow | PermissionResultDeny:
            """
            Control tool permissions based on tool type and input.

            IMPORTANT: This callback does NOT read from WebSocket directly.
            Instead, it sends request via output_queue and waits for response from permission_response_queue.
            """

            # Log the tool request
            tool_usage_log.append(
                {
                    "tool": tool_name,
                    "input": input_data,
                    "suggestions": context.suggestions,
                }
            )

            logger.info(f"\n🔧 Tool Permission Request: {tool_name}")
            logger.debug(f"   Input: {json.dumps(input_data, indent=2)}")

            # Generate unique request ID
            request_id = str(uuid.uuid4())

            # Send permission request with unique ID via output queue
            await output_queue.put(
                {
                    "type": "permission_request",
                    "request_id": request_id,
                    "tool_name": tool_name,
                    "input_data": input_data,
                    "suggestions": context.suggestions,
                }
            )

            logger.info(
                f"   ❓ Waiting for user approval (request_id: {request_id})..."
            )

            # Wait for response from queue (not directly from WebSocket!)
            while True:
                response = await permission_response_queue.get()

                # Check for end signal
                if response is None:
                    logger.warning("Permission callback: End of messages")
                    return PermissionResultDeny(message="Connection closed")

                # Match request ID if present
                if (
                    response.get("request_id")
                    and response.get("request_id") != request_id
                ):
                    # Not our response, put it back for other callbacks
                    await permission_response_queue.put(response)
                    await asyncio.sleep(0.01)  # Yield to event loop
                    continue

                # Process response
                if response.get("allow") in ("y", "yes"):
                    logger.info("✅ Tool approved by user")
                    return PermissionResultAllow()
                else:
                    logger.info("❌ Tool denied by user")
                    return PermissionResultDeny(message="User denied permission")

        # Start all tasks
        heartbeat = asyncio.create_task(
            heartbeat_task(websocket, interval=30), name="heartbeat"
        )

        router = asyncio.create_task(
            message_router(
                websocket, agent_queue, interrupt_queue, permission_response_queue
            ),
            name="router",
        )

        # NEW: WebSocket sender task - decouples agent from WebSocket
        sender = asyncio.create_task(
            websocket_sender(websocket, output_queue), name="sender"
        )

        interrupt = asyncio.create_task(
            interrupt_task(interrupt_queue, stop_events, websocket), name="interrupt"
        )

        # Pass output_queue instead of websocket, but keep websocket for sync
        agent = asyncio.create_task(
            agent_task(
                agent_queue,
                stop_events,
                output_queue,
                _my_permission_callback,
                websocket,
            ),
            name="agent",
        )

        # Wait for ALL tasks to complete
        tasks = [heartbeat, router, sender, interrupt, agent]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Check for errors
        for i, (task, result) in enumerate(zip(tasks, results)):
            if isinstance(result, Exception):
                logger.error(
                    f"Task {task.get_name()} failed: {result}", exc_info=result
                )

    except WebSocketDisconnect:
        logger.info("🔌 WebSocket disconnected")
    except Exception as e:
        logger.error(f"❌ Error in websocket_chat: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass
    finally:
        # Cancel all tasks
        logger.info("🧹 Cleaning up tasks...")

        # Signal end of messages to output queue
        try:
            await output_queue.put(None)
        except Exception:
            pass

        # Get all running tasks
        all_tasks = [
            t for t in [heartbeat, router, sender, interrupt, agent] if not t.done()
        ]

        for task in all_tasks:
            task.cancel()

        # Wait for all tasks to finish with timeout
        if all_tasks:
            done, pending = await asyncio.wait(
                all_tasks, timeout=5.0, return_when=asyncio.ALL_COMPLETED
            )

            if pending:
                logger.warning(f"⚠️ {len(pending)} tasks did not finish within timeout")
                for task in pending:
                    logger.warning(f"   - {task.get_name()} still pending")

        # Clean up stop events
        for session_id in list(stop_events.keys()):
            del stop_events[session_id]

        logger.info("🧹 All tasks cleaned up")


if __name__ == "__main__":
    import os

    import uvicorn

    # Disable auto-reload in production to prevent sync issues
    # Auto-reload can cause server restarts during file operations (like sync)
    # which leads to background tasks hanging
    reload_enabled = os.getenv("DEV_MODE", "false").lower() == "true"

    uvicorn.run(
        "claude_agent_api_v1:app", host="0.0.0.0", port=8002, reload=reload_enabled
    )
