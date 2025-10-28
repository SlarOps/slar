"""
Session management for AutoGen chat sessions.
"""

import json
import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Callable, Optional

import aiofiles
from autogen_agentchat.conditions import ExternalTermination

logger = logging.getLogger(__name__)


class DateTimeJSONEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles datetime objects."""
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


class AutoGenChatSession:
    """
    AutoGen-compliant chat session with proper state management.
    Based on official AutoGen documentation and best practices.
    """
    
    def __init__(self, session_id: str, data_store: str):
        self.session_id = session_id
        self.team = None
        self.current_task = None
        self.is_streaming = False
        self.last_activity = datetime.now()
        self.created_at = datetime.now()
        
        # AutoGen state management
        self.team_state = None
        self.state_version = "1.0"  # For future migrations
        
        # External termination support
        self.external_termination = None
        
        # Ensure sessions directory exists
        self.sessions_dir = os.path.join(data_store, "sessions")
        os.makedirs(self.sessions_dir, exist_ok=True)
        self.session_file = os.path.join(self.sessions_dir, f"{session_id}.json")
        
        # AutoGen pattern: separate history file
        self.history_file = os.path.join(self.sessions_dir, f"{session_id}_history.json")
        self.history = []  # In-memory history for performance
        self.history_dirty = False  # Track if history needs saving
        
    async def load_from_disk(self) -> bool:
        """Load session data from disk following AutoGen patterns."""
        try:
            if not os.path.exists(self.session_file):
                logger.info(f"No existing session file for {self.session_id}")
                return False
                
            async with aiofiles.open(self.session_file, "r") as f:
                session_data = json.loads(await f.read())
            
            # Validate session data structure
            if not self._validate_session_data(session_data):
                logger.info(f"Invalid session data for {self.session_id}, starting fresh")
                return False
            
            # Load basic session info
            self.current_task = session_data.get("current_task")
            
            # Parse timestamps
            if session_data.get("last_activity"):
                self.last_activity = datetime.fromisoformat(session_data["last_activity"])
            if session_data.get("created_at"):
                self.created_at = datetime.fromisoformat(session_data["created_at"])
            
            # Load and validate team state
            team_state = session_data.get("team_state")
            if team_state and self._validate_autogen_state(team_state):
                self.team_state = team_state
                logger.info(f"Loaded valid AutoGen state for session {self.session_id}")
            else:
                logger.info(f"Invalid or missing team state for {self.session_id}")
                self.team_state = None
            
            logger.info(f"Successfully loaded session from disk: {self.session_id}")
            
            # Load history from separate file (AutoGen pattern)
            await self._load_history_from_disk()
            
            return True
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error loading session {self.session_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Failed to load session from disk: {e}")
            return False
    
    def _validate_session_data(self, data: dict) -> bool:
        """Validate basic session data structure."""
        try:
            return (
                isinstance(data, dict) and
                data.get("session_id") == self.session_id and
                data.get("state_version") == self.state_version
            )
        except Exception:
            return False

    def _validate_autogen_state(self, state: dict) -> bool:
        """Validate AutoGen team state structure."""
        try:
            if not isinstance(state, dict):
                return False

            # Check for expected AutoGen state keys
            expected_keys = ["agents", "current_agent", "message_history"]
            has_valid_structure = any(key in state for key in expected_keys)

            # Validate data types
            if "agents" in state and not isinstance(state["agents"], (list, dict)):
                return False
            if "message_history" in state and not isinstance(state["message_history"], list):
                return False

            return has_valid_structure

        except Exception as e:
            logger.debug(f"State validation error: {e}")
            return False
    
    async def _load_history_from_disk(self):
        """Load conversation history from separate file (AutoGen pattern)."""
        try:
            if not os.path.exists(self.history_file):
                self.history = []
                return
            
            async with aiofiles.open(self.history_file, "r") as f:
                self.history = json.loads(await f.read())
            
            logger.debug(f"Loaded {len(self.history)} messages from history file: {self.session_id}")
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error loading history {self.session_id}: {e}")
            self.history = []
        except Exception as e:
            logger.error(f"Failed to load history from disk: {e}")
            self.history = []
    
    async def get_history(self) -> list:
        """Get conversation history (AutoGen pattern)."""
        return self.history.copy()
    
    async def save_history(self):
        """Save conversation history to separate file (AutoGen pattern)."""
        if not self.history_dirty:
            return  # No changes to save
            
        try:
            async with aiofiles.open(self.history_file, "w") as f:
                await f.write(json.dumps(self.history, indent=2, cls=DateTimeJSONEncoder))
            self.history_dirty = False
            logger.debug(f"Saved {len(self.history)} messages to history file: {self.session_id}")
        except Exception as e:
            logger.error(f"Failed to save history: {e}")
    
    def append_to_history(self, message_dict: dict):
        """Append message to in-memory history (AutoGen pattern)."""
        self.history.append(message_dict)
        self.history_dirty = True  # Mark for saving
    
    async def get_or_create_team(self, user_input_func):
        """Get existing team or create new one following AutoGen patterns with ExternalTermination support."""
        logger.info(f"Getting or creating team for session: {self.session_id}")
        if self.team is None:
            # Create ExternalTermination for this session
            self.external_termination = ExternalTermination()
            logger.info(f"Created ExternalTermination for session: {self.session_id}")

            # Import here to avoid circular imports
            from main import slar_agent_manager

            # Create team using factory function
            base_team = await slar_agent_manager.get_selector_group_chat(user_input_func, self.external_termination)
            logger.info(f"Created SelectorGroupChat team for session: {self.session_id}")
            # Use the team directly
            self.team = base_team
            
            # Restore state if available and valid
            if self.team_state:
                try:
                    await self.team.load_state(self.team_state)
                    logger.info(f"Successfully restored team state for session: {self.session_id}")
                except Exception as e:
                    logger.info(f"Failed to restore team state: {e}")
                    # Clear invalid state
                    self.team_state = None
                    
        return self.team
    
    def _is_team_busy(self) -> bool:
        """
        Check if team is currently processing a task.
        Based on AutoGen internal state inspection.
        """
        try:
            # Check if streaming is active (regardless of team existence)
            if self.is_streaming:
                return True
            
            # If no team, can't be busy
            if self.team is None:
                return False
            
            # Check various indicators that team might be busy
            # These are heuristics based on AutoGen internal behavior
            
            # Check for active streams or running state
            if hasattr(self.team, '_running') and getattr(self.team, '_running', False):
                return True
                
            return False
            
        except Exception as e:
            logger.debug(f"Error checking team busy state: {e}")
            return False
    
    async def smart_reset_team(self, force_reset: bool = False) -> bool:
        """
        Smart team reset - only reset when necessary.
        Based on AutoGen best practices with ExternalTermination support.
        """
        if self.team is None:
            return True
        
        try:
            # Reset external termination if it exists
            if self.external_termination:
                try:
                    await self.external_termination.reset()
                    logger.info(f"ExternalTermination reset for session {self.session_id}")
                except Exception as e:
                    logger.warning(f"Error resetting ExternalTermination: {e}")
            
            # Check if team is actually busy
            is_busy = self._is_team_busy()
            
            if force_reset or is_busy:
                # Reset the team to clear state
                # await self.team.reset()
                # logger.info(f"Team reset completed for session {self.session_id}")
                
                # Clear streaming flag after reset
                self.is_streaming = False
                return True
            else:
                # Team is idle, no need to reset
                logger.info(f"Team is idle, skipping reset for session {self.session_id}")
                return True
                
        except Exception as e:
            logger.warning(f"Team reset failed: {e}")
            # If reset fails, clear team reference and external termination
            self.team = None
            self.external_termination = None
            self.is_streaming = False
            return False
    
    async def safe_run_stream(self, task=None, max_retries: int = 2):
        """
        Safely run team stream with intelligent retry logic.
        Based on AutoGen error handling patterns.
        """
        if self.team is None:
            raise RuntimeError("No team available")
        
        for attempt in range(max_retries):
            try:
                # Set streaming flag
                self.is_streaming = True
                
                # Run the stream
                if task:
                    return self.team.run_stream(task=task)
                else:
                    return self.team.run_stream()
                    
            except Exception as e:
                error_msg = str(e).lower()
                
                if "already running" in error_msg and attempt < max_retries - 1:
                    logger.warning(f"Team already running, attempting reset (attempt {attempt + 1})")
                    await self.smart_reset_team(force_reset=True)
                    
                    if self.team is None:
                        raise RuntimeError("Team needs recreation due to reset failure")
                    continue
                    
                elif "invalid state" in error_msg and attempt < max_retries - 1:
                    logger.warning(f"Invalid state error, clearing team for recreation")
                    self.team = None
                    self.team_state = None
                    raise RuntimeError("Team needs recreation due to invalid state")
                    
                else:
                    # Reset streaming flag on error
                    self.is_streaming = False
                    raise e
        
        # Reset streaming flag if all retries failed
        self.is_streaming = False
        raise RuntimeError("Failed to start team stream after retries")
    
    async def save_state(self):
        """
        Save current team state with proper error handling.
        Following AutoGen state persistence patterns.
        """
        try:
            if not self.team:
                logger.warning(f"No team to save state for session {self.session_id}")
                return None
            
            # Save team state with timeout protection
            try:
                self.team_state = await asyncio.wait_for(
                    self.team.save_state(), 
                    timeout=30.0
                )
            except asyncio.TimeoutError:
                logger.error(f"State save timeout for session {self.session_id}")
                return None
            except Exception as e:
                logger.error(f"Team state save failed: {e}")
                return None
            
            # Atomic disk save
            await self._atomic_save_to_disk()
            
            logger.debug(f"State saved successfully for session {self.session_id}")
            return self.team_state
            
        except Exception as e:
            logger.error(f"Critical error saving session state: {e}")
            return None
    
    async def _atomic_save_to_disk(self):
        """
        Atomic save to disk to prevent corruption.
        Based on AutoGen persistence best practices.
        """
        # Ensure parent directory exists first
        parent_dir = os.path.dirname(self.session_file)
        os.makedirs(parent_dir, exist_ok=True)
        
        temp_file = f"{self.session_file}.tmp"
        
        try:
            session_data = {
                "session_id": self.session_id,
                "team_state": self.team_state,
                "current_task": self.current_task,
                "last_activity": self.last_activity.isoformat(),
                "created_at": self.created_at.isoformat(),
                "is_streaming": self.is_streaming,
                "state_version": self.state_version
            }
            
            # Write to temp file first
            async with aiofiles.open(temp_file, "w") as f:
                await f.write(json.dumps(session_data, indent=2, cls=DateTimeJSONEncoder))
            
            # Atomic rename
            os.rename(temp_file, self.session_file)
            
        except Exception as e:
            # Clean up temp file on error
            if os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except:
                    pass
            raise e
    
    def update_activity(self):
        """Update last activity timestamp."""
        self.last_activity = datetime.now()
    
    def can_resume_stream(self) -> bool:
        """
        Check if we can safely resume streaming.
        Based on AutoGen state management principles.
        """
        if not self.team or not self.team_state:
            return False
        
        try:
            # Team should not be busy
            if self._is_team_busy():
                return False
            
            # Should have valid state
            if not self._validate_autogen_state(self.team_state):
                return False
            
            # Last activity should be recent (within 1 hour)
            time_since_activity = datetime.now() - self.last_activity
            if time_since_activity > timedelta(hours=1):
                return False
            
            return True
            
        except Exception:
            return False
    
    async def cleanup(self):
        """
        Clean up session resources following AutoGen patterns.
        """
        try:
            # Save final state and history
            await self.save_state()
            await self.save_history()
            
            # Reset team to clean state
            if self.team:
                try:
                    await self.team.reset()
                except Exception as e:
                    logger.debug(f"Team reset during cleanup failed (expected): {e}")
            
            # Clear flags
            self.is_streaming = False
            
            logger.info(f"Session cleanup completed: {self.session_id}")
            
        except Exception as e:
            logger.error(f"Error during session cleanup: {e}")
    
    def delete_from_disk(self):
        """Delete session files from disk."""
        try:
            # Delete session state file
            if os.path.exists(self.session_file):
                os.remove(self.session_file)
                logger.info(f"Deleted session file: {self.session_id}")
            
            # Delete history file
            if os.path.exists(self.history_file):
                os.remove(self.history_file)
                logger.info(f"Deleted history file: {self.session_id}")
                
        except Exception as e:
            logger.error(f"Failed to delete session files: {e}")


# Session management utilities
class SessionManager:
    """Manages active sessions and cleanup."""
    
    def __init__(self, data_store: str):
        self.data_store = data_store
        self.active_sessions = {}
        self.session_cleanup_interval = 3600  # 1 hour in seconds
        self.max_session_age_hours = 24  # Maximum session age before cleanup
        self.auto_save_interval = 300  # Auto-save every 5 minutes
        self._auto_save_task = None
        self._shutdown = False
    
    async def start_auto_save(self):
        """Start the periodic auto-save task."""
        if self._auto_save_task is None or self._auto_save_task.done():
            self._auto_save_task = asyncio.create_task(self._auto_save_loop())
            logger.info("Started periodic auto-save task")
    
    async def stop_auto_save(self):
        """Stop the periodic auto-save task."""
        self._shutdown = True
        if self._auto_save_task and not self._auto_save_task.done():
            self._auto_save_task.cancel()
            try:
                await self._auto_save_task
            except asyncio.CancelledError:
                pass
            logger.info("Stopped periodic auto-save task")
    
    async def _auto_save_loop(self):
        """Periodic auto-save loop."""
        while not self._shutdown:
            try:
                await asyncio.sleep(self.auto_save_interval)
                if not self._shutdown:
                    await self._auto_save_sessions()
            except asyncio.CancelledError:
                logger.info("Auto-save loop cancelled")
                break
            except Exception as e:
                logger.error(f"Error in auto-save loop: {e}")
                # Continue the loop even if one save fails
    
    async def _auto_save_sessions(self):
        """Auto-save all active sessions."""
        if not self.active_sessions:
            return
        
        logger.debug(f"Auto-saving {len(self.active_sessions)} active sessions")
        save_tasks = []
        
        for session_id, session in self.active_sessions.items():
            try:
                # Only save if session has been active recently and is not currently streaming
                if not session.is_streaming and session.history_dirty:
                    save_tasks.append(self._safe_save_session(session_id, session))
            except Exception as e:
                logger.error(f"Error preparing auto-save for session {session_id}: {e}")
        
        if save_tasks:
            try:
                # Run saves concurrently with timeout
                await asyncio.wait_for(
                    asyncio.gather(*save_tasks, return_exceptions=True),
                    timeout=60.0
                )
                logger.debug(f"Auto-save completed for {len(save_tasks)} sessions")
            except asyncio.TimeoutError:
                logger.warning("Auto-save timeout - some sessions may not be saved")
    
    async def _safe_save_session(self, session_id: str, session):
        """Safely save a single session."""
        try:
            await session.save_state()
            await session.save_history()
            logger.debug(f"Auto-saved session: {session_id}")
        except Exception as e:
            logger.error(f"Failed to auto-save session {session_id}: {e}")
    
    async def get_or_create_session(self, session_id: str) -> AutoGenChatSession:
        """Get existing session or create new one with disk loading."""
        logger.info(f"Getting or creating session: {session_id}")
        if session_id not in self.active_sessions:
            # Create new session
            session = AutoGenChatSession(session_id, self.data_store)
            
            # Try to load from disk
            await session.load_from_disk()
            
            self.active_sessions[session_id] = session
            logger.info(f"Created/loaded session: {session_id}")
        
        session = self.active_sessions[session_id]
        session.update_activity()
        return session
    
    async def cleanup_old_sessions(self):
        """Clean up old inactive sessions."""
        try:
            cutoff_time = datetime.now() - timedelta(hours=self.max_session_age_hours)
            sessions_to_remove = []
            
            for session_id, session in self.active_sessions.items():
                if session.last_activity < cutoff_time:
                    sessions_to_remove.append(session_id)
            
            # Clean up old sessions
            for session_id in sessions_to_remove:
                session = self.active_sessions.get(session_id)
                if session:
                    await session.cleanup()
                    del self.active_sessions[session_id]
                    logger.info(f"Cleaned up old session: {session_id}")
            
            # Also clean up orphaned session files
            sessions_dir = os.path.join(self.data_store, "sessions")
            if os.path.exists(sessions_dir):
                for filename in os.listdir(sessions_dir):
                    if filename.endswith(".json"):
                        filepath = os.path.join(sessions_dir, filename)
                        try:
                            # Check file modification time
                            file_mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
                            if file_mtime < cutoff_time:
                                os.remove(filepath)
                                logger.info(f"Cleaned up orphaned file: {filename}")
                        except Exception as e:
                            logger.warning(f"Failed to clean up file {filename}: {e}")
            
            if sessions_to_remove:
                logger.info(f"Session cleanup completed: removed {len(sessions_to_remove)} sessions")
            
        except Exception as e:
            logger.error(f"Error during session cleanup: {e}")
    
    async def shutdown(self):
        """Shutdown the session manager and save all sessions."""
        logger.info("Shutting down session manager...")
        
        # Stop auto-save task
        await self.stop_auto_save()
        
        # Save all active sessions
        if self.active_sessions:
            logger.info(f"Saving {len(self.active_sessions)} active sessions before shutdown...")
            save_tasks = []
            for session_id, session in self.active_sessions.items():
                save_tasks.append(session.cleanup())
            
            if save_tasks:
                try:
                    await asyncio.wait_for(
                        asyncio.gather(*save_tasks, return_exceptions=True),
                        timeout=30.0
                    )
                    logger.info("All sessions saved during shutdown")
                except asyncio.TimeoutError:
                    logger.warning("Session save timeout during shutdown")
        
        logger.info("Session manager shutdown completed")
    
    def get_active_sessions(self):
        """Get dictionary of active sessions."""
        return self.active_sessions
