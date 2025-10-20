"""
Queue manager for session-based communication.
Following AutoGen pattern: using asyncio.Queue for in-memory message passing.
Based on: https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/design-patterns/concurrent-agents.ipynb
"""

import asyncio
import logging
from typing import Dict

from .messages import AgentOutput, UserInput

logger = logging.getLogger(__name__)


class SessionQueueManager:
    """
    Manages asyncio.Queue instances for each session.
    Following AutoGen ClosureAgent pattern for collecting results.
    """

    def __init__(self):
        # Input queues: WebSocket -> Agent
        self._input_queues: Dict[str, asyncio.Queue[UserInput]] = {}

        # Output queues: Agent -> WebSocket
        self._output_queues: Dict[str, asyncio.Queue[AgentOutput]] = {}

        logger.info("SessionQueueManager initialized")

    def get_input_queue(self, session_id: str) -> asyncio.Queue[UserInput]:
        """Get or create input queue for session."""
        if session_id not in self._input_queues:
            self._input_queues[session_id] = asyncio.Queue()
            logger.debug(f"Created input queue for session: {session_id}")
        return self._input_queues[session_id]

    def get_output_queue(self, session_id: str) -> asyncio.Queue[AgentOutput]:
        """Get or create output queue for session."""
        if session_id not in self._output_queues:
            self._output_queues[session_id] = asyncio.Queue()
            logger.debug(f"Created output queue for session: {session_id}")
        return self._output_queues[session_id]

    async def publish_input(self, session_id: str, message: UserInput) -> None:
        """
        Publish user input to the input queue.
        Following AutoGen pattern: runtime.publish_message()
        """
        queue = self.get_input_queue(session_id)
        await queue.put(message)
        logger.debug(f"Published input to session {session_id}: {message.content[:50]}")

    async def publish_output(self, session_id: str, message: AgentOutput) -> None:
        """
        Publish agent output to the output queue.
        Following AutoGen ClosureAgent pattern for collecting results.
        """
        queue = self.get_output_queue(session_id)
        await queue.put(message)
        logger.debug(f"Published output from session {session_id}: {message.source}")

    async def subscribe_output(self, session_id: str):
        """
        Subscribe to output queue for a session.
        Following AutoGen pattern: async iteration over queue.
        Yields messages as they arrive.
        """
        queue = self.get_output_queue(session_id)
        while True:
            try:
                message = await queue.get()
                yield message
            except asyncio.CancelledError:
                logger.info(f"Output subscription cancelled for session: {session_id}")
                break
            except Exception as e:
                logger.error(f"Error in output subscription for session {session_id}: {e}")
                break

    async def subscribe_input(self, session_id: str):
        """
        Subscribe to input queue for a session.
        Following AutoGen pattern: async iteration over queue.
        Used by agent worker to receive user messages.
        """
        queue = self.get_input_queue(session_id)
        while True:
            try:
                message = await queue.get()
                yield message
            except asyncio.CancelledError:
                logger.info(f"Input subscription cancelled for session: {session_id}")
                break
            except Exception as e:
                logger.error(f"Error in input subscription for session {session_id}: {e}")
                break

    def cleanup_session(self, session_id: str) -> None:
        """Clean up queues for a session."""
        if session_id in self._input_queues:
            del self._input_queues[session_id]
            logger.debug(f"Cleaned up input queue for session: {session_id}")

        if session_id in self._output_queues:
            del self._output_queues[session_id]
            logger.debug(f"Cleaned up output queue for session: {session_id}")

    def get_active_sessions(self) -> list[str]:
        """Get list of active session IDs."""
        # Sessions with both input and output queues
        return list(set(self._input_queues.keys()) | set(self._output_queues.keys()))
