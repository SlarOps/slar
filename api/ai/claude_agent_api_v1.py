from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    TextBlock,
    ToolPermissionContext,
    ThinkingBlock,
    ToolUseBlock,
    ToolResultBlock,
    SystemMessage,
)
import json
import asyncio
import time
import uuid
import logging
from contextvars import ContextVar
from typing import Dict, Optional, Any

from incident_tools import create_incident_tools_server, set_auth_token
from supabase_storage import (
    get_user_mcp_servers,
    extract_user_id_from_token,
    get_user_workspace_path,
    sync_user_skills,
    sync_all_from_bucket
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Track tool usage for demonstration
tool_usage_log = []

app = FastAPI(
    title="Claude Agent API",
    description="WebSocket API for Claude Agent SDK with session management",
    version="2.0.0"
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

async def heartbeat_task(websocket: WebSocket, interval: int = 10):
    """Send periodic ping messages to keep the connection alive."""
    try:
        while True:
            await asyncio.sleep(interval)
            try:
                await websocket.send_json({
                    "type": "ping",
                    "timestamp": time.time()
                })
                print(f"📡 Sent heartbeat ping")
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
    permission_response_queue: asyncio.Queue
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
                logger.info(f"📬 Routing interrupt message to interrupt_queue")
                await interrupt_queue.put(data)
            elif msg_type == "permission_response" or data.get("allow") is not None:
                # Permission approval/denial from user
                logger.info(f"📬 Routing permission response to permission_response_queue")
                await permission_response_queue.put(data)
            else:
                logger.info(f"📬 Routing agent message to agent_queue")
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


async def websocket_sender(
    websocket: WebSocket,
    output_queue: asyncio.Queue
):
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
    websocket: WebSocket
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
                    logger.info(f"🛑 Interrupt task: Setting stop event for session: {session_id}")

                    # Ensure event exists
                    if session_id not in stop_events:
                        stop_events[session_id] = asyncio.Event()

                    # Set the event
                    stop_events[session_id].set()

                    await websocket.send_json({
                        "type": "interrupt_acknowledged",
                        "session_id": session_id
                    })

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
    websocket: WebSocket = None  # Optional, only for sync
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

            options = ClaudeAgentOptions(
                can_use_tool=permission_callback,
                permission_mode="default",
                cwd=user_workspace,
                model="sonnet",
                resume=session_id,
                mcp_servers=mcp_servers,
                setting_sources = ["project"]
            )

            async with ClaudeSDKClient(options) as client:
                logger.info("\n📝 Sending query to Claude...")

                await client.query(data["prompt"])

                logger.info("\n📨 Receiving response...")
                async for message in client.receive_response():
                    # Check for interrupt (stop event)
                    if session_id and stop_events.get(session_id) and stop_events[session_id].is_set():
                        logger.info(f"🛑 Agent task: Stop event detected for session: {session_id}")
                        try:
                            await client.interrupt()
                            stop_events[session_id].clear()
                            await output_queue.put({
                                "type": "interrupted",
                                "session_id": session_id
                            })
                            logger.info(f"✅ Agent interrupted successfully")
                            break
                        except Exception as e:
                            logger.error(f"❌ Error interrupting: {e}", exc_info=True)

                    # Process message normally
                    logger.debug(f"Received message: {message}")
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, ThinkingBlock):
                                await output_queue.put({
                                    "type": "thinking",
                                    "content": block.thinking
                                })
                            elif isinstance(block, TextBlock):
                                await output_queue.put({
                                    "type": "text",
                                    "content": block.text
                                })
                            elif isinstance(block, ToolResultBlock):
                                await output_queue.put({
                                    "type": "tool_result",
                                    "tool_use_id": block.tool_use_id,
                                    "content": block.content,
                                    "is_error": block.is_error
                                })

                    if isinstance(message, SystemMessage):
                        if isinstance(message.data, dict):
                            if message.data.get("subtype") == "init":
                                session_id = message.data.get("session_id")
                                current_session_id = session_id

                                # Initialize stop event
                                if session_id not in stop_events:
                                    stop_events[session_id] = asyncio.Event()
                                stop_events[session_id].clear()

                                await output_queue.put({
                                    "type": "session_init",
                                    "session_id": session_id
                                })

                    if isinstance(message, ResultMessage):
                        await output_queue.put({
                            "type": message.subtype,
                            "result": message.result
                        })

    except asyncio.CancelledError:
        logger.info("🤖 Agent task: Cancelled")
        raise
    except Exception as e:
        logger.error(f"❌ Agent task error: {e}", exc_info=True)
        try:
            await output_queue.put({
                "type": "error",
                "error": str(e)
            })
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

    This endpoint should be called by frontend when user opens AI agent page,
    BEFORE opening WebSocket connection.

    Request body: {"auth_token": "Bearer ..."}

    Returns:
        {
            "success": bool,
            "skipped": bool,
            "message": str,
            "mcp_synced": bool,
            "skills_synced": int
        }
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token", "")

        if not auth_token:
            logger.warning("⚠️  No auth token provided for bucket sync")
            return {
                "success": False,
                "skipped": False,
                "message": "No auth token provided"
            }

        logger.info("🔄 Starting bucket sync...")

        # Sync all from bucket (MCP config + skills)
        sync_result = await sync_all_from_bucket(auth_token)

        if sync_result["success"]:
            if sync_result.get("skipped"):
                logger.info("⏭️  Bucket sync skipped (unchanged)")
            else:
                logger.info(f"✅ Bucket synced: {sync_result['message']}")

        return sync_result

    except Exception as e:
        logger.error(f"❌ Error syncing bucket: {e}", exc_info=True)
        return {
            "success": False,
            "skipped": False,
            "message": f"Error syncing bucket: {str(e)}"
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
            return {
                "success": False,
                "message": "No auth token provided"
            }

        # Extract user_id
        user_id = extract_user_id_from_token(auth_token)

        if not user_id:
            logger.warning("⚠️  Could not extract user_id from token")
            return {
                "success": False,
                "message": "Invalid auth token"
            }

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
                "servers": list(user_mcp_servers.keys())
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
                "servers": []
            }

    except Exception as e:
        logger.error(f"❌ Error syncing MCP config: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"Error syncing config: {str(e)}"
        }


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
                "errors": ["No auth token provided"]
            }

        logger.info(f"🔄 Starting skill sync...")

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
            "errors": result.get("errors", [])
        }

    except Exception as e:
        logger.error(f"❌ Error syncing skills: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"Error syncing skills: {str(e)}",
            "synced_count": 0,
            "failed_count": 0,
            "skills": [],
            "errors": [str(e)]
        }


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
            tool_name: str,
            input_data: dict,
            context: ToolPermissionContext
        ) -> PermissionResultAllow | PermissionResultDeny:
            """
            Control tool permissions based on tool type and input.

            IMPORTANT: This callback does NOT read from WebSocket directly.
            Instead, it sends request via output_queue and waits for response from permission_response_queue.
            """

            # Log the tool request
            tool_usage_log.append({
                "tool": tool_name,
                "input": input_data,
                "suggestions": context.suggestions
            })

            logger.info(f"\n🔧 Tool Permission Request: {tool_name}")
            logger.debug(f"   Input: {json.dumps(input_data, indent=2)}")

            # Generate unique request ID
            request_id = str(uuid.uuid4())

            # Send permission request with unique ID via output queue
            await output_queue.put({
                "type": "permission_request",
                "request_id": request_id,
                "tool_name": tool_name,
                "input_data": input_data,
                "suggestions": context.suggestions
            })

            logger.info(f"   ❓ Waiting for user approval (request_id: {request_id})...")

            # Wait for response from queue (not directly from WebSocket!)
            while True:
                response = await permission_response_queue.get()

                # Check for end signal
                if response is None:
                    logger.warning("Permission callback: End of messages")
                    return PermissionResultDeny(message="Connection closed")

                # Match request ID if present
                if response.get("request_id") and response.get("request_id") != request_id:
                    # Not our response, put it back for other callbacks
                    await permission_response_queue.put(response)
                    await asyncio.sleep(0.01)  # Yield to event loop
                    continue

                # Process response
                if response.get("allow") in ("y", "yes"):
                    logger.info(f"✅ Tool approved by user")
                    return PermissionResultAllow()
                else:
                    logger.info(f"❌ Tool denied by user")
                    return PermissionResultDeny(
                        message="User denied permission"
                    )

        # Start all tasks
        heartbeat = asyncio.create_task(
            heartbeat_task(websocket, interval=30),
            name="heartbeat"
        )

        router = asyncio.create_task(
            message_router(websocket, agent_queue, interrupt_queue, permission_response_queue),
            name="router"
        )

        # NEW: WebSocket sender task - decouples agent from WebSocket
        sender = asyncio.create_task(
            websocket_sender(websocket, output_queue),
            name="sender"
        )

        interrupt = asyncio.create_task(
            interrupt_task(interrupt_queue, stop_events, websocket),
            name="interrupt"
        )

        # Pass output_queue instead of websocket, but keep websocket for sync
        agent = asyncio.create_task(
            agent_task(agent_queue, stop_events, output_queue, _my_permission_callback, websocket),
            name="agent"
        )

        # Wait for ALL tasks to complete
        tasks = [heartbeat, router, sender, interrupt, agent]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Check for errors
        for i, (task, result) in enumerate(zip(tasks, results)):
            if isinstance(result, Exception):
                logger.error(f"Task {task.get_name()} failed: {result}", exc_info=result)
    
    except WebSocketDisconnect:
        logger.info("🔌 WebSocket disconnected")
    except Exception as e:
        logger.error(f"❌ Error in websocket_chat: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "error": str(e)
            })
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
        all_tasks = [t for t in [heartbeat, router, sender, interrupt, agent] if not t.done()]

        for task in all_tasks:
            task.cancel()

        # Wait for all tasks to finish with timeout
        if all_tasks:
            done, pending = await asyncio.wait(all_tasks, timeout=5.0, return_when=asyncio.ALL_COMPLETED)

            if pending:
                logger.warning(f"⚠️ {len(pending)} tasks did not finish within timeout")
                for task in pending:
                    logger.warning(f"   - {task.get_name()} still pending")

        # Clean up stop events
        for session_id in list(stop_events.keys()):
            del stop_events[session_id]

        logger.info("🧹 All tasks cleaned up")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "claude_agent_api_v1:app",
        host="0.0.0.0",
        port=8002,
        reload=True
    )
