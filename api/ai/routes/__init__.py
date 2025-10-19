"""
Routes module for SLAR AI API.

This module contains all API route handlers for the main application.
Note: Terminal routes are handled by a standalone terminal server
(terminal/terminal_server.py) and should not be imported here.
"""

from .health import router as health_router
from .sessions import router as sessions_router
from .runbook import router as runbook_router
from .websocket import router as websocket_router

__all__ = [
    "health_router",
    "sessions_router",
    "runbook_router",
    "websocket_router",
]
