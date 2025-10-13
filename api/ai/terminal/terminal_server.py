#!/usr/bin/env python3
"""
Standalone Terminal Server
Provides a web-based terminal interface through xterm.js via WebSocket.
Runs independently from the main API server.

Keyboard Shortcuts:
------------------
Server Control:
- Ctrl+C (first press)  : Show exit warning (press again to confirm)
- Ctrl+C (second press) : Exit application (within 2 seconds)
- SIGTERM               : Immediate graceful shutdown

Terminal Interaction:
- All standard terminal keybindings work through the web interface
- Terminal resize is handled automatically via WebSocket messages
"""

import asyncio
import logging
import os
import signal
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Ensure current directory is in Python path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

try:
    from .terminal import TerminalManager
except ImportError:
    from terminal import TerminalManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global terminal manager
terminal_manager = TerminalManager()
shutdown_event = asyncio.Event()
_shutdown_requested = False
_last_sigint_time = None
_sigint_timeout = 2.0  # seconds to wait for double Ctrl+C


async def graceful_shutdown():
    """Handle graceful shutdown of all terminal sessions."""
    global _shutdown_requested
    if _shutdown_requested:
        return
    _shutdown_requested = True
    
    logger.info("Starting graceful shutdown...")
    try:
        await terminal_manager.cleanup_all()
        logger.info("All terminal sessions cleaned up")
    except Exception as e:
        logger.error(f"Error during graceful shutdown: {e}")
    
    shutdown_event.set()


def signal_handler(signum, frame):
    """Handle shutdown signals with double Ctrl+C confirmation."""
    global _last_sigint_time
    
    signal_name = signal.Signals(signum).name
    
    # For SIGTERM, shutdown immediately
    if signum == signal.SIGTERM:
        logger.info(f"Received {signal_name} signal, initiating graceful shutdown...")
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(graceful_shutdown())
        except RuntimeError:
            logger.warning("No running event loop, exiting immediately...")
            sys.exit(0)
        return
    
    # For SIGINT (Ctrl+C), require double press
    if signum == signal.SIGINT:
        current_time = time.time()
        
        # Check if this is a double Ctrl+C
        if _last_sigint_time and (current_time - _last_sigint_time) < _sigint_timeout:
            logger.info(f"Received second {signal_name}, initiating graceful shutdown...")
            _last_sigint_time = None  # Reset
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(graceful_shutdown())
            except RuntimeError:
                logger.warning("No running event loop, exiting immediately...")
                sys.exit(0)
        else:
            # First Ctrl+C
            logger.info(f"⚠️  Press Ctrl+C again within {_sigint_timeout}s to exit")
            _last_sigint_time = current_time


# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("🚀 Terminal Server starting...")
    yield
    
    logger.info("🔄 Terminal Server shutting down...")
    if not shutdown_event.is_set():
        await graceful_shutdown()
    
    try:
        # Aggressive timeout - cleanup should be fast now
        await asyncio.wait_for(shutdown_event.wait(), timeout=5.0)
        logger.info("✅ Graceful shutdown completed")
    except asyncio.TimeoutError:
        logger.warning("⚠️  Graceful shutdown timeout - exiting anyway")


# Create FastAPI app
app = FastAPI(
    title="Terminal Server",
    description="Standalone terminal service with WebSocket support",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "terminal-server",
        "active_sessions": len(terminal_manager.sessions)
    }


@app.websocket("/ws/terminal/{session_id}")
async def terminal_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for terminal connections.
    
    Args:
        session_id: Unique identifier for the terminal session
    """
    await websocket.accept()
    logger.info(f"Terminal WebSocket connection accepted for session {session_id}")
    
    # Get shell command from query params (optional)
    shell_cmd = websocket.query_params.get("shell_cmd")
    
    try:
        # Create and manage terminal session
        await terminal_manager.create_session(
            session_id=session_id,
            websocket=websocket,
            shell_cmd=shell_cmd
        )
    except WebSocketDisconnect:
        logger.info(f"Terminal WebSocket disconnected for session {session_id}")
    except Exception as e:
        logger.error(f"Error in terminal WebSocket for session {session_id}: {e}")
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception:
            pass


@app.get("/sessions")
async def list_sessions():
    """List all active terminal sessions."""
    sessions = [
        {
            "session_id": session_id,
            "has_process": session.process is not None,
            "process_pid": session.process.pid if session.process else None
        }
        for session_id, session in terminal_manager.sessions.items()
    ]
    return {
        "count": len(sessions),
        "sessions": sessions
    }


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a specific terminal session."""
    if session_id not in terminal_manager.sessions:
        return {"error": "Session not found"}, 404
    
    await terminal_manager.cleanup_session(session_id)
    return {"message": f"Session {session_id} deleted"}


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("TERMINAL_PORT", 8003))
    host = os.getenv("TERMINAL_HOST", "0.0.0.0")
    
    logger.info(f"Starting Terminal Server on {host}:{port}")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )

