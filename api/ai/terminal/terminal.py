"""
Terminal PTY handler for WebSocket connections.
Provides a web-based terminal interface through xterm.js.
"""

import asyncio
import json
import os
import pty
import fcntl
import struct
import termios
import signal
import shlex
import subprocess
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class TerminalSession:
    """Manages a single PTY terminal session."""
    
    def __init__(self, shell_cmd: Optional[str] = None):
        """
        Initialize a terminal session.
        
        Args:
            shell_cmd: Command to run in the terminal. Defaults to SHELL_CMD env var or /bin/bash
        """
        self.shell_cmd = shell_cmd or os.environ.get("SHELL_CMD", "gemini")
        self.master_fd: Optional[int] = None
        self.slave_fd: Optional[int] = None
        self.process: Optional[subprocess.Popen] = None
        self.reader_task: Optional[asyncio.Task] = None
        self.writer_task: Optional[asyncio.Task] = None
        
    def set_winsize(self, cols: int, rows: int):
        """Set the terminal window size."""
        if self.master_fd is None:
            return
            
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            # Send SIGWINCH to notify the process of window resize
            try:
                os.kill(os.getpgid(os.getpid()), signal.SIGWINCH)
            except Exception as e:
                logger.debug(f"Failed to send SIGWINCH: {e}")
        except Exception as e:
            logger.error(f"Failed to set window size: {e}")
    
    async def start(self):
        """Start the PTY process."""
        # Create a new PTY
        self.master_fd, self.slave_fd = pty.openpty()
        
        # Set up environment
        env = os.environ.copy()
        env.setdefault("TERM", "xterm-256color")
        
        # Add any custom environment variables here
        # For example, if you need specific API keys or configs
        gemini_key = os.environ.get("GEMINI_API_KEY")
        if gemini_key:
            env["GEMINI_API_KEY"] = gemini_key
        
        try:
            # Spawn the shell/CLI in the PTY
            self.process = subprocess.Popen(
                shlex.split(self.shell_cmd),
                stdin=self.slave_fd,
                stdout=self.slave_fd,
                stderr=self.slave_fd,
                env=env,
                preexec_fn=os.setsid,
                close_fds=True,
            )
            logger.info(f"Terminal process started with PID {self.process.pid}")
        finally:
            # Parent should close slave side
            try:
                os.close(self.slave_fd)
                self.slave_fd = None
            except Exception as e:
                logger.error(f"Failed to close slave fd: {e}")
    
    async def read_output(self, websocket):
        """Read output from PTY and send to WebSocket."""
        loop = asyncio.get_running_loop()
        try:
            while True:
                # Read up to 4096 bytes from PTY master in a thread (since os.read blocks)
                data = await loop.run_in_executor(None, os.read, self.master_fd, 4096)
                if not data:
                    logger.debug("PTY master closed, stopping reader")
                    break
                # Send to browser as binary
                await websocket.send_bytes(data)
        except asyncio.CancelledError:
            logger.info("Terminal reader task cancelled")
            raise  # Re-raise to allow proper cleanup
        except Exception as e:
            logger.error(f"Terminal reader error: {e}")
        finally:
            # Try to close websocket gracefully
            try:
                if not websocket.client_state.disconnected:
                    await websocket.close()
            except Exception as e:
                logger.debug(f"Error closing websocket in reader: {e}")
    
    async def write_input(self, websocket):
        """Receive input from WebSocket and write to PTY."""
        loop = asyncio.get_running_loop()
        try:
            while True:
                # Receive message from WebSocket
                message = await websocket.receive()
                
                # Handle disconnect
                if message['type'] == 'websocket.disconnect':
                    logger.info("WebSocket disconnected")
                    break
                
                # Handle received data
                if message['type'] == 'websocket.receive':
                    # Check if it's text or bytes
                    if 'text' in message:
                        msg_text = message['text']
                        # Check for control message (JSON with {"resize": [cols, rows]})
                        try:
                            obj = json.loads(msg_text)
                            if isinstance(obj, dict) and "resize" in obj:
                                cols, rows = obj["resize"]
                                self.set_winsize(int(cols), int(rows))
                                continue
                        except (json.JSONDecodeError, ValueError, KeyError):
                            # Not JSON control; treat as text input
                            pass
                        data = msg_text.encode('utf-8', errors='ignore')
                    elif 'bytes' in message:
                        data = message['bytes']
                    else:
                        continue
                    
                    # Write input to PTY master in a thread to avoid blocking
                    if self.master_fd is not None:
                        try:
                            await loop.run_in_executor(None, os.write, self.master_fd, data)
                        except OSError as e:
                            logger.error(f"Failed to write to PTY: {e}")
                            break
                    
        except asyncio.CancelledError:
            logger.info("Terminal writer task cancelled")
            raise  # Re-raise to allow proper cleanup
        except Exception as e:
            logger.error(f"Terminal writer error: {e}")
    
    async def cleanup(self):
        """Clean up PTY and process resources."""
        logger.info("Starting terminal session cleanup...")
        
        # Step 1: Kill the process group first (most aggressive approach)
        # This ensures all child processes are also terminated
        if self.process:
            try:
                pid = self.process.pid
                pgid = os.getpgid(pid)
                
                # Try SIGTERM to process group first
                try:
                    os.killpg(pgid, signal.SIGTERM)
                    logger.debug(f"Sent SIGTERM to process group {pgid}")
                except ProcessLookupError:
                    logger.debug(f"Process group {pgid} already terminated")
                except Exception as e:
                    logger.warning(f"Failed to send SIGTERM to process group: {e}")
                
                # Wait briefly for graceful termination
                try:
                    await asyncio.wait_for(
                        asyncio.to_thread(self.process.wait),
                        timeout=0.5
                    )
                    logger.info(f"Process {pid} terminated gracefully")
                except asyncio.TimeoutError:
                    # Force kill the entire process group
                    logger.warning(f"Process {pid} did not terminate, sending SIGKILL to group {pgid}")
                    try:
                        os.killpg(pgid, signal.SIGKILL)
                        # Don't wait too long for SIGKILL
                        await asyncio.wait_for(
                            asyncio.to_thread(self.process.wait),
                            timeout=0.3
                        )
                        logger.info(f"Process {pid} force killed")
                    except asyncio.TimeoutError:
                        logger.error(f"Process {pid} still not responding to SIGKILL")
                    except ProcessLookupError:
                        logger.debug(f"Process {pid} already gone")
                    except Exception as e:
                        logger.error(f"Error force killing process: {e}")
                        
            except Exception as e:
                logger.error(f"Error terminating process: {e}")
            finally:
                self.process = None
        
        # Step 2: Close PTY master FD to unblock any pending reads
        # This MUST happen before cancelling tasks to unblock os.read()
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
                logger.debug("Closed PTY master FD")
                self.master_fd = None
            except OSError as e:
                logger.warning(f"Error closing master FD: {e}")
                self.master_fd = None
        
        # Step 3: Now cancel and cleanup tasks (they should unblock quickly now)
        tasks_to_cancel = []
        if self.reader_task and not self.reader_task.done():
            self.reader_task.cancel()
            tasks_to_cancel.append(self.reader_task)
        if self.writer_task and not self.writer_task.done():
            self.writer_task.cancel()
            tasks_to_cancel.append(self.writer_task)
        
        if tasks_to_cancel:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*tasks_to_cancel, return_exceptions=True),
                    timeout=1.0  # Shorter timeout since FD is already closed
                )
                logger.debug("All tasks cancelled successfully")
            except asyncio.TimeoutError:
                logger.warning("Timeout waiting for tasks to cancel (this is unusual)")
            except Exception as e:
                logger.error(f"Error cancelling tasks: {e}")
        
        logger.info("Terminal session cleanup completed")


