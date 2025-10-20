"""
Message types for AutoGen runtime communication.
Following AutoGen best practices for message-based communication.
"""

from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class UserInput:
    """Message from user to agent team."""
    session_id: str
    content: str
    source: str = "user"


@dataclass
class AgentOutput:
    """Message from agent team to user."""
    session_id: str
    content: str
    source: str
    message_type: str  # "TextMessage", "UserInputRequestedEvent", "error", etc.
    metadata: Dict[str, Any] | None = None


@dataclass
class UserInputRequest:
    """Agent requests input from user."""
    session_id: str
    prompt: str


@dataclass
class SessionControl:
    """Control messages for session management."""
    session_id: str
    action: str  # "start", "stop", "reset"
