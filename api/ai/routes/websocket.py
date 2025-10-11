"""
WebSocket routes for real-time chat functionality.
"""

import os
import logging
import requests
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.encoders import jsonable_encoder

from autogen_agentchat.messages import TextMessage, UserInputRequestedEvent, MemoryQueryEvent, ModelClientStreamingChunkEvent
from autogen_agentchat.base import TaskResult
from autogen_agentchat.agents import ApprovalRequest, ApprovalResponse
from autogen_core import CancellationToken

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/chat")
async def chat(websocket: WebSocket):
    """WebSocket endpoint for real-time chat with AutoGen agents."""
    # make a request to api to verify token
    # if failed, raise 401
    API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080")
    token = websocket.query_params.get("token")
    response = requests.get(f"{API_BASE_URL}/verify-token", headers={"Authorization": f"Bearer {token}"})
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Unauthorized")
    else:
        await websocket.accept()
    
    # Generate or get session ID
    session_id = websocket.query_params.get("session_id") or f"session_{datetime.now().timestamp()}"
    
    # Get or create chat session with disk loading
    try:
        from ..main import session_manager
    except ImportError:
        from main import session_manager
    chat_session = await session_manager.get_or_create_session(session_id)
    
    # Create cancellation token for this WebSocket connection (not the entire session)
    connection_cancellation_token = CancellationToken()

    # User input function used by the team.
    async def _user_input(prompt: str, cancellation_token: CancellationToken | None) -> str:
        # Wait until we receive a non-empty TextMessage from the client.
        print("user input requested")
        while True:
            try:
                # Check if connection is cancelled
                # if connection_cancellation_token.is_cancelled:
                #     raise RuntimeError("Connection cancelled due to WebSocket disconnect")
                    
                data = await websocket.receive_json()
                message = TextMessage.model_validate(data)
                chat_session.append_to_history(message.model_dump())
            except WebSocketDisconnect:
                logger.info("Client disconnected while waiting for user input")
                connection_cancellation_token.cancel()
                raise RuntimeError("Client disconnected") from None

            # Try to validate as TextMessage; ignore other event types
            try:
                message = TextMessage.model_validate(data)
            except Exception:
                # Not a TextMessage; ignore and keep waiting
                continue

            content = (message.content or "").strip()
            if content:
                return content
            # Ignore empty messages and keep waiting
    
    async def _user_approval(request: ApprovalRequest) -> ApprovalResponse:
        # Send approval request to client
        print("approval requested")
        while True:
            try:
                # Check if connection is cancelled
                # if connection_cancellation_token.is_cancelled:
                #     raise RuntimeError("Connection cancelled due to WebSocket disconnect")
                    
                await websocket.send_json(jsonable_encoder({
                    "type": "TextMessage",
                    "content": f"Code execution approval requested:\n{request.code}\nDo you want to execute this code? (y/n): ",
                    "source": "system"
                }))

                data = await websocket.receive_json()
                message = TextMessage.model_validate(data)
                
                chat_session.append_to_history(message.model_dump())

                content = (message.content or "").strip()
                if content in ['y', 'yes']:
                    return ApprovalResponse(approved=True, reason='Approved by user')
                elif content in ['n', 'no']:
                    return ApprovalResponse(approved=False, reason='Denied by user')
                else:
                    await websocket.send_json(jsonable_encoder({
                        "type": "UserInputRequestedEvent",
                        "content": "Please enter 'y' for yes or 'n' for no.",
                        "source": "system"
                    }))

            except WebSocketDisconnect:
                logger.info("Client disconnected while waiting for approval")
                connection_cancellation_token.cancel()
                raise RuntimeError("Client disconnected") from None

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except Exception as e:
                await websocket.send_json(jsonable_encoder({
                    "type": "error",
                    "source": "system",
                    "content": f"Invalid JSON for first message. Please send a JSON object. Error: {str(e)}",
                    "example": {"content": "hi", "source": "user", "type": "TextMessage"}
                }))
                continue
            request = TextMessage.model_validate(data)

            chat_session.append_to_history(request.model_dump())
            
            try:
                # Get team and load history (AutoGen pattern)
                team = await chat_session.get_or_create_team(_user_input, _user_approval)
                history = await chat_session.get_history()  # Load history BEFORE stream
                
                # Smart reset team if needed (only when necessary)
                reset_success = await chat_session.smart_reset_team(force_reset=False)
                if not reset_success:
                    # If reset failed, recreate the team
                    team = await chat_session.get_or_create_team(_user_input, _user_approval)
                
                # Always start with new task following AutoGen patterns
                logger.info(f"Starting new stream for session {session_id} with {len(history)} historical messages")
                chat_session.current_task = request.content
                
                try:
                    stream = await chat_session.safe_run_stream(task=request)
                except RuntimeError as e:
                    if "need to recreate" in str(e) or "needs recreation" in str(e):
                        # Recreate team and try again
                        logger.info(f"Recreating team for session {session_id}")
                        team = await chat_session.get_or_create_team(_user_input, _user_approval)
                        stream = await chat_session.safe_run_stream(task=request)
                    else:
                        raise e
                
                # Process stream messages (AutoGen pattern)
                async for message in stream:
                    if isinstance(message, TaskResult):
                        continue
                    if message.source == "user":
                        continue
                        
                    # Send message to client
                    if isinstance(message, MemoryQueryEvent):
                        await websocket.send_json(jsonable_encoder(message.model_dump()))
                    else:
                        await websocket.send_json(jsonable_encoder(message.model_dump()))
                    
                    # Append to history (AutoGen pattern)
                    if not isinstance(message, ModelClientStreamingChunkEvent):
                        # Don't save user input events to history
                        chat_session.append_to_history(message.model_dump())
                    
                    print(10*"==")
                    print(message.model_dump())

                # Save state and history after stream completes (AutoGen pattern)
                await chat_session.save_state()
                await chat_session.save_history()
                logger.debug(f"Saved session state and history after interaction: {session_id}")
                    
            except WebSocketDisconnect:
                # Client disconnected during message processing - exit gracefully
                logger.info("Client disconnected during message processing")
                connection_cancellation_token.cancel()
                break
            except Exception as e:
                # Send error message to client
                error_message = {
                    "type": "error",
                    "content": f"Error: {str(e)}",
                    "source": "system"
                }
                try:
                    await websocket.send_json(jsonable_encoder(error_message))
                    # Re-enable input after error
                    await websocket.send_json(jsonable_encoder({
                        "type": "UserInputRequestedEvent",
                        "content": "An error occurred. Please try again.",
                        "source": "system"
                    }))
                except WebSocketDisconnect:
                    # Client disconnected while sending error - exit gracefully
                    logger.info("Client disconnected while sending error message")
                    break
                except Exception as send_error:
                    logger.error(f"Failed to send error message: {str(send_error)}")
                    break

    except WebSocketDisconnect:
        logger.info("Client disconnected")
        connection_cancellation_token.cancel()
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        try:
            await websocket.send_json(jsonable_encoder({
                "type": "error",
                "content": f"Unexpected error: {str(e)}",
                "source": "system"
            }))
        except WebSocketDisconnect:
            # Client already disconnected - no need to send
            logger.info("Client disconnected before error could be sent")
        except Exception:
            # Failed to send error message - connection likely broken
            logger.error("Failed to send error message to client")
            pass
    finally:
        # Always save session state before disconnection
        # Following AutoGen state persistence patterns
        try:
            if chat_session:
                chat_session.is_streaming = False
                await chat_session.save_state()
                logger.info(f"Final state save completed for session: {session_id}")
        except Exception as e:
            logger.error(f"Failed to save final session state: {e}")
