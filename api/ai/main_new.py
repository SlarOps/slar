"""
Main FastAPI application entry point.
Refactored to use modular components.
"""

import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime

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
    from .utils import load_indexed_sources
except ImportError:
    # Fallback to absolute import (works with python main.py)
    from agent import SLARAgentManager
    from session import SessionManager
    from routes import health_router, sessions_router, runbook_router, websocket_router
    from utils import load_indexed_sources

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown tasks."""
    # Startup: Initialize ChromaDB memory and download models
    print("🚀 Starting vector store initialization...")
    logger.info("Starting vector store initialization...")
    try:
        # Initialize the memory system by performing a simple query
        # This will trigger the model download if it hasn't happened yet
        print("📥 Triggering model download by performing initial query...")
        logger.info("Triggering model download by performing initial query...")
        await rag_memory.query(
            MemoryContent(content="initialization", mime_type=MemoryMimeType.TEXT)
        )
        print("✅ Vector store initialized successfully - models are ready")
        logger.info("Vector store initialized successfully - models are ready")
        await slar_agent_manager.create_excutor()
    except Exception as e:
        print(f"❌ Failed to initialize vector store: {str(e)}")
        logger.error(f"Failed to initialize vector store: {str(e)}")
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

    yield

    # Shutdown: Clean up resources if needed
    print("🔄 Shutting down services...")
    logger.info("Shutting down services...")
    
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
