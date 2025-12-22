import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path

# Load config from YAML (unifies config with Go API)
import config_loader
config_loader.load_config()

from asyncio import Lock
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
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
    ToolUseBlock,
    UserMessage,
)
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from incident_tools import create_incident_tools_server, set_auth_token, set_org_id, set_project_id
from zero_trust_verifier import get_verifier, init_verifier
from audit_service import (
    get_audit_service,
    init_audit_service,
    shutdown_audit_service,
    EventType,
    EventStatus,
)
from audit_hooks import build_hooks_config
from supabase_storage import (
    extract_user_id_from_token,
    get_user_mcp_servers,
    get_user_workspace_path,
    load_user_plugins,
    sync_all_from_bucket,
    sync_marketplace_zip_to_local,
    sync_mcp_config_to_local,
    sync_memory_to_workspace,
    sync_user_skills,
    unzip_installed_plugins,
    get_user_allowed_tools,
    add_user_allowed_tool,
    delete_user_allowed_tool,
)

# Import database routes (split for better organization)
from routes_db import router as db_router
from database_util import execute_query

# Import conversation routes and helper functions
from routes_conversations import (
    router as conversations_router,
    save_conversation,
    save_message,
    update_conversation_activity,
)

# Import audit routes
from routes_audit import router as audit_router

