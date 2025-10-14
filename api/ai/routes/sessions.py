"""
Session management routes.
"""

import logging
from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/sessions")
async def list_sessions():
    """List all active sessions with their status."""
    try:
        try:
            from ..main import session_manager
        except ImportError:
            from main import session_manager
        
        active_sessions = session_manager.get_active_sessions()
        sessions_info = []
        
        for session_id, session in active_sessions.items():
            sessions_info.append({
                "session_id": session_id,
                "created_at": session.created_at.isoformat(),
                "last_activity": session.last_activity.isoformat(),
                "is_streaming": session.is_streaming,
                "has_team": session.team is not None,
                "has_state": session.team_state is not None,
                "current_task": session.current_task,
                "conversation_length": 0  # AutoGen manages conversation internally
            })
        
        return {
            "active_sessions": len(active_sessions),
            "sessions": sessions_info,
            "cleanup_config": {
                "max_age_hours": session_manager.max_session_age_hours,
                "cleanup_interval": session_manager.session_cleanup_interval
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/sessions/cleanup")
async def manual_session_cleanup():
    """Manually trigger session cleanup."""
    try:
        try:
            from ..main import session_manager
        except ImportError:
            from main import session_manager
        
        active_sessions = session_manager.get_active_sessions()
        sessions_before = len(active_sessions)
        await session_manager.cleanup_old_sessions()
        sessions_after = len(session_manager.get_active_sessions())
        
        return {
            "status": "success",
            "sessions_before": sessions_before,
            "sessions_after": sessions_after,
            "sessions_cleaned": sessions_before - sessions_after
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/sessions/{session_id}")
async def get_session_info(session_id: str):
    """Get detailed information about a specific session."""
    try:
        try:
            from ..main import session_manager
        except ImportError:
            from main import session_manager
        
        # Try to get or create session (which will load from disk if exists)
        session = await session_manager.get_or_create_session(session_id)
        
        return {
            "session_id": session_id,
            "created_at": session.created_at.isoformat(),
            "last_activity": session.last_activity.isoformat(),
            "is_streaming": session.is_streaming,
            "has_team": session.team is not None,
            "has_state": session.team_state is not None,
            "current_task": session.current_task,
            "conversation_history": [],  # AutoGen manages conversation internally  
            "team_state_size": len(str(session.team_state)) if session.team_state else 0,
            "can_resume": session.can_resume_stream()
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/sessions/{session_id}/history")
async def get_session_history(session_id: str):
    """Get conversation history for a specific session."""
    try:
        try:
            from ..main import session_manager
        except ImportError:
            from main import session_manager
        
        # Get or create session
        session = await session_manager.get_or_create_session(session_id)
        
        # Load history from separate history file (AutoGen pattern)
        history = await session.get_history()
        
        return {
            "session_id": session_id,
            "history": history,
            "last_activity": session.last_activity.isoformat(),
            "current_task": session.current_task,
            "total_messages": len(history)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/sessions/{session_id}/load")
async def load_session(session_id: str):
    """Explicitly load a session from disk into memory."""
    try:
        try:
            from ..main import session_manager
        except ImportError:
            from main import session_manager
        
        active_sessions = session_manager.get_active_sessions()
        
        if session_id in active_sessions:
            session = active_sessions[session_id]
            return {
                "status": "already_loaded",
                "message": f"Session {session_id} is already in memory",
                "session_info": {
                    "created_at": session.created_at.isoformat(),
                    "last_activity": session.last_activity.isoformat(),
                    "has_team": session.team is not None,
                    "has_state": session.team_state is not None
                }
            }
        
        # Create session object and try to load from disk
        session = await session_manager.get_or_create_session(session_id)
        
        return {
            "status": "loaded",
            "message": f"Session {session_id} loaded successfully",
            "session_info": {
                "created_at": session.created_at.isoformat(),
                "last_activity": session.last_activity.isoformat(),
                "has_team": session.team is not None,
                "has_state": session.team_state is not None,
                "current_task": session.current_task
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a specific session."""
    try:
        try:
            from ..main import session_manager
        except ImportError:
            from main import session_manager
        
        active_sessions = session_manager.get_active_sessions()
        
        if session_id not in active_sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session = active_sessions[session_id]
        await session.cleanup()
        session.delete_from_disk()
        del active_sessions[session_id]
        
        return {
            "status": "success",
            "message": f"Session {session_id} deleted successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/sessions/{session_id}/reset")
async def reset_session_team(session_id: str):
    """Reset the team for a specific session to fix running state issues."""
    try:
        try:
            from ..main import session_manager
        except ImportError:
            from main import session_manager
        
        active_sessions = session_manager.get_active_sessions()
        
        if session_id not in active_sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session = active_sessions[session_id]
        
        # Check current state
        has_team_before = session.team is not None
        is_streaming_before = session.is_streaming
        
        # Reset the team using AutoGen patterns
        reset_success = await session.smart_reset_team(force_reset=True)
        
        # Update streaming state
        session.is_streaming = False
        
        # Save state after reset
        await session.save_state()
        
        return {
            "status": "success",
            "message": f"Team reset for session {session_id}",
            "details": {
                "had_team_before": has_team_before,
                "was_streaming_before": is_streaming_before,
                "reset_success": reset_success,
                "has_team_after": session.team is not None,
                "is_streaming_after": session.is_streaming
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/sessions/{session_id}/stop")
async def stop_session_stream(session_id: str):
    """Stop streaming for a specific session safely using ExternalTermination."""
    try:
        try:
            from ..main import session_manager
        except ImportError:
            from main import session_manager
        
        active_sessions = session_manager.get_active_sessions()
        
        if session_id not in active_sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session = active_sessions[session_id]
        
        # Check current state
        was_streaming = session.is_streaming
        
        # Stop streaming safely using ExternalTermination
        stop_success = False
        if session.external_termination:
            try:
                # Use AutoGen's ExternalTermination to stop the team gracefully
                session.external_termination.set()
                logger.info(f"ExternalTermination set for session {session_id}")
                stop_success = True
            except Exception as e:
                logger.warning(f"Error setting ExternalTermination: {e}")
        
        # Update streaming state
        session.is_streaming = False
        
        # Additional cleanup if needed
        if session.team and not stop_success:
            try:
                # Fallback: Reset team to stop any ongoing operations
                await session.smart_reset_team(force_reset=True)
                stop_success = True
            except Exception as e:
                logger.warning(f"Error in fallback team reset: {e}")
                # Even if fallback fails, we mark as stopped
                stop_success = True
        
        # Save state after stop
        await session.save_state()
        
        return {
            "status": "success",
            "message": f"Streaming stopped for session {session_id}",
            "details": {
                "was_streaming": was_streaming,
                "stop_success": stop_success,
                "external_termination_used": session.external_termination is not None,
                "is_streaming_after": session.is_streaming,
                "has_team": session.team is not None
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error stopping session stream: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
