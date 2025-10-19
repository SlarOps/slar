"""
Core module for SLAR AI agent management.

This module contains the core business logic for SLAR agents:
- Agent management and configuration
- Session management and persistence
- Tool management and MCP integration
"""

from .agent import SLARAgentManager
from .session import SessionManager, AutoGenChatSession, DateTimeJSONEncoder
from .tools import ToolManager, MCPServerConfig

__all__ = [
    # Agent management
    "SLARAgentManager",
    # Session management
    "SessionManager",
    "AutoGenChatSession",
    "DateTimeJSONEncoder",
    # Tool management
    "ToolManager",
    "MCPServerConfig",
]
