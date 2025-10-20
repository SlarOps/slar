"""
WebSocket routes using queue-based architecture.
Following AutoGen pattern: WebSocket acts as bridge between browser and queue.

Based on AutoGen documentation:
- Decouples WebSocket connection from agent execution
- Allows reconnection without losing state
- Enables background task processing
"""

import logging
import requests
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.encoders import jsonable_encoder

from autogen_agentchat.messages import TextMessage

from core.messages import UserInput, AgentOutput
from core.queue_manager import SessionQueueManager
from workers.agent_worker import AgentWorker

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/chat/queue")
async def chat_with_queue(websocket: WebSocket):
    """
    WebSocket endpoint using queue-based architecture.
    Following AutoGen pattern: WebSocket ↔ Queue ↔ Agent Worker

    Flow:
    1. WebSocket receives user message
    2. Publishes to input queue
    3. Agent worker processes from input queue
    4. Agent worker publishes to output queue
    5. WebSocket subscribes to output queue and sends to browser
    """
    import os
    # Verify token
    API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080")
    token = websocket.query_params.get("token")
    response = requests.get(f"{API_BASE_URL}/verify-token", headers={"Authorization": f"Bearer {token}"})
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Unauthorized")

    await websocket.accept()

    # Get or generate session ID
    session_id = websocket.query_params.get("session_id") or f"session_{int(datetime.now().timestamp() * 1000)}"

    # Get queue manager and agent worker from app state
    try:
        from main import queue_manager, agent_worker
    except ImportError:
        # Try alternative import path
        import sys
        import os
        current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        from main import queue_manager, agent_worker

    # Start agent worker for this session if not already running
    await agent_worker.start_session_worker(session_id)

    logger.info(f"WebSocket connected for session: {session_id}")

    # Create task to forward messages from output queue to WebSocket
    import asyncio

    async def forward_agent_outputs():
        """
        Forward messages from agent output queue to WebSocket.
        Following AutoGen pattern: subscribe to queue and stream to client.
        """
        try:
            async for agent_message in queue_manager.subscribe_output(session_id):
                try:
                    # Convert AgentOutput to WebSocket message
                    ws_message = {
                        "type": agent_message.message_type,
                        "content": agent_message.content,
                        "source": agent_message.source,
                    }

                    # Add metadata if present
                    if agent_message.metadata:
                        ws_message.update(agent_message.metadata.get("raw_message", {}))

                    await websocket.send_json(jsonable_encoder(ws_message))
                    logger.debug(f"Sent message to WebSocket for session {session_id}: {agent_message.message_type}")

                except WebSocketDisconnect:
                    logger.info(f"WebSocket disconnected while sending for session: {session_id}")
                    break
                except Exception as e:
                    logger.error(f"Error sending message to WebSocket: {e}")
                    break

        except asyncio.CancelledError:
            logger.info(f"Output forwarding cancelled for session: {session_id}")
        except Exception as e:
            logger.error(f"Error in output forwarding for session {session_id}: {e}")

    # Start forwarding task
    forward_task = asyncio.create_task(forward_agent_outputs())

    try:
        # Main WebSocket loop: receive user messages and publish to input queue
        while True:
            try:
                # Receive message from WebSocket
                data = await websocket.receive_json()

                # Validate as TextMessage
                try:
                    message = TextMessage.model_validate(data)
                except Exception as e:
                    await websocket.send_json(
                        jsonable_encoder(
                            {
                                "type": "error",
                                "source": "system",
                                "content": f"Invalid message format. Error: {str(e)}",
                            }
                        )
                    )
                    continue

                # Publish to input queue
                # Following AutoGen pattern: publish_message to queue
                user_input = UserInput(session_id=session_id, content=message.content, source=message.source)

                await queue_manager.publish_input(session_id, user_input)
                logger.debug(f"Published user input to queue for session {session_id}: {message.content[:50]}")

            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for session: {session_id}")
                break
            except Exception as e:
                logger.error(f"Error in WebSocket receive loop: {e}")
                try:
                    await websocket.send_json(
                        jsonable_encoder({"type": "error", "content": f"Error: {str(e)}", "source": "system"})
                    )
                except:
                    pass
                break

    finally:
        # Cancel forwarding task
        forward_task.cancel()
        try:
            await forward_task
        except asyncio.CancelledError:
            pass

        logger.info(f"WebSocket handler cleanup completed for session: {session_id}")

        # Note: We don't stop the agent worker here because:
        # 1. User might reconnect
        # 2. Agent might still be processing
        # 3. Worker will be cleaned up by session timeout
