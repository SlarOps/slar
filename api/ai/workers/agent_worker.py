"""
AutoGen agent worker for background task processing.
Following AutoGen SingleThreadedAgentRuntime pattern with ClosureAgent for output collection.

Based on AutoGen documentation:
- https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/framework/agent-and-agent-runtime.ipynb
- https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/design-patterns/concurrent-agents.ipynb
- https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/cookbook/extracting-results-with-an-agent.ipynb
"""

import asyncio
import logging
from typing import Dict

from autogen_agentchat.messages import TextMessage
from autogen_agentchat.base import TaskResult
from autogen_core import CancellationToken

from core.messages import AgentOutput, UserInput, UserInputRequest
from core.queue_manager import SessionQueueManager
from core.session import AutoGenChatSession, SessionManager

logger = logging.getLogger(__name__)


class AgentWorker:
    """
    Agent worker that processes messages from input queue and publishes to output queue.
    Runs in background asyncio task following AutoGen SingleThreadedAgentRuntime pattern.
    """

    def __init__(
        self,
        queue_manager: SessionQueueManager,
        session_manager: SessionManager,
    ):
        self.queue_manager = queue_manager
        self.session_manager = session_manager
        self._worker_tasks: Dict[str, asyncio.Task] = {}
        self._shutdown = False
        logger.info("AgentWorker initialized")

    async def start_session_worker(self, session_id: str) -> None:
        """
        Start a background worker for a session.
        Following AutoGen pattern: runtime.start() runs in background.
        """
        if session_id in self._worker_tasks:
            logger.warning(f"Worker already running for session: {session_id}")
            return

        task = asyncio.create_task(self._process_session(session_id))
        self._worker_tasks[session_id] = task
        logger.info(f"Started worker for session: {session_id}")

    async def _process_session(self, session_id: str) -> None:
        """
        Process messages for a session.
        Following AutoGen pattern: continuously process messages from queue.
        """
        try:
            # Get or create chat session
            chat_session = await self.session_manager.get_or_create_session(session_id)

            # Create user input function for the team
            # This will wait for messages from the input queue
            async def _user_input(prompt: str, cancellation_token: CancellationToken | None) -> str:
                # Publish user input request to output queue
                await self.queue_manager.publish_output(
                    session_id,
                    AgentOutput(
                        session_id=session_id,
                        content=prompt,
                        source="system",
                        message_type="UserInputRequestedEvent",
                    ),
                )

                # Wait for user response from input queue
                async for message in self.queue_manager.subscribe_input(session_id):
                    if message.content.strip():
                        return message.content.strip()

            # User approval function (similar pattern)
            async def _user_approval(request) -> any:
                # For now, auto-approve (can be enhanced later)
                from autogen_agentchat.agents import ApprovalResponse

                return ApprovalResponse(approved=True, reason="Auto-approved")

            # Get or create the team
            team = await chat_session.get_or_create_team(_user_input, _user_approval)

            # Process input messages
            async for user_message in self.queue_manager.subscribe_input(session_id):
                try:
                    logger.info(f"Processing message for session {session_id}: {user_message.content[:50]}")

                    # Append to history
                    chat_session.append_to_history(
                        {"content": user_message.content, "source": user_message.source, "type": "TextMessage"}
                    )

                    # Smart reset team if needed
                    reset_success = await chat_session.smart_reset_team(force_reset=False)
                    if not reset_success:
                        team = await chat_session.get_or_create_team(_user_input, _user_approval)

                    # Set current task
                    chat_session.current_task = user_message.content

                    # Create task message
                    task_message = TextMessage(content=user_message.content, source=user_message.source)

                    # Run the stream
                    try:
                        stream = await chat_session.safe_run_stream(task=task_message)
                    except RuntimeError as e:
                        if "need to recreate" in str(e) or "needs recreation" in str(e):
                            logger.info(f"Recreating team for session {session_id}")
                            team = await chat_session.get_or_create_team(_user_input, _user_approval)
                            stream = await chat_session.safe_run_stream(task=task_message)
                        else:
                            raise e

                    # Process stream messages and publish to output queue
                    # Following AutoGen pattern: iterate over stream and collect results
                    async for message in stream:
                        if isinstance(message, TaskResult):
                            continue

                        if hasattr(message, "source") and message.source == "user":
                            continue

                        # Publish message to output queue
                        # Following AutoGen ClosureAgent pattern
                        await self.queue_manager.publish_output(
                            session_id,
                            AgentOutput(
                                session_id=session_id,
                                content=message.content if hasattr(message, "content") else str(message),
                                source=message.source if hasattr(message, "source") else "agent",
                                message_type=message.__class__.__name__,
                                metadata={"raw_message": message.model_dump() if hasattr(message, "model_dump") else {}},
                            ),
                        )

                        # Append to history (except streaming chunks)
                        from autogen_agentchat.messages import ModelClientStreamingChunkEvent

                        if not isinstance(message, ModelClientStreamingChunkEvent):
                            chat_session.append_to_history(message.model_dump() if hasattr(message, "model_dump") else {})

                    # Save state and history after stream completes
                    await chat_session.save_state()
                    await chat_session.save_history()
                    logger.debug(f"Saved session state and history: {session_id}")

                except Exception as e:
                    logger.error(f"Error processing message for session {session_id}: {e}", exc_info=True)

                    # Send error to output queue
                    await self.queue_manager.publish_output(
                        session_id,
                        AgentOutput(
                            session_id=session_id,
                            content=f"Error: {str(e)}",
                            source="system",
                            message_type="error",
                        ),
                    )

        except asyncio.CancelledError:
            logger.info(f"Worker cancelled for session: {session_id}")

        except Exception as e:
            logger.error(f"Fatal error in worker for session {session_id}: {e}", exc_info=True)

        finally:
            # Cleanup
            if session_id in self._worker_tasks:
                del self._worker_tasks[session_id]
            logger.info(f"Worker stopped for session: {session_id}")

    async def stop_session_worker(self, session_id: str) -> None:
        """Stop worker for a session."""
        if session_id in self._worker_tasks:
            task = self._worker_tasks[session_id]
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            logger.info(f"Stopped worker for session: {session_id}")

    async def stop_all_workers(self) -> None:
        """Stop all workers."""
        self._shutdown = True
        tasks = list(self._worker_tasks.values())
        for task in tasks:
            task.cancel()

        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("All workers stopped")

    def get_active_workers(self) -> list[str]:
        """Get list of active worker session IDs."""
        return list(self._worker_tasks.keys())