class TerminalManager:
    """Manages multiple terminal sessions."""
    
    def __init__(self):
        self.sessions: dict[str, TerminalSession] = {}
    
    async def create_session(
        self, 
        session_id: str, 
        websocket,
        shell_cmd: Optional[str] = None
    ):
        """
        Create and start a new terminal session.
        
        Args:
            session_id: Unique identifier for the session
            websocket: WebSocket connection
            shell_cmd: Optional shell command to run
        """
        # Clean up existing session if any
        if session_id in self.sessions:
            logger.info(f"Cleaning up existing session {session_id}")
            await self.cleanup_session(session_id)
        
        # Create new session
        session = TerminalSession(shell_cmd)
        self.sessions[session_id] = session
        
        try:
            # Start the PTY process
            await session.start()
            
            # Start reader and writer tasks
            session.reader_task = asyncio.create_task(session.read_output(websocket))
            session.writer_task = asyncio.create_task(session.write_input(websocket))
            
            # Wait for either task to complete
            done, pending = await asyncio.wait(
                {session.reader_task, session.writer_task},
                return_when=asyncio.FIRST_COMPLETED
            )
            
            # Cancel pending tasks and wait for them
            for task in pending:
                task.cancel()
            
            # Wait for all tasks to complete (including cancelled ones)
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
                
        except asyncio.CancelledError:
            logger.info(f"Terminal session {session_id} was cancelled")
            raise  # Re-raise to allow proper cleanup
        except Exception as e:
            logger.error(f"Error in terminal session {session_id}: {e}")
        finally:
            await self.cleanup_session(session_id)
    
    async def cleanup_session(self, session_id: str):
        """Clean up a specific session."""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            await session.cleanup()
            del self.sessions[session_id]
            logger.info(f"Terminal session {session_id} cleaned up")
    
    async def cleanup_all(self):
        """Clean up all sessions with aggressive timeouts."""
        if not self.sessions:
            logger.info("No terminal sessions to clean up")
            return
            
        session_ids = list(self.sessions.keys())
        logger.info(f"Cleaning up {len(session_ids)} terminal session(s)")
        
        # Cleanup all sessions in parallel with aggressive timeout
        cleanup_tasks = [
            self.cleanup_session(session_id) 
            for session_id in session_ids
        ]
        
        try:
            # Reduced timeout - cleanup should be fast now
            await asyncio.wait_for(
                asyncio.gather(*cleanup_tasks, return_exceptions=True),
                timeout=3.0
            )
            logger.info("✅ All terminal sessions cleaned up successfully")
        except asyncio.TimeoutError:
            logger.warning("⚠️  Timeout during cleanup - forcing exit anyway")
            # Force clear all sessions
            self.sessions.clear()
        except Exception as e:
            logger.error(f"❌ Error during terminal session cleanup: {e}")
            # Force clear all sessions
            self.sessions.clear()


# Global terminal manager instance
terminal_manager = TerminalManager()

