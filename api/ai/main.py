"""
Main FastAPI application entry point.

This is the single entry point for the SLAR AI API application.
All functionality is organized into modular components:
- config: Application configuration and settings
- core: Core business logic (agents, sessions, tools)
- models: Data models and schemas
- routes: API route handlers
- utils: Utility functions and helpers
"""

import logging
import os
import sys
import signal
import asyncio
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure current directory is in Python path for imports
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# Import modular components
from config import get_settings, setup_logging
from core import SLARAgentManager, SessionManager

# Get application settings
settings = get_settings()

# Configure logging early in the application startup
setup_logging(settings.log_level)
from routes import health_router, sessions_router, runbook_router, websocket_router

logger = logging.getLogger(__name__)

# Initialize managers with settings
slar_agent_manager = SLARAgentManager(settings=settings)
session_manager = SessionManager(settings.data_store)

# Initialize queue-based architecture (Following AutoGen pattern)
# Based on: https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/design-patterns/concurrent-agents.ipynb

# Legacy compatibility - keep rag_memory for existing code
rag_memory = slar_agent_manager.get_rag_memory()

# Global shutdown event
shutdown_event = asyncio.Event()
_shutdown_requested = False
_main_loop = None

async def graceful_shutdown():
    """Handle graceful shutdown by saving all active sessions."""
    global _shutdown_requested
    if _shutdown_requested:
        return  # Already shutting down
    _shutdown_requested = True
    
    print("🔄 Starting graceful shutdown...")
    logger.info("Starting graceful shutdown...")
    
    try:
        # Use session manager's shutdown method
        await session_manager.shutdown()
        print("✅ All sessions saved successfully")
        logger.info("All sessions saved successfully")
            
    except Exception as e:
        print(f"❌ Error during graceful shutdown: {str(e)}")
        logger.error(f"Error during graceful shutdown: {str(e)}")
    
    # Set shutdown event
    shutdown_event.set()

def signal_handler(signum, frame):
    """Handle shutdown signals."""
    signal_name = signal.Signals(signum).name
    print(f"🔔 Received {signal_name} signal, initiating graceful shutdown...")
    logger.info(f"Received {signal_name} signal, initiating graceful shutdown...")
    
    # Use thread-safe call to schedule coroutine
    def schedule_shutdown():
        if _main_loop and not _main_loop.is_closed():
            # Schedule graceful shutdown
            future = asyncio.run_coroutine_threadsafe(graceful_shutdown(), _main_loop)
            
            # Wait for shutdown with timeout
            try:
                future.result(timeout=30.0)
                print("🚪 Graceful shutdown completed, exiting...")
            except Exception as e:
                print(f"⚠️  Graceful shutdown failed: {e}, forcing exit...")
            finally:
                os._exit(0)
        else:
            print("🚪 No event loop available, exiting immediately...")
            os._exit(0)
    
    # Run shutdown in a separate thread to avoid blocking signal handler
    shutdown_thread = threading.Thread(target=schedule_shutdown, daemon=True)
    shutdown_thread.start()

# Register signal handlers
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown tasks."""
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    
    # Startup: Initialize ChromaDB memory
    print("🚀 Starting vector store initialization...")
    logger.info("Starting vector store initialization...")
    try:
        # Lightweight Chroma connectivity check (no OpenAI model call needed)
        import chromadb
        client = chromadb.PersistentClient(path=settings.chromadb_path)
        client.get_or_create_collection(name=settings.chroma_collection_name)
        logger.info("Vector store connectivity verified")
    except Exception as e:
        print(f"❌ Vector store connectivity check failed: {str(e)}")
        logger.error(f"Vector store connectivity check failed: {str(e)}")
        # Don't fail startup, but log the error

    # Initial session cleanup
    try:
        await session_manager.cleanup_old_sessions()
        logger.info("Initial session cleanup completed")
    except Exception as e:
        logger.error(f"Failed initial session cleanup: {str(e)}")

    # Start periodic auto-save
    try:
        logger.info("Starting periodic auto-save...")
        await session_manager.start_auto_save()
        logger.info("Periodic auto-save started")
    except Exception as e:
        logger.error(f"Failed to start periodic auto-save: {str(e)}")

    logger.info("Application startup completed successfully!")

    yield

    # Shutdown: Clean up resources gracefully
    logger.info("Shutting down services...")

    # Stop agent workers (Following AutoGen pattern: runtime.stop())
    # Note: Agent workers have been removed from this version
    # try:
    #     logger.info("Stopping agent workers...")
    #     await agent_worker.stop_all_workers()
    #     logger.info("Agent workers stopped")
    # except Exception as e:
    #     logger.error(f"Error stopping agent workers: {str(e)}")

    # Trigger graceful shutdown if not already triggered
    if not shutdown_event.is_set():
        await graceful_shutdown()

    # Wait for graceful shutdown to complete
    try:
        await asyncio.wait_for(shutdown_event.wait(), timeout=35.0)
        logger.info("Graceful shutdown completed")
    except asyncio.TimeoutError:
        logger.warning("Graceful shutdown timeout")

    # Shutdown vector store
    try:
        await rag_memory.close()
        logger.info("Vector store shutdown completed")
    except Exception as e:
        logger.error(f"Error during vector store shutdown: {str(e)}")


# Create FastAPI app
app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # Use settings for CORS origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Include routers
app.include_router(health_router, tags=["health"])
app.include_router(sessions_router, tags=["sessions"])
app.include_router(runbook_router, tags=["runbook"])
app.include_router(websocket_router, tags=["websocket"])


# Legacy wrapper functions for backward compatibility
async def get_selector_group_chat(user_input_func, external_termination=None):
    """
    Get a configured SLAR agent team.
    This function is now a wrapper around SLARAgentManager for backward compatibility.
    """
    slar_agent_manager.set_user_input_func(user_input_func)
    return await slar_agent_manager.get_selector_group_chat(user_input_func, external_termination)


async def get_history():
    """
    Get chat history from file.
    This function is now a wrapper around SLARAgentManager for backward compatibility.
    """
    return await slar_agent_manager.get_history()


# Example usage
if __name__ == "__main__":
    import uvicorn
    # Vector store initialization is now handled by FastAPI lifespan events
    uvicorn.run(app, host=settings.host, port=settings.port)