# Import modular routes (split for better maintainability)
from routes_sync import router as sync_router, set_mcp_cache
from routes_mcp import router as mcp_router
from routes_tools import router as tools_router
from routes_memory import router as memory_router
from routes_marketplace import router as marketplace_router

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Track tool usage for demonstration
tool_usage_log = []


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """
    Sanitize error messages to prevent information disclosure.

    Returns a generic error message while logging full details.

    Args:
        error: The exception to sanitize
        context: Context string for logging (e.g., "syncing bucket", "creating session")

    Returns:
        Generic error message safe to return to client
    """
    # Log full error details for debugging
    logger.error(f"❌ Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)

    # Return generic message based on error type
    if isinstance(error, (ConnectionError, TimeoutError)):
        return "Service temporarily unavailable. Please try again."
    elif isinstance(error, PermissionError):
        return "Access denied. Please check your permissions."
    elif isinstance(error, ValueError):
        return "Invalid input provided. Please check your request."
    elif "auth" in str(error).lower() or "token" in str(error).lower():
        return "Authentication failed. Please verify your credentials."
    elif "database" in str(error).lower() or "postgres" in str(error).lower():
        return "Database error. Please contact support if this persists."
    else:
        return "An internal error occurred. Please contact support if this persists."


# ==========================================
# Rate Limiting
# ==========================================

# Rate limiter storage: {user_id: [(timestamp, count), ...]}
rate_limit_storage = defaultdict(list)
rate_limit_lock = Lock()

# Get rate limit from environment (default: 60 requests per minute)
RATE_LIMIT_REQUESTS = int(os.getenv("AI_RATE_LIMIT", "60"))
RATE_LIMIT_WINDOW = 60  # seconds


async def check_rate_limit(user_id: str) -> bool:
    """
    Check if user has exceeded rate limit.

    Args:
        user_id: User identifier

    Returns:
        True if within rate limit, False if exceeded
    """
    async with rate_limit_lock:
        now = datetime.now()
        window_start = now - timedelta(seconds=RATE_LIMIT_WINDOW)

        # Clean up old entries
        rate_limit_storage[user_id] = [
            timestamp for timestamp in rate_limit_storage[user_id]
            if timestamp > window_start
        ]

        # Check if exceeded
        if len(rate_limit_storage[user_id]) >= RATE_LIMIT_REQUESTS:
            logger.warning(
                f"⚠️ Rate limit exceeded for user {user_id}: "
                f"{len(rate_limit_storage[user_id])} requests in {RATE_LIMIT_WINDOW}s"
            )
            return False

        # Add current request
        rate_limit_storage[user_id].append(now)
        return True


async def rate_limit_middleware(request: Request, call_next):
    """
    Rate limiting middleware for all API endpoints.

    Limits requests per user based on AI_RATE_LIMIT environment variable.
    """
    # Skip rate limiting for health check
    if request.url.path == "/health":
        return await call_next(request)

    # Extract user_id from token
    auth_token = (
        request.query_params.get("auth_token")
        or request.headers.get("authorization", "")
    )

    if auth_token:
        user_id = extract_user_id_from_token(auth_token)
        if user_id:
            # Check rate limit
            if not await check_rate_limit(user_id):
                # Log rate limit event
                audit = get_audit_service()
                await audit.log_security_event(
                    event_type=EventType.AUTH_RATE_LIMITED,
                    user_id=user_id,
                    action="rate_limit_check",
                    error_code="RATE_LIMIT_EXCEEDED",
                    error_message=f"Exceeded {RATE_LIMIT_REQUESTS} requests per {RATE_LIMIT_WINDOW}s",
                    source_ip=request.client.host if request.client else None,
                    metadata={"path": str(request.url.path)}
                )
                return JSONResponse(
                    status_code=429,
                    content={
                        "success": False,
                        "error": "Rate limit exceeded. Please try again later.",
                        "retry_after": RATE_LIMIT_WINDOW,
                    },
                )

    return await call_next(request)


# Background worker task reference
cleanup_worker_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for FastAPI.
    Handles startup and shutdown events.
    """
    global cleanup_worker_task

    # Startup
    logger.info("🚀 Starting application...")

    # Initialize audit service
    await init_audit_service()
    logger.info("📝 Audit service initialized")

    # No background workers needed anymore:
    # - heartbeat_task is per-connection (called in websocket endpoint)
    # - marketplace cleanup is now synchronous (no worker needed)

    logger.info("✅ Application started")

    yield

    # Shutdown
    logger.info("🛑 Stopping application...")

    # Shutdown audit service (flush remaining events)
    await shutdown_audit_service()
    logger.info("📝 Audit service stopped")

    logger.info("✅ Application stopped")


app = FastAPI(
    title="Claude Agent API",
    description="WebSocket API for Claude Agent SDK with session management",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS middleware - Configure allowed origins from environment
# For development: use specific localhost domains
# For production: MUST use specific domains only (never use "*")
# SECURITY: Using "*" with allow_credentials=True is a security vulnerability
ALLOWED_ORIGINS = os.getenv(
    "AI_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:8000"
).split(",")

# Strip whitespace from origins
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()]

logger.info(f"✅ CORS configured with allowed origins: {ALLOWED_ORIGINS}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# Apply rate limiting middleware
app.middleware("http")(rate_limit_middleware)
logger.info(f"✅ Rate limiting enabled: {RATE_LIMIT_REQUESTS} requests per {RATE_LIMIT_WINDOW} seconds")

# Include database routes (installed_plugins, marketplaces)
app.include_router(db_router)
logger.info("✅ Database routes loaded from routes_db.py")

# Include conversation history routes
app.include_router(conversations_router)
logger.info("✅ Conversation routes loaded from routes_conversations.py")

# Include audit routes
app.include_router(audit_router)
logger.info("✅ Audit routes loaded from routes_audit.py")

# Include modular routes
app.include_router(sync_router)
logger.info("✅ Sync routes loaded from routes_sync.py")

app.include_router(mcp_router)
logger.info("✅ MCP routes loaded from routes_mcp.py")

app.include_router(tools_router)
logger.info("✅ Tools routes loaded from routes_tools.py")

app.include_router(memory_router)
logger.info("✅ Memory routes loaded from routes_memory.py")

app.include_router(marketplace_router)
logger.info("✅ Marketplace routes loaded from routes_marketplace.py")

# In-memory cache for user MCP configs
# Simple dict cache - cleared on restart
user_mcp_cache: Dict[str, Dict[str, Any]] = {}

# Share cache with sync routes
set_mcp_cache(user_mcp_cache)

# Per-user locks for plugin installation (prevents race conditions)
# Key: user_id, Value: asyncio.Lock
user_plugin_locks: Dict[str, Lock] = {}


from starlette.websockets import WebSocketState

async def heartbeat_task(websocket: WebSocket, output_queue: asyncio.Queue = None, interval: int = 10):
    """Send periodic ping messages to keep the connection alive.

    If output_queue is provided, sends through queue to avoid concurrent WebSocket writes.
    """
    try:
        while True:
            await asyncio.sleep(interval)

            # Check if connection is still open before sending
            if websocket.client_state != WebSocketState.CONNECTED:
                print("🛑 Heartbeat task stopping: WebSocket not connected")
                break

            try:
                ping_msg = {"type": "ping", "timestamp": time.time()}
                if output_queue:
                    # Send through queue to avoid concurrent WebSocket writes
                    await output_queue.put(ping_msg)
                else:
                    # Fallback to direct send (legacy)
                    await websocket.send_json(ping_msg)
            except Exception as e:
                # Only log if it's not a normal disconnect
                if "disconnect" not in str(e).lower() and "closed" not in str(e).lower():
                    print(f"❌ Heartbeat failed: {e}")
                break
    except asyncio.CancelledError:
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
                logger.info(f"📤 Sent to WebSocket: type={message.get('type')}")
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
    output_queue: asyncio.Queue,
):
    """Handle interrupt requests from the interrupt queue.

    Sends acknowledgment through output_queue to avoid concurrent WebSocket writes.
    """
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

                    # Send through queue to avoid concurrent WebSocket writes
                    await output_queue.put(
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


async def agent_task_streaming(
    agent_queue: asyncio.Queue,
    stop_events: Dict[str, asyncio.Event],
    output_queue: asyncio.Queue,
    permission_callback,
    websocket: WebSocket = None,
    hooks_config: Dict[str, Any] = None,
    initial_user_id: str = None,  # User ID from WebSocket auth (for early init)
    initial_auth_token: str = None,  # Auth token from WebSocket
):
    """
    TRUE Streaming Mode - Uses AsyncGenerator with ONE long-lived ClaudeSDKClient.

    Per Claude Agent SDK docs (streaming-vs-single-mode):
    - ONE client.query(generator) call
    - Generator yields messages as they come from queue
    - receive_response() runs concurrently to process responses

    Benefits:
    - Lower latency (no client recreation)
    - Natural multi-turn conversations
    - Image uploads support
    - Real-time interruption
    """
    # Context variables (updated per message)
    context = {
        "auth_token": initial_auth_token or "",
        "session_id": "",
        "conversation_id": "",
        "user_id": initial_user_id or "",
        "org_id": "",
        "project_id": "",
        "first_prompt": "",
        "workspace": "",
        "is_resuming": False,
    }

    # Shared state
    client_ref = {"client": None}
    interrupted = False
    session_initialized = False

    # Synchronization for post-interrupt message processing
    new_message_ready = asyncio.Event()

    # Response processing state
    assistant_text_buffer = []
    user_message_saved = False
    current_prompt = ""

    async def message_generator():
        """
        AsyncGenerator that yields messages from agent_queue.
        This is the TRUE streaming mode - generator keeps yielding until queue returns None.
        """
        nonlocal interrupted, session_initialized, assistant_text_buffer, user_message_saved, current_prompt

        while True:
            try:
                # Wait for message from queue (with timeout to check interrupts)
                try:
                    data = await asyncio.wait_for(agent_queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    # Don't exit on interrupt - just skip and wait for next message
                    # This allows new messages to be processed after an interrupt
                    continue

                # End of messages (WebSocket closed)
                if data is None:
                    logger.info("📭 Message generator: end of messages")
                    return

                # Reset interrupted flag when new message arrives
                # This allows processing to resume after an interrupt
                if interrupted:
                    logger.info("🔄 New message after interrupt, resetting interrupted flag")
                    interrupted = False
                    # Signal that new message is ready for processing
                    new_message_ready.set()

                # Update context from message data
                if data.get("session_id"):
                    context["session_id"] = data["session_id"]
                    if context["session_id"] not in stop_events:
                        stop_events[context["session_id"]] = asyncio.Event()
                    stop_events[context["session_id"]].clear()

                if data.get("conversation_id"):
                    context["conversation_id"] = data["conversation_id"]
                    context["is_resuming"] = True
                else:
                    context["is_resuming"] = False

                if data.get("auth_token"):
                    context["auth_token"] = data["auth_token"]
                    set_auth_token(context["auth_token"])

                if data.get("org_id"):
                    context["org_id"] = data["org_id"]
                    set_org_id(context["org_id"])

                if data.get("project_id"):
                    context["project_id"] = data["project_id"]
                    set_project_id(context["project_id"])

                if data.get("user_id"):
                    context["user_id"] = data["user_id"]

                if not context["user_id"] and context["auth_token"]:
                    context["user_id"] = extract_user_id_from_token(context["auth_token"]) or ""

                prompt = data.get("prompt", "")
                if not prompt:
                    logger.warning("⚠️ Empty prompt received, skipping")
                    continue

                # Store first prompt (for new conversation)
                if not context["first_prompt"] and not context["is_resuming"]:
                    context["first_prompt"] = prompt

                # Reset per-message state
                assistant_text_buffer = []
                user_message_saved = False
                current_prompt = prompt

                logger.info(f"📤 Yielding message to SDK: {prompt[:50]}...")

                # Audit log
                if context["user_id"]:
                    audit = get_audit_service()
                    await audit.log_chat_message(
                        user_id=context["user_id"],
                        session_id=context["session_id"],
                        conversation_id=context["conversation_id"],
                        message_preview=prompt,
                        org_id=context["org_id"],
                        project_id=context["project_id"]
                    )

                # Yield message in SDK streaming input format
                if isinstance(prompt, dict) and "content" in prompt:
                    yield {
                        "type": "user",
                        "message": {
                            "role": "user",
                            "content": prompt["content"]
                        }
                    }
                else:
                    yield {
                        "type": "user",
                        "message": {
                            "role": "user",
                            "content": prompt
                        }
                    }

            except asyncio.CancelledError:
                logger.info("🛑 Message generator: cancelled")
                return
            except Exception as e:
                logger.error(f"❌ Message generator error: {e}", exc_info=True)
                continue

    async def process_responses():
        """
        Process responses from SDK - runs concurrently with message_generator.

        IMPORTANT: receive_response() generator may exhaust after each turn (ResultMessage).
        We need to keep looping to handle subsequent turns in the streaming session.
        """
        nonlocal interrupted, session_initialized, assistant_text_buffer, user_message_saved

        was_interrupted = False  # Track if we broke due to interrupt

        while True:  # Keep running even after interrupts
            try:
                # If still interrupted (didn't see ResultMessage in drain loop), mark for wait
                if interrupted and not was_interrupted:
                    logger.info("⏸️ Still interrupted, marking for wait")
                    was_interrupted = True

                # If we need to wait for new message after interrupt
                if was_interrupted:
                    logger.info("⏸️ Response loop: checking for new message after interrupt...")

                    # Wait for signal if not already set, OR if interrupted flag still True
                    wait_needed = not new_message_ready.is_set() or interrupted
                    if wait_needed:
                        logger.info("⏳ Waiting for new_message_ready signal...")
                        try:
                            await asyncio.wait_for(new_message_ready.wait(), timeout=60.0)
                        except asyncio.TimeoutError:
                            logger.warning("⚠️ Response loop: timeout waiting for new message")
                            continue

                    logger.info("✅ Response loop: new message ready, resuming")
                    # Clear the event for next interrupt cycle
                    new_message_ready.clear()
                    # Give SDK time to process the new message
                    await asyncio.sleep(0.2)
                    was_interrupted = False

                # receive_response() yields messages for current turn
                # After ResultMessage, it may exhaust - we loop to catch next turn
                async for message in client_ref["client"].receive_response():
                    # If interrupted, drain remaining messages but don't process them
                    # This prevents stale ResultMessage from sending "complete" to frontend
                    if interrupted:
                        logger.info(f"🛑 Skipping message during interrupt: {type(message).__name__}")
                        # If we see ResultMessage during interrupt, the interrupted turn is done
                        if isinstance(message, ResultMessage):
                            logger.info("📭 Interrupted turn ResultMessage received, marking for wait")
                            was_interrupted = True
                        continue  # Skip processing, keep draining

                    logger.info(f"📨 Received: {type(message).__name__}")

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
                                assistant_text_buffer.append(block.text)
                            elif isinstance(block, ToolResultBlock):
                                await output_queue.put({
                                    "type": "tool_result",
                                    "tool_use_id": block.tool_use_id,
                                    "content": block.content,
                                    "is_error": block.is_error,
                                })
                            elif isinstance(block, ToolUseBlock):
                                logger.info(f"🔧 Tool: {block.name}({block.id})")
                                if block.name == "TodoWrite":
                                    try:
                                        todos = block.input.get("todos", [])
                                        await output_queue.put({
                                            "type": "todo_update",
                                            "todos": todos
                                        })
                                    except Exception as e:
                                        logger.error(f"❌ TodoWrite error: {e}")

                    elif isinstance(message, UserMessage):
                        for block in message.content:
                            if isinstance(block, ToolResultBlock):
                                await output_queue.put({
                                    "type": "tool_result",
                                    "tool_use_id": block.tool_use_id,
                                    "content": block.content if isinstance(block.content, str) else str(block.content),
                                    "is_error": block.is_error,
                                })

                    elif isinstance(message, SystemMessage):
                        if isinstance(message.data, dict):
                            if message.data.get("subtype") == "init":
                                claude_session_id = message.data.get("session_id")
                                if claude_session_id:
                                    context["conversation_id"] = claude_session_id
                                    logger.info(f"💬 Conversation ID: {claude_session_id}")

                                    # Save conversation to DB (new conversation only)
                                    if context["user_id"] and context["first_prompt"] and not context["is_resuming"] and not session_initialized:
                                        await save_conversation(
                                            user_id=context["user_id"],
                                            conversation_id=claude_session_id,
                                            first_message=context["first_prompt"],
                                            model="sonnet",
                                            workspace_path=context["workspace"],
                                            metadata={
                                                "org_id": context["org_id"],
                                                "project_id": context["project_id"]
                                            }
                                        )
                                        session_initialized = True
                                    elif context["is_resuming"]:
                                        await update_conversation_activity(claude_session_id)

                                    # Save user message
                                    if not user_message_saved and current_prompt:
                                        await save_message(
                                            conversation_id=claude_session_id,
                                            role="user",
                                            content=current_prompt,
                                            message_type="text"
                                        )
                                        user_message_saved = True

                                    # Send conversation_id to frontend
                                    # NOTE: Use different type than "session_created" to avoid
                                    # overwriting session_id on frontend (needed for interrupts)
                                    await output_queue.put({
                                        "type": "conversation_started",
                                        "conversation_id": claude_session_id
                                    })

                    elif isinstance(message, ResultMessage):
                        await output_queue.put({
                            "type": message.subtype,
                            "result": message.result
                        })

                        # Save assistant message when result received
                        if context["conversation_id"] and assistant_text_buffer:
                            await save_message(
                                conversation_id=context["conversation_id"],
                                role="assistant",
                                content="".join(assistant_text_buffer),
                                message_type="text"
                            )

                        # Send complete signal to frontend (one turn done)
                        await output_queue.put({"type": "complete"})
                        logger.info("✅ Turn complete, waiting for next message...")

                        # Reset buffers for next turn
                        assistant_text_buffer = []
                        user_message_saved = False

                # receive_response() exhausted for this turn, wait briefly then check for more
                logger.debug("📭 receive_response() exhausted, waiting for next turn...")
                await asyncio.sleep(0.1)

            except asyncio.CancelledError:
                logger.info("🛑 Response processor cancelled")
                break
            except Exception as e:
                logger.error(f"❌ Response processor error: {e}", exc_info=True)
                # Don't break on error, try to continue
                await asyncio.sleep(0.5)

    async def interrupt_monitor():
        """Monitor for interrupt signals and call client.interrupt()."""
        nonlocal interrupted

        while True:  # Keep monitoring even after interrupts
            try:
                await asyncio.sleep(0.1)

                session_id = context["session_id"]
                if not session_id or session_id not in stop_events:
                    continue

                if stop_events[session_id].is_set():
                    logger.info(f"🛑 Interrupt monitor: stop event for {session_id}")
                    interrupted = True
                    stop_events[session_id].clear()

                    if client_ref["client"]:
                        try:
                            await client_ref["client"].interrupt()
                            logger.info("✅ SDK interrupt called")
                        except Exception as e:
                            logger.error(f"❌ SDK interrupt error: {e}")

                    await output_queue.put({
                        "type": "interrupted",
                        "session_id": session_id
                    })
                    # Don't return - keep monitoring for future interrupts
                    # The interrupted flag will be reset when new message arrives

            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.error(f"❌ Interrupt monitor error: {e}")

    try:
        # Wait for first message to initialize context
        logger.info("⏳ Streaming agent: Waiting for first message...")
        first_data = await agent_queue.get()

        if first_data is None:
            logger.info("📭 No messages, ending session")
            return

        # Initialize context from first message
        context["session_id"] = first_data.get("session_id", "")
        context["auth_token"] = first_data.get("auth_token", "") or context["auth_token"]
        context["conversation_id"] = first_data.get("conversation_id", "")
        context["user_id"] = first_data.get("user_id", "") or context["user_id"]
        context["org_id"] = first_data.get("org_id", "")
        context["project_id"] = first_data.get("project_id", "")
        context["first_prompt"] = first_data.get("prompt", "")
        context["is_resuming"] = bool(context["conversation_id"])
        current_prompt = context["first_prompt"]

        if not context["user_id"] and context["auth_token"]:
            context["user_id"] = extract_user_id_from_token(context["auth_token"]) or ""

        logger.info(f"👤 Session: user={context['user_id']}, session={context['session_id']}")

        # Initialize stop event
        if context["session_id"]:
            stop_events[context["session_id"]] = asyncio.Event()

        # Set auth tokens
        set_auth_token(context["auth_token"])
        if context["org_id"]:
            set_org_id(context["org_id"])
        if context["project_id"]:
            set_project_id(context["project_id"])

        # Get user workspace
        if context["user_id"]:
            context["workspace"] = str(get_user_workspace_path(context["user_id"]))
        else:
            context["workspace"] = "."

        # Load MCP servers
        incident_tools_server = create_incident_tools_server()
        mcp_servers = {"incident_tools": incident_tools_server}

        user_mcp_servers = await get_user_mcp_servers(
            auth_token=context["auth_token"],
            user_id=context["user_id"]
        )
        if user_mcp_servers:
            mcp_servers.update(user_mcp_servers)

        # Load plugins
        user_plugins = []
        if context["user_id"]:
            user_plugins = load_user_plugins(context["user_id"])
            if user_plugins:
                logger.info(f"📦 Loaded {len(user_plugins)} plugins")

        # Load allowed tools
        allowed_tools = [
            "mcp__incident_tools__get_incidents_by_time",
            "mcp__incident_tools__get_incidents_by_id",
            "mcp__incident_tools__get_current_time",
            "mcp__incident_tools__get_incident_stats"
        ]
        if context["user_id"]:
            user_allowed = await get_user_allowed_tools(context["user_id"])
            if user_allowed:
                allowed_tools.extend(user_allowed)

        # Build hooks config
        actual_hooks_config = build_hooks_config(
            user_id=context["user_id"],
            session_id=context["session_id"],
            org_id=context["org_id"],
            project_id=context["project_id"],
        ) if context["user_id"] else hooks_config

        # Audit log first message
        if context["user_id"] and context["first_prompt"]:
            audit = get_audit_service()
            await audit.log_chat_message(
                user_id=context["user_id"],
                session_id=context["session_id"],
                conversation_id=context["conversation_id"],
                message_preview=context["first_prompt"],
                org_id=context["org_id"],
                project_id=context["project_id"]
            )

        # Create SDK options - use resume if continuing conversation
        resume_id = context["conversation_id"] if context["conversation_id"] else None

        options = ClaudeAgentOptions(
            can_use_tool=permission_callback,
            permission_mode="default",
            cwd=context["workspace"],
            model="sonnet",
            resume=resume_id,
            mcp_servers=mcp_servers,
            plugins=user_plugins,
            setting_sources=["project", "user"],
            allowed_tools=allowed_tools,
            hooks=actual_hooks_config,
        )

        # Create message generator that includes first message
        async def full_message_generator():
            # Yield first message
            logger.info(f"📤 Yielding first message: {context['first_prompt'][:50]}...")
            yield {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": context["first_prompt"]
                }
            }

            # Then yield subsequent messages from queue
            async for msg in message_generator():
                yield msg

        # TRUE STREAMING MODE: ONE client, ONE query() call with generator
        logger.info("🚀 Starting TRUE streaming mode...")
        async with ClaudeSDKClient(options) as client:
            client_ref["client"] = client

            # Start interrupt monitor
            monitor_task = asyncio.create_task(interrupt_monitor(), name="interrupt_monitor")

            try:
                # Run query and response processing concurrently
                # query() feeds messages from generator to SDK
                # process_responses() handles SDK responses
                query_task = asyncio.create_task(
                    client.query(full_message_generator()),
                    name="query"
                )
                response_task = asyncio.create_task(
                    process_responses(),
                    name="responses"
                )

                # Wait for query_task to complete (generator exhausts when WebSocket closes)
                # response_task may complete multiple times per turn, but query controls session lifetime
                #
                # TRUE STREAMING: Keep session alive until generator exhausts (WebSocket disconnects)
                # DO NOT cancel query_task when response_task completes - that's just one turn ending!
                try:
                    await query_task
                    logger.info("📭 Message generator exhausted (WebSocket closed)")
                except asyncio.CancelledError:
                    logger.info("🛑 Query task cancelled")
                except Exception as e:
                    logger.error(f"❌ Query task error: {e}", exc_info=True)

                # Now wait for any remaining responses
                if not response_task.done():
                    logger.info("⏳ Waiting for remaining responses...")
                    try:
                        await asyncio.wait_for(response_task, timeout=5.0)
                    except asyncio.TimeoutError:
                        logger.info("⏰ Response task timeout, cancelling")
                        response_task.cancel()
                    except asyncio.CancelledError:
                        pass
                    except Exception as e:
                        logger.error(f"❌ Response task error: {e}")

            finally:
                # Cleanup
                if not monitor_task.done():
                    monitor_task.cancel()
                    try:
                        await monitor_task
                    except asyncio.CancelledError:
                        pass

        logger.info("✅ Streaming session ended")

    except asyncio.CancelledError:
        logger.info("🤖 Streaming agent: cancelled")
        raise
    except Exception as e:
        logger.error(f"❌ Streaming agent error: {e}", exc_info=True)
        try:
            await output_queue.put({
                "type": "error",
                "error": sanitize_error_message(e, "in streaming agent")
            })
        except Exception:
            pass
        raise
    finally:
        if context["session_id"] and context["session_id"] in stop_events:
            del stop_events[context["session_id"]]
        logger.info("🧹 Streaming agent finished")


async def agent_task(
    agent_queue: asyncio.Queue,
    stop_events: Dict[str, asyncio.Event],
    output_queue: asyncio.Queue,
    permission_callback,
    websocket: WebSocket = None,  # Optional, only for sync
    hooks_config: Dict[str, Any] = None,  # Audit hooks configuration
):
    """Process agent messages and handle responses."""
    current_auth_token = None
    current_session_id = None
    current_conversation_id = None  # Claude conversation ID (separate from session_id)
    current_user_id = None  # User ID (from Zero-Trust session OR JWT token)
    current_first_prompt = None  # First prompt for conversation save
    current_workspace = None  # User workspace path
    current_org_id = None  # Organization ID for metadata
    current_project_id = None  # Project ID for metadata
    is_resuming = False  # Flag to track if we're resuming an existing conversation

    try:
        while True:
            # Get message from agent queue
            logger.info("⏳ Agent task: Waiting for next message from queue...")
            data = await agent_queue.get()
            logger.info(f"📨 Agent task: Got message from queue: {data.get('prompt', '')[:30] if data else 'None'}...")

            # Check for end of messages
            if data is None:
                logger.info("🤖 Agent task: End of messages")
                break

            # Get session id and auth token from data
            # NOTE: session_id is for stop events tracking
            # conversation_id is for Claude conversation resume (separate concept!)
            session_id = data.get("session_id", "")
            auth_token = data.get("auth_token", "")
            conversation_id = data.get("conversation_id", "")  # For Claude resume
            direct_user_id = data.get("user_id", "")  # From Zero-Trust secure flow

            # Update current session (for stop events)
            if session_id:
                current_session_id = session_id

                # Initialize stop event for this session
                if session_id not in stop_events:
                    stop_events[session_id] = asyncio.Event()

                # Clear the event (reset for new message)
                stop_events[session_id].clear()

            # Update current conversation ID (for Claude resume)
            # This is separate from session_id - see distinction:
            # - session_id: WebSocket/Zero-Trust session (for security/stop events)
            # - conversation_id: Claude conversation (for AI context resume)
            if conversation_id:
                current_conversation_id = conversation_id
                is_resuming = True  # Mark that we're resuming an existing conversation
                logger.info(f"💬 Conversation ID received (resuming): {conversation_id}")
            else:
                is_resuming = False  # New conversation

            # Store first prompt for conversation save (only if new conversation)
            prompt = data.get("prompt", "")
            logger.info(f"📨 Received: prompt={prompt[:30] if prompt else 'NONE'}..., conversation_id={conversation_id}, is_resuming={is_resuming}")
            if prompt and not current_first_prompt and not is_resuming:
                current_first_prompt = prompt
                logger.info(f"📝 First prompt stored: {current_first_prompt[:30]}...")

            # Store org_id and project_id for metadata
            org_id = data.get("org_id", "")
            if org_id:
                current_org_id = org_id

            project_id = data.get("project_id", "")
            if project_id:
                current_project_id = project_id

            # Update auth token (needed by incident_tools to call Go backend API)
            # This is separate from user_id - both secure and unsecure flows need this
            if auth_token:
                current_auth_token = auth_token
                logger.info(f"🔑 Auth token received (length: {len(auth_token)})")

            # Update current user ID
            # Priority: direct user_id from Zero-Trust > extract from JWT token
            if direct_user_id:
                current_user_id = direct_user_id
                logger.info(f"👤 User ID from Zero-Trust session: {current_user_id}")
            elif auth_token:
                extracted_user_id = extract_user_id_from_token(auth_token)
                if extracted_user_id:
                    current_user_id = extracted_user_id
                    logger.info(f"👤 User ID extracted from JWT: {current_user_id}")

            # Audit log: chat message sent
            if prompt and current_user_id:
                audit = get_audit_service()
                await audit.log_chat_message(
                    user_id=current_user_id,
                    session_id=session_id or current_session_id or "",
                    conversation_id=conversation_id or current_conversation_id,
                    message_preview=prompt,
                    org_id=org_id or current_org_id,
                    project_id=project_id or current_project_id
                )

            # Note: Bucket sync is now handled by frontend via /api/sync-bucket
            # before WebSocket connection to ensure skills are ready

            # Set the auth token for incident_tools to use
            set_auth_token(current_auth_token or "")

            # Set org_id for ReBAC tenant isolation (MANDATORY for API calls)
            org_id = data.get("org_id", "")
            if org_id:
                set_org_id(org_id)
                logger.info(f"🏢 Organization ID set: {org_id}")

            # Set project_id for ReBAC project filtering (OPTIONAL)
            project_id = data.get("project_id", "")
            if project_id:
                set_project_id(project_id)
                logger.info(f"📁 Project ID set: {project_id}")

            # Use the current user_id (from Zero-Trust or JWT)
            user_id = current_user_id

            # Get user workspace directory (isolated per user)
            if user_id:
                user_workspace = str(get_user_workspace_path(user_id))
                current_workspace = user_workspace  # Store for conversation metadata
            else:
                user_workspace = "."

            logger.info(f"📁 User workspace: {user_workspace}")

            # Create MCP server with all incident tools
            incident_tools_server = create_incident_tools_server()

            mcp_servers = {"incident_tools": incident_tools_server}

            # Get user MCP servers
            # Secure flow: user_id from Zero-Trust session (no auth_token needed)
            # Unsecure flow: auth_token for JWT extraction
            user_mcp_servers = await get_user_mcp_servers(
                auth_token=current_auth_token or "",
                user_id=user_id or ""
            )

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

            # Load allowed tools
            allowed_tools = [
                "mcp__incident_tools__get_incidents_by_time",
                "mcp__incident_tools__get_incidents_by_id",
                "mcp__incident_tools__get_current_time",
                "mcp__incident_tools__get_incident_stats"
            ]
            if user_id:
                user_allowed = await get_user_allowed_tools(user_id)
                if user_allowed:
                    allowed_tools.extend(user_allowed)
                    logger.info(f"✅ Loaded {len(user_allowed)} allowed tools from DB")

            # Use conversation_id for Claude resume (NOT session_id!)
            # - session_id: WebSocket/Zero-Trust session (for security, stop events)
            # - conversation_id: Claude conversation (for AI context, multi-turn chat)
            # If conversation_id is provided, Claude will resume that conversation.
            # If not provided (empty/None), Claude starts a new conversation.
            resume_id = current_conversation_id if current_conversation_id else None

            if resume_id:
                logger.info(f"💬 Resuming Claude conversation: {resume_id}")
            else:
                logger.info(f"💬 Starting new Claude conversation")

            # Build audit hooks with actual user context from message data
            # (org_id/project_id come from message, not available at connection time)
            actual_hooks_config = build_hooks_config(
                user_id=current_user_id or "",
                session_id=current_session_id or "",
                org_id=current_org_id,
                project_id=current_project_id,
            ) if current_user_id else hooks_config

            options = ClaudeAgentOptions(
                can_use_tool=permission_callback,
                permission_mode="default",
                cwd=user_workspace,
                model="sonnet",
                resume=resume_id,  # Use conversation_id, not session_id!
                mcp_servers=mcp_servers,
                plugins=user_plugins,
                setting_sources=["project","user"],
                allowed_tools=allowed_tools,
                hooks=actual_hooks_config,  # Audit hooks with org_id/project_id
            )
            async with ClaudeSDKClient(options) as client:
                logger.info("\n📝 Sending query to Claude...")

                await client.query(data["prompt"])

                logger.info("\n📨 Receiving response...")

                # Accumulate assistant text for saving to DB
                assistant_text_buffer = []
                user_message_saved = False  # Track if we've saved the user message
                interrupted = False  # Flag to track if interrupted

                # Concurrent interrupt monitor - runs alongside receive_response
                # This allows interrupts to work even when blocked waiting for API/tool responses
                async def interrupt_monitor():
                    nonlocal interrupted
                    if not session_id or session_id not in stop_events:
                        return

                    stop_event = stop_events[session_id]
                    while not interrupted:
                        # Wait for stop event with short polling interval
                        try:
                            # Check every 100ms for responsiveness
                            await asyncio.wait_for(
                                asyncio.shield(stop_event.wait()),
                                timeout=0.1
                            )
                            # Stop event was set
                            if stop_event.is_set():
                                logger.info(f"🛑 Interrupt monitor: Stop event detected for session: {session_id}")
                                try:
                                    await client.interrupt()
                                    interrupted = True
                                    stop_event.clear()
                                    await output_queue.put(
                                        {"type": "interrupted", "session_id": session_id}
                                    )
                                    logger.info("✅ Agent interrupted by monitor")
                                except Exception as e:
                                    logger.error(f"❌ Error in interrupt monitor: {e}", exc_info=True)
                                return
                        except asyncio.TimeoutError:
                            # Timeout is expected - continue polling
                            continue
                        except asyncio.CancelledError:
                            return

                # Start interrupt monitor as concurrent task
                monitor_task = asyncio.create_task(interrupt_monitor(), name="interrupt_monitor")

                try:
                    async for message in client.receive_response():
                        # Check if we were interrupted - SDK will stop generating after interrupt()
                        # Don't use break as it can cause asyncio cleanup issues
                        if interrupted:
                            logger.info("🛑 Receive loop - interrupted, waiting for SDK to finish")
                            continue  # Let SDK complete naturally after interrupt

                        logger.info(f"Message: {message}")

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
                                    # Accumulate text for saving to DB
                                    assistant_text_buffer.append(block.text)
                                elif isinstance(block, ToolResultBlock):
                                    await output_queue.put(
                                        {
                                            "type": "tool_result",
                                            "tool_use_id": block.tool_use_id,
                                            "content": block.content,
                                            "is_error": block.is_error,
                                        }
                                    )
                                elif isinstance(block, ToolUseBlock):
                                    # Don't send tool_use to frontend - permission_request already shows tool info
                                    # This avoids duplicate display of the same tool call
                                    logger.info(f"🔧 Tool use: {block.name}({block.id})")

                                    # Special handling for TodoWrite - send todo_update event
                                    if block.name == "TodoWrite":
                                        try:
                                            todos = block.input.get("todos", [])
                                            logger.info(f"📝 Todo update detected: {len(todos)} tasks")
                                            await output_queue.put({
                                                "type": "todo_update",
                                                "todos": todos
                                            })
                                        except Exception as e:
                                            logger.error(f"❌ Error processing TodoWrite: {e}", exc_info=True)

                        # Handle UserMessage (tool results from SDK)
                        # Send to frontend so users can see what agent is executing
                        if isinstance(message, UserMessage):
                            logger.info(f"UserMessage received with {len(message.content)} blocks")
                            for block in message.content:
                                if isinstance(block, ToolResultBlock):
                                    # Send tool execution result to frontend
                                    await output_queue.put({
                                        "type": "tool_result",
                                        "tool_use_id": block.tool_use_id,
                                        "content": block.content if isinstance(block.content, str) else str(block.content),
                                        "is_error": block.is_error,
                                    })
                                    logger.debug(f"Sent tool result to frontend: {block.tool_use_id}")

                        if isinstance(message, SystemMessage):
                            if isinstance(message.data, dict):
                                if message.data.get("subtype") == "init":
                                    # Claude SDK returns its conversation session_id
                                    # This is DIFFERENT from Zero-Trust session_id!
                                    # - session_id: Zero-Trust WebSocket session (for security)
                                    # - claude_session_id: Claude conversation (for AI context)
                                    claude_session_id = message.data.get("session_id")

                                    # Update current_conversation_id for resume
                                    if claude_session_id:
                                        current_conversation_id = claude_session_id
                                        logger.info(f"💬 Claude conversation started: {claude_session_id}")

                                        # Save conversation to database for history/resume
                                        # Only save if it's a new conversation (not resuming)
                                        logger.info(f"📝 Save conversation check: user_id={current_user_id}, first_prompt={current_first_prompt[:30] if current_first_prompt else None}..., is_resuming={is_resuming}")
                                        if current_user_id and current_first_prompt and not is_resuming:
                                            await save_conversation(
                                                user_id=current_user_id,
                                                conversation_id=claude_session_id,
                                                first_message=current_first_prompt,
                                                model="sonnet",
                                                workspace_path=current_workspace,
                                                metadata={
                                                    "org_id": current_org_id,
                                                    "project_id": current_project_id
                                                }
                                            )
                                        elif is_resuming:
                                            # Update activity for resumed conversation
                                            await update_conversation_activity(claude_session_id)

                                        # Save user message to DB (only once per query)
                                        # Use data["prompt"] to save current message, not just first
                                        user_prompt = data.get("prompt", "")
                                        if not user_message_saved and user_prompt:
                                            await save_message(
                                                conversation_id=claude_session_id,
                                                role="user",
                                                content=user_prompt,
                                                message_type="text"
                                            )
                                            user_message_saved = True
                                            logger.info(f"💾 Saved user message for conversation {claude_session_id}")

                                    # Send to client so they can save for resume
                                    # Client should save conversation_id and send it back in next messages
                                    await output_queue.put({
                                        "type": "session_init",
                                        "session_id": session_id,  # Zero-Trust session (unchanged)
                                        "conversation_id": claude_session_id,  # Claude conversation (NEW!)
                                    })

                        if isinstance(message, ResultMessage):
                            await output_queue.put(
                                {"type": message.subtype, "result": message.result}
                            )

                            # Save assistant message to DB when response is complete
                            if current_conversation_id and assistant_text_buffer:
                                assistant_content = "".join(assistant_text_buffer)
                                await save_message(
                                    conversation_id=current_conversation_id,
                                    role="assistant",
                                    content=assistant_content,
                                    message_type="text"
                                )
                                logger.info(f"💾 Saved assistant message ({len(assistant_content)} chars) for conversation {current_conversation_id}")

                    # Send complete signal to frontend (resets isSending state)
                    await output_queue.put({"type": "complete"})
                    logger.info("✅ Response complete")

                finally:
                    # Cancel interrupt monitor when receive loop finishes
                    if not monitor_task.done():
                        monitor_task.cancel()
                        try:
                            await monitor_task
                        except asyncio.CancelledError:
                            pass
                    logger.info("🧹 Interrupt monitor stopped")

            # Log when async with block exits - this is where loop should continue
            logger.info("🔄 Claude client closed, ready for next message")

    except asyncio.CancelledError:
        logger.info("🤖 Agent task: Cancelled")
        raise
    except Exception as e:
        try:
            await output_queue.put({
                "type": "error",
                "error": sanitize_error_message(e, "in agent task")
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


# API routes moved to separate files (routes_*.py)

async def marketplace_cleanup_worker():
    """
    Background worker to poll PGMQ for marketplace cleanup tasks.

    This worker runs continuously in the background and:
    1. Polls marketplace_cleanup_queue every 5 seconds
    2. Processes cleanup tasks
    3. Archives completed tasks
    4. Retries failed tasks (PGMQ handles this automatically)

    The worker uses PGMQ visibility timeout to prevent duplicate processing.
    """
    import psycopg2
    import psycopg2.extras
    from routes_marketplace import cleanup_marketplace_task

    logger.info("🚀 Marketplace cleanup worker started")

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        logger.error("❌ DATABASE_URL not configured, worker cannot start")
        return

    # Create connection pool for efficiency
    conn = None

    while True:
        try:
            # Reconnect if needed
            if conn is None or conn.closed:
                conn = psycopg2.connect(db_url)
                logger.info("✅ Connected to PostgreSQL for PGMQ worker")

            # Read message from PGMQ
            # pgmq.read(queue_name => TEXT, vt => INTEGER, qty => INTEGER)
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT * FROM pgmq.read(
                        queue_name => %s,
                        vt => %s,
                        qty => %s
                    )
                    """,
                    ("marketplace_cleanup_queue", 300, 1),  # 5 min visibility timeout
                )
                messages = cur.fetchall()

            if not messages or len(messages) == 0:
                # No messages, sleep and retry
                await asyncio.sleep(5)
                continue

            # Process first message
            message = messages[0]
            msg_id = message["msg_id"]
            message_body = message["message"]  # Already parsed as dict by RealDictCursor

            logger.info(
                f"📬 Received cleanup task (msg_id: {msg_id}): {message_body}"
            )

            # Parse message
            user_id = message_body.get("user_id")
            marketplace_name = message_body.get("marketplace_name")
            marketplace_id = message_body.get("marketplace_id")
            zip_path = message_body.get("zip_path")

            # Execute cleanup
            cleanup_result = await cleanup_marketplace_task(
                user_id, marketplace_name, marketplace_id, zip_path
            )

            if cleanup_result["success"]:
                # Archive (delete) message from queue
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT pgmq.archive(queue_name => %s, msg_id => %s)",
                        ("marketplace_cleanup_queue", msg_id),
                    )
                    conn.commit()

                logger.info(
                    f"✅ Cleanup task completed and archived (msg_id: {msg_id})"
                )
            else:
                # Let message become visible again for retry
                # PGMQ will automatically retry based on visibility timeout
                logger.warning(
                    f"⚠️  Cleanup task failed, will retry (msg_id: {msg_id})"
                )

        except Exception as e:
            logger.error(f"❌ Worker error: {e}", exc_info=True)
            # Close connection on error to force reconnect
            if conn:
                try:
                    conn.close()
                except:
                    pass
                conn = None
            await asyncio.sleep(10)  # Back off on error


