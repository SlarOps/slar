"""
Health check and system status routes.
"""

from datetime import datetime
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check endpoint that verifies vector store and MCP initialization."""
    try:
        # Import here to avoid circular imports
        try:
            from ..main import rag_memory, slar_agent_manager, session_manager
        except ImportError:
            from main import rag_memory, slar_agent_manager, session_manager
        
        # Check if vector store is initialized
        vector_store_ready = hasattr(rag_memory, '_client') and rag_memory._client is not None
        
        # Check if MCP tools are initialized
        mcp_tools_ready = slar_agent_manager._mcp_initialized
        mcp_tools_count = len(slar_agent_manager._mcp_tools_cache) if slar_agent_manager._mcp_tools_cache else 0

        # Session information
        active_sessions = session_manager.get_active_sessions()
        active_sessions_count = len(active_sessions)
        streaming_sessions = sum(1 for session in active_sessions.values() if session.is_streaming)

        return {
            "status": "healthy",
            "vector_store_ready": vector_store_ready,
            "mcp_tools_ready": mcp_tools_ready,
            "mcp_tools_count": mcp_tools_count,
            "active_sessions": active_sessions_count,
            "streaming_sessions": streaming_sessions,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "vector_store_ready": False,
            "mcp_tools_ready": False,
            "mcp_tools_count": 0,
            "active_sessions": 0,
            "streaming_sessions": 0,
            "timestamp": datetime.now().isoformat()
        }


@router.get("/history")
async def history():
    """Get chat history."""
    try:
        try:
            from ..main import slar_agent_manager
        except ImportError:
            from main import slar_agent_manager
        return await slar_agent_manager.get_history()
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e)) from e
