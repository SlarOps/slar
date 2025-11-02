from fastapi import FastAPI, WebSocket, WebSocketDisconnect
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
from typing import Dict, Optional

from incident_tools import create_incident_tools_server, set_auth_token

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
    websocket: WebSocket,
    permission_callback
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

            # Set the auth token for incident_tools to use
            set_auth_token(current_auth_token or "")

            # Create MCP server with all incident tools
            incident_tools_server = create_incident_tools_server()

            options = ClaudeAgentOptions(
                can_use_tool=permission_callback,
                permission_mode="default",
                cwd=".",
                model="sonnet",
                resume=session_id,
                mcp_servers={"incident_tools": incident_tools_server},
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
                            await websocket.send_json({
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
                                await websocket.send_json({
                                    "type": "thinking",
                                    "content": block.thinking
                                })
                            elif isinstance(block, TextBlock):
                                await websocket.send_json({
                                    "type": "text",
                                    "content": block.text
                                })
                            elif isinstance(block, ToolResultBlock):
                                await websocket.send_json({
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

                                await websocket.send_json({
                                    "type": "session_init",
                                    "session_id": session_id
                                })

                    if isinstance(message, ResultMessage):
                        await websocket.send_json({
                            "type": message.subtype,
                            "result": message.result
                        })

    except asyncio.CancelledError:
        logger.info("🤖 Agent task: Cancelled")
        raise
    except Exception as e:
        logger.error(f"❌ Agent task error: {e}", exc_info=True)
        try:
            await websocket.send_json({
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


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()

    # Create separate queues with size limits
    agent_queue = asyncio.Queue(maxsize=100)
    interrupt_queue = asyncio.Queue(maxsize=10)
    permission_response_queue = asyncio.Queue(maxsize=20)

    # Shared stop events dictionary (per session) - using asyncio.Event for thread safety
    stop_events: Dict[str, asyncio.Event] = {}

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
            Instead, it sends request and waits for response from queue.
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

            # Send permission request with unique ID
            await websocket.send_json({
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

        interrupt = asyncio.create_task(
            interrupt_task(interrupt_queue, stop_events, websocket),
            name="interrupt"
        )

        agent = asyncio.create_task(
            agent_task(agent_queue, stop_events, websocket, _my_permission_callback),
            name="agent"
        )

        # Wait for ALL tasks to complete
        tasks = [heartbeat, router, interrupt, agent]
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

        # Get all running tasks
        all_tasks = [t for t in [heartbeat, router, interrupt, agent] if not t.done()]

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
