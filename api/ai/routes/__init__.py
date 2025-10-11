"""
Routes initialization.
"""

try:
    # Try relative import first (works when used as package)
    from .health import router as health_router
    from .sessions import router as sessions_router
    from .runbook import router as runbook_router
    from .websocket import router as websocket_router
except ImportError:
    # Fallback to absolute import (works with python main.py)
    from health import router as health_router
    from sessions import router as sessions_router
    from runbook import router as runbook_router
    from websocket import router as websocket_router

__all__ = ["health_router", "sessions_router", "runbook_router", "websocket_router"]