async def verify_websocket_auth(websocket: WebSocket) -> tuple[bool, str]:
    """
    Verify WebSocket authentication before accepting connection.

    Returns:
        tuple: (is_valid, user_id or error_message)
    """
    # Get token from query parameters
    token = websocket.query_params.get("token")

    if not token:
        logger.warning("⚠️  WebSocket connection attempt without token")
        return False, "Missing authentication token"

    try:
        # Verify JWT token
        user_id = extract_user_id_from_token(token)
        if not user_id:
            logger.warning("⚠️  WebSocket connection attempt with invalid token")
            return False, "Invalid authentication token"

        logger.info(f"✅ WebSocket authenticated for user: {user_id}")
        return True, user_id

    except Exception as e:
        logger.error(f"❌ WebSocket auth error: {e}")
        return False, "Authentication failed"


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    audit = get_audit_service()
    client_ip = websocket.client.host if websocket.client else None

    # Extract org_id and project_id from query params for audit logging
    # These are passed from frontend when connecting WebSocket
    ws_org_id = websocket.query_params.get("org_id") or None
    ws_project_id = websocket.query_params.get("project_id") or None
    logger.info(f"📋 WebSocket query params - org_id: {ws_org_id}, project_id: {ws_project_id}")

    # Authenticate BEFORE accepting connection (prevents DoS)
    is_valid, result = await verify_websocket_auth(websocket)
    if not is_valid:
        logger.warning(f"🚫 WebSocket auth failed: {result}")
        # Log auth failure
        await audit.log_auth_failed(
            user_id=None,
            error_code="INVALID_TOKEN",
            error_message=result,
            source_ip=client_ip,
            org_id=ws_org_id
        )
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # Now safe to accept - user is authenticated
    await websocket.accept()

    # Store user_id and auth_token for session
    authenticated_user_id = result
    ws_auth_token = websocket.query_params.get("token") or ""
    ws_session_id = str(uuid.uuid4())  # Generate unique session ID for this WebSocket
    logger.info(f"📡 WebSocket accepted for user: {authenticated_user_id}")

    # Send session_id to client IMMEDIATELY so they can use it for interrupts
    # This is separate from Claude's conversation_id which comes later
    await websocket.send_json({
        "type": "session_created",
        "session_id": ws_session_id,
        "message": "WebSocket session established. Use this session_id for interrupts."
    })
    logger.info(f"📤 Sent session_created to client: {ws_session_id}")

    # Log session created with org_id and project_id from URL
    await audit.log_session_created(
        user_id=authenticated_user_id,
        session_id=ws_session_id,
        source_ip=client_ip,
        user_agent=websocket.headers.get("user-agent"),
        org_id=ws_org_id,
        project_id=ws_project_id
    )

    # Build audit hooks config for tool execution logging (with org_id/project_id)
    hooks_config = build_hooks_config(
        user_id=authenticated_user_id,
        session_id=ws_session_id,
        org_id=ws_org_id,
        project_id=ws_project_id
    )

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

            # Audit log: tool requested
            await audit.log_tool_requested(
                user_id=authenticated_user_id,
                session_id=ws_session_id,
                tool_name=tool_name,
                tool_input=input_data,
                request_id=request_id
            )

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
                    # Audit log: tool approved
                    await audit.log_tool_approved(
                        user_id=authenticated_user_id,
                        session_id=ws_session_id,
                        tool_name=tool_name,
                        request_id=request_id
                    )
                    return PermissionResultAllow()
                else:
                    logger.info("❌ Tool denied by user")
                    # Audit log: tool denied
                    await audit.log_tool_denied(
                        user_id=authenticated_user_id,
                        session_id=ws_session_id,
                        tool_name=tool_name,
                        request_id=request_id
                    )
                    return PermissionResultDeny(message="User denied permission")

        # Start all tasks
        heartbeat = asyncio.create_task(
            heartbeat_task(websocket, output_queue=output_queue, interval=30), name="heartbeat"
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
            interrupt_task(interrupt_queue, stop_events, output_queue), name="interrupt"
        )

        # Use streaming mode for continuous message handling
        agent = asyncio.create_task(
            agent_task_streaming(
                agent_queue,
                stop_events,
                output_queue,
                _my_permission_callback,
                websocket,
                hooks_config,  # Audit hooks for tool execution logging
                initial_user_id=authenticated_user_id,
                initial_auth_token=ws_auth_token,
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
        try:
            await websocket.send_json({
                "type": "error",
                "error": sanitize_error_message(e, "in WebSocket connection")
            })
        except Exception:
            pass
    finally:
        # Cancel all tasks immediately
        logger.info("🧹 Cleaning up tasks...")

        # Signal end of messages to output queue
        try:
            await output_queue.put(None)
        except Exception:
            pass

        # Get all running tasks and cancel them immediately
        all_tasks = [
            t for t in [heartbeat, router, sender, interrupt, agent] if not t.done()
        ]

        for task in all_tasks:
            if not task.done():
                task.cancel()

        # Wait for all tasks to finish with shorter timeout
        if all_tasks:
            try:
                done, pending = await asyncio.wait(
                    all_tasks, timeout=2.0, return_when=asyncio.ALL_COMPLETED
                )

                if pending:
                    logger.warning(f"⚠️ {len(pending)} tasks did not finish within timeout, force cancelling")
                    for task in pending:
                        logger.warning(f"   - {task.get_name()} still pending")
                        # Force cancel again
                        task.cancel()
                    
                    # Give one more brief chance to finish
                    try:
                        await asyncio.wait(pending, timeout=0.5)
                    except Exception:
                        pass
            except Exception as e:
                logger.error(f"Error during task cleanup: {e}")

        # Clean up stop events
        try:
            for session_id in list(stop_events.keys()):
                del stop_events[session_id]
        except Exception:
            pass

        logger.info("🧹 All tasks cleaned up")


@app.websocket("/ws/secure/chat")
async def websocket_secure_chat(websocket: WebSocket):
    """
    Zero-Trust Secure WebSocket for AI Agent.

    Every message is cryptographically signed by the device and verified.
    This prevents session hijacking and replay attacks.

    Authentication flow:
    1. Client sends signed auth message with device certificate
    2. Server verifies certificate was signed by trusted instance
    3. Every subsequent message is signed by device's private key
    4. Server verifies each message against device's public key
    """
    await websocket.accept()

    audit = get_audit_service()
    client_ip = websocket.client.host if websocket.client else None
    verifier = get_verifier()

    # Extract org_id and project_id from query params for audit logging
    ws_org_id = websocket.query_params.get("org_id") or None
    ws_project_id = websocket.query_params.get("project_id") or None
    logger.info(f"📋 Secure WebSocket query params - org_id: {ws_org_id}, project_id: {ws_project_id}")
    session = None
    session_id = None

    # Create queues for message routing
    agent_queue = asyncio.Queue(maxsize=100)
    interrupt_queue = asyncio.Queue(maxsize=10)
    permission_response_queue = asyncio.Queue(maxsize=20)
    output_queue = asyncio.Queue(maxsize=100)
    stop_events: Dict[str, asyncio.Event] = {}

    # Task references
    heartbeat = None
    router_task = None
    sender = None
    interrupt = None
    agent = None

    try:
        # Wait for authentication message
        logger.info("🔐 Waiting for Zero-Trust authentication...")
        auth_data = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=30.0  # 30 second auth timeout
        )

        if auth_data.get("type") != "authenticate":
            await audit.log_auth_failed(
                user_id=None,
                error_code="INVALID_AUTH_TYPE",
                error_message="Expected authentication message",
                source_ip=client_ip
            )
            await websocket.send_json({
                "type": "auth_error",
                "error": "Expected authentication message"
            })
            await websocket.close(code=4001)
            return

        # Verify device certificate
        cert_dict = auth_data.get("certificate")
        existing_session_id = auth_data.get("session_id")

        if not cert_dict:
            await audit.log_auth_failed(
                user_id=None,
                error_code="MISSING_CERTIFICATE",
                error_message="Missing device certificate",
                source_ip=client_ip
            )
            await websocket.send_json({
                "type": "auth_error",
                "error": "Missing device certificate"
            })
            await websocket.close(code=4002)
            return

        # Authenticate with verifier
        session, error = await verifier.authenticate(cert_dict, existing_session_id)

        if not session:
            logger.warning(f"🚫 Zero-Trust authentication failed: {error}")
            # Determine error type for audit
            error_code = "AUTH_FAILED"
            if "expired" in error.lower():
                error_code = "CERTIFICATE_EXPIRED"
            elif "invalid" in error.lower():
                error_code = "INVALID_CERTIFICATE"
            await audit.log_auth_failed(
                user_id=cert_dict.get("user_id"),
                error_code=error_code,
                error_message=error,
                source_ip=client_ip,
                metadata={"instance_id": cert_dict.get("instance_id")}
            )
            await websocket.send_json({
                "type": "auth_error",
                "error": error
            })
            await websocket.close(code=4003)
            return

        session_id = session.session_id
        logger.info(f"✅ Zero-Trust authenticated: user={session.user_id}, session={session_id}")

        # Log successful authentication with org_id/project_id from URL
        await audit.log_session_authenticated(
            user_id=session.user_id,
            session_id=session_id,
            device_cert_id=cert_dict.get("id", ""),
            instance_id=cert_dict.get("instance_id", ""),
            source_ip=client_ip,
            org_id=ws_org_id,
            project_id=ws_project_id,
            metadata={"permissions": session.permissions}
        )

        # Build audit hooks config for tool execution logging (with org_id/project_id)
        hooks_config = build_hooks_config(
            user_id=session.user_id,
            session_id=session_id,
            org_id=ws_org_id,
            project_id=ws_project_id
        )

        # Send auth success
        await websocket.send_json({
            "type": "authenticated",
            "session_id": session_id,
            "user_id": session.user_id,
            "permissions": session.permissions
        })

        # Define secure message router (verifies each message)
        async def secure_message_router():
            """Route incoming signed messages to appropriate queues after verification."""
            try:
                while True:
                    signed_message = await websocket.receive_json()

                    # Handle pong (not signed)
                    if signed_message.get("type") == "pong":
                        continue

                    # Verify signature on every message
                    is_valid, error_msg, data = verifier.verify_message(
                        signed_message, session_id
                    )

                    if not is_valid:
                        logger.warning(f"🚫 Message verification failed: {error_msg}")
                        # Audit log: signature invalid
                        error_type = EventType.SIGNATURE_INVALID
                        if "nonce" in error_msg.lower() or "replay" in error_msg.lower():
                            error_type = EventType.NONCE_REPLAY
                        await audit.log_security_event(
                            event_type=error_type,
                            user_id=session.user_id,
                            action="verify_message",
                            error_code="VERIFICATION_FAILED",
                            error_message=error_msg,
                            source_ip=client_ip,
                            session_id=session_id
                        )
                        await output_queue.put({
                            "type": "error",
                            "error": f"Message verification failed: {error_msg}"
                        })
                        continue

                    # Message is verified, route based on type
                    msg_type = signed_message.get("payload", {}).get("type", "")

                    if msg_type == "interrupt":
                        await interrupt_queue.put(data)
                    elif msg_type == "permission_response" or data.get("allow") is not None:
                        await permission_response_queue.put(data)
                    elif msg_type == "chat_message":
                        # Add session context to message
                        # NOTE: session_id here is for stop events tracking (Zero-Trust session)
                        # conversation_id (if provided by client) is for Claude conversation resume
                        data["session_id"] = session_id  # Zero-Trust session for stop events
                        data["user_id"] = session.user_id
                        # Preserve conversation_id from client for Claude resume
                        # Client can send: {"prompt": "...", "conversation_id": "abc-123"}
                        # If not provided, will start new conversation
                        await agent_queue.put(data)
                    else:
                        logger.warning(f"⚠️ Unknown message type: {msg_type}")

            except WebSocketDisconnect:
                logger.info("🔌 Secure message router: WebSocket disconnected")
            except Exception as e:
                logger.error(f"❌ Secure message router error: {e}", exc_info=True)
            finally:
                await agent_queue.put(None)
                await interrupt_queue.put(None)
                await permission_response_queue.put(None)

        # Define permission callback for secure chat
        async def secure_permission_callback(
            tool_name: str, input_data: dict, context: ToolPermissionContext
        ) -> PermissionResultAllow | PermissionResultDeny:
            """Permission callback that uses queues for secure communication."""
            request_id = str(uuid.uuid4())

            # Audit log: tool requested
            await audit.log_tool_requested(
                user_id=session.user_id,
                session_id=session_id,
                tool_name=tool_name,
                tool_input=input_data,
                request_id=request_id
            )

            await output_queue.put({
                "type": "permission_request",
                "request_id": request_id,
                "tool_name": tool_name,
                "input_data": input_data,
                "suggestions": context.suggestions,
            })

            while True:
                response = await permission_response_queue.get()
                if response is None:
                    return PermissionResultDeny(message="Connection closed")

                if response.get("request_id") != request_id:
                    await permission_response_queue.put(response)
                    await asyncio.sleep(0.01)
                    continue

                if response.get("allow") in ("y", "yes", True):
                    # Audit log: tool approved
                    await audit.log_tool_approved(
                        user_id=session.user_id,
                        session_id=session_id,
                        tool_name=tool_name,
                        request_id=request_id
                    )
                    return PermissionResultAllow()
                else:
                    # Audit log: tool denied
                    await audit.log_tool_denied(
                        user_id=session.user_id,
                        session_id=session_id,
                        tool_name=tool_name,
                        request_id=request_id
                    )
                    return PermissionResultDeny(message="User denied permission")

        # Start tasks
        heartbeat = asyncio.create_task(
            heartbeat_task(websocket, output_queue=output_queue, interval=30), name="secure_heartbeat"
        )

        router_task = asyncio.create_task(
            secure_message_router(), name="secure_router"
        )

        sender = asyncio.create_task(
            websocket_sender(websocket, output_queue), name="secure_sender"
        )

        interrupt = asyncio.create_task(
            interrupt_task(interrupt_queue, stop_events, output_queue), name="secure_interrupt"
        )

        # Use streaming mode for continuous message handling
        agent = asyncio.create_task(
            agent_task_streaming(
                agent_queue,
                stop_events,
                output_queue,
                secure_permission_callback,
                websocket,
                hooks_config,  # Audit hooks for tool execution logging
                initial_user_id=session.user_id,
                initial_auth_token=None,  # Zero-Trust uses device cert, not JWT
            ),
            name="secure_agent",
        )

        tasks = [heartbeat, router_task, sender, interrupt, agent]
        await asyncio.gather(*tasks, return_exceptions=True)

    except asyncio.TimeoutError:
        logger.warning("⏰ Zero-Trust authentication timeout")
        try:
            await websocket.send_json({
                "type": "auth_error",
                "error": "Authentication timeout"
            })
        except:
            pass
    except WebSocketDisconnect:
        logger.info("🔌 Secure WebSocket disconnected")
    except Exception as e:
        logger.error(f"❌ Secure WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "error": sanitize_error_message(e, "in secure WebSocket")
            })
        except:
            pass
    finally:
        # NOTE: Don't revoke session on disconnect to allow reconnection with same session
        # Session will expire naturally based on certificate expiry time
        # This allows:
        # 1. Reconnection with same session_id
        # 2. Nonce state preserved (replay attack prevention)
        # 3. Potential Claude conversation resume (if re-enabled)
        # 
        # For explicit logout, mobile should call a separate revoke endpoint
        if session_id:
            logger.info(f"🔐 Session {session_id} kept for potential reconnection")

        # Cleanup tasks
        try:
            await output_queue.put(None)
        except:
            pass

        all_tasks = [t for t in [heartbeat, router_task, sender, interrupt, agent] if t and not t.done()]
        for task in all_tasks:
            task.cancel()

        if all_tasks:
            await asyncio.wait(all_tasks, timeout=2.0)

        logger.info("🧹 Secure WebSocket cleanup complete")


if __name__ == "__main__":
    import os

    import uvicorn

    # Initialize Zero-Trust verifier with backend URL
    backend_url = os.getenv("SLAR_BACKEND_URL", "")
    if backend_url:
        init_verifier(backend_url)
        logger.info(f"✅ Zero-Trust verifier initialized with backend: {backend_url}")
    else:
        logger.warning("⚠️ SLAR_BACKEND_URL not set, Zero-Trust features limited")

    # Disable auto-reload in production to prevent sync issues
    # Auto-reload can cause server restarts during file operations (like sync)
    # which leads to background tasks hanging
    reload_enabled = os.getenv("DEV_MODE", "false").lower() == "true"

    uvicorn.run(
        "claude_agent_api_v1:app", host="0.0.0.0", port=8002, reload=reload_enabled
    )
