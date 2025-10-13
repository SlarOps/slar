"""
Main FastAPI application entry point.
Refactored to use modular components.
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

try:
    # Try relative import first (works with python -m main)
    from .agent import SLARAgentManager
    from .session import SessionManager
    from .routes import health_router, sessions_router, runbook_router, websocket_router
except ImportError:
    # Fallback to absolute import (works with python main.py)
    from agent import SLARAgentManager
    from session import SessionManager
    from routes import health_router, sessions_router, runbook_router, websocket_router

from autogen_core.memory import MemoryContent, MemoryMimeType

logger = logging.getLogger(__name__)

# Global configuration
data_store = os.getenv("DATA_STORE", os.path.dirname(__file__))
SOURCES_FILE = os.path.join(data_store, "indexed_sources.json")

# Initialize managers
slar_agent_manager = SLARAgentManager(data_store)
session_manager = SessionManager(data_store)

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
    
    # Startup: Initialize ChromaDB memory and download models
    print("🚀 Starting vector store initialization...")
    logger.info("Starting vector store initialization...")
    try:
        # Lightweight Chroma connectivity check (no OpenAI model call needed)
        config = getattr(rag_memory, '_config', None)
        collection_name = getattr(config, 'collection_name', 'autogen_docs')
        persistence_path = getattr(config, 'persistence_path', data_store)
        import chromadb
        client = chromadb.PersistentClient(path=persistence_path)
        client.get_or_create_collection(name=collection_name)
        print("✅ Vector store connectivity verified")
        logger.info("Vector store connectivity verified")
        await slar_agent_manager.create_excutor()
    except Exception as e:
        print(f"❌ Vector store connectivity check failed: {str(e)}")
        logger.error(f"Vector store connectivity check failed: {str(e)}")
        # Don't fail startup, but log the error

    # Pre-initialize MCP tools to avoid delay on first connection
    try:
        print("🔧 Pre-initializing MCP tools...")
        logger.info("Pre-initializing MCP tools...")
        await slar_agent_manager.initialize_mcp_tools()
        print("✅ MCP tools pre-initialization completed")
        logger.info("MCP tools pre-initialization completed")
    except Exception as e:
        print(f"❌ Failed to pre-initialize MCP tools: {str(e)}")
        logger.error(f"Failed to pre-initialize MCP tools: {str(e)}")
        # Don't fail startup, but log the error

    # Initial session cleanup
    try:
        print("🧹 Running initial session cleanup...")
        await session_manager.cleanup_old_sessions()
        print("✅ Initial session cleanup completed")
    except Exception as e:
        print(f"❌ Failed initial session cleanup: {str(e)}")
        logger.error(f"Failed initial session cleanup: {str(e)}")

    # Start periodic auto-save
    try:
        print("⏰ Starting periodic auto-save...")
        await session_manager.start_auto_save()
        print("✅ Periodic auto-save started")
    except Exception as e:
        print(f"❌ Failed to start periodic auto-save: {str(e)}")
        logger.error(f"Failed to start periodic auto-save: {str(e)}")

    print("🎯 Application startup completed successfully!")
    logger.info("Application startup completed successfully!")

    yield

    # Shutdown: Clean up resources gracefully
    print("🔄 Shutting down services...")
    logger.info("Shutting down services...")
    
    # Trigger graceful shutdown if not already triggered
    if not shutdown_event.is_set():
        await graceful_shutdown()
    
    # Wait for graceful shutdown to complete
    try:
        await asyncio.wait_for(shutdown_event.wait(), timeout=35.0)
        print("✅ Graceful shutdown completed")
        logger.info("Graceful shutdown completed")
    except asyncio.TimeoutError:
        print("⚠️  Graceful shutdown timeout")
        logger.warning("Graceful shutdown timeout")
    
    # Shutdown vector store
    try:
        await rag_memory.close()
        print("✅ Vector store shutdown completed")
    except Exception as e:
        print(f"❌ Error during vector store shutdown: {str(e)}")
        logger.error(f"Error during vector store shutdown: {str(e)}")


# Create FastAPI app
app = FastAPI(lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
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
async def get_team(user_input_func):
    """
    Get a configured SLAR agent team.
    This function is now a wrapper around SLARAgentManager for backward compatibility.
    """
    return await slar_agent_manager.get_team(user_input_func)


async def get_selector_group_chat(user_input_func, approval_func, external_termination=None):
    """
    Get a configured SLAR agent team.
    This function is now a wrapper around SLARAgentManager for backward compatibility.
    """
    slar_agent_manager.set_approval_func(approval_func)
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
    uvicorn.run(app, host="0.0.0.0", port=8002)
