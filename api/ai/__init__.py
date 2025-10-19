"""
SLAR AI - Smart Live Alert & Response AI Agent

This package provides AI-powered incident response and management capabilities.

Main Components:
- config: Centralized application configuration
- core: Core business logic (agents, sessions, tools)
- models: Data models and schemas
- routes: API route handlers
- utils: Utility functions and helpers
- terminal: Standalone terminal server

Usage:
    As a module:
        python -m api.ai.main

    Directly:
        python api/ai/main.py

    With uvicorn:
        uvicorn api.ai.main:app --host 0.0.0.0 --port 8002
"""

# Version information
__version__ = "1.0.0"
__author__ = "SLAR Team"

# Export main components for external use
from .config import Settings, get_settings
from .core import (
    SLARAgentManager,
    SessionManager,
    ToolManager,
)
from .models import (
    IncidentRunbookRequest,
    RunbookRetrievalResponse,
    GitHubIndexRequest,
    GitHubIndexResponse,
)

__all__ = [
    # Version
    "__version__",
    "__author__",
    # Config
    "Settings",
    "get_settings",
    # Core managers
    "SLARAgentManager",
    "SessionManager",
    "ToolManager",
    # Models
    "IncidentRunbookRequest",
    "RunbookRetrievalResponse",
    "GitHubIndexRequest",
    "GitHubIndexResponse",
]
