"""
MCP Configuration Manager with Background Sync

This module manages MCP server configurations with:
1. Background sync from Supabase Storage (interval-based or event-driven)
2. In-memory cache for fast access
3. User directory management
4. Automatic reload on configuration changes
"""

import os
import json
import asyncio
import logging
from typing import Dict, Optional, Any
from datetime import datetime, timedelta
from pathlib import Path
from supabase import create_client, Client
import jwt

logger = logging.getLogger(__name__)

# Configuration
MCP_FILE_NAME = ".mcp.json"
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SYNC_INTERVAL = int(os.getenv("MCP_SYNC_INTERVAL", "60"))  # Default: 60 seconds
USER_WORKSPACES_DIR = os.getenv("USER_WORKSPACES_DIR", "./workspaces")


class MCPConfigCache:
    """In-memory cache for MCP configurations."""

    def __init__(self):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._timestamps: Dict[str, datetime] = {}
        self._ttl = timedelta(seconds=SYNC_INTERVAL)

    def get(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get cached config if not expired."""
        if user_id not in self._cache:
            return None

        # Check if expired
        if datetime.now() - self._timestamps[user_id] > self._ttl:
            logger.debug(f"Cache expired for user: {user_id}")
            return None

        logger.debug(f"✅ Cache hit for user: {user_id}")
        return self._cache[user_id]

    def set(self, user_id: str, config: Dict[str, Any]):
        """Store config in cache."""
        self._cache[user_id] = config
        self._timestamps[user_id] = datetime.now()
        logger.debug(f"💾 Cached config for user: {user_id}")

    def invalidate(self, user_id: str):
        """Invalidate cache for user."""
        if user_id in self._cache:
            del self._cache[user_id]
            del self._timestamps[user_id]
            logger.info(f"🗑️  Cache invalidated for user: {user_id}")

    def clear(self):
        """Clear all cache."""
        self._cache.clear()
        self._timestamps.clear()
        logger.info("🗑️  Cache cleared")


class MCPConfigManager:
    """
    Manages MCP configurations with background sync.

    Features:
    - Background sync from Supabase Storage
    - In-memory cache with TTL
    - User workspace management
    - Realtime updates (optional)
    """

    def __init__(self):
        self.supabase: Optional[Client] = None
        self.cache = MCPConfigCache()
        self._sync_task: Optional[asyncio.Task] = None
        self._active_users: set = set()
        self._initialized = False

    def initialize(self):
        """Initialize Supabase client."""
        if self._initialized:
            return

        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            logger.warning("⚠️  Supabase credentials not configured - MCP sync disabled")
            self._initialized = True
            return

        try:
            self.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
            logger.info("✅ Supabase client initialized")
            self._initialized = True
        except Exception as e:
            logger.error(f"❌ Failed to initialize Supabase client: {e}")
            self._initialized = True

    def extract_user_id(self, auth_token: str) -> Optional[str]:
        """Extract user ID from JWT token."""
        if not auth_token:
            return None

        try:
            token = auth_token.replace("Bearer ", "").strip()
            decoded = jwt.decode(token, options={"verify_signature": False})
            user_id = decoded.get("sub")

            if user_id:
                logger.debug(f"✅ Extracted user_id: {user_id}")
            return user_id
        except Exception as e:
            logger.error(f"❌ Failed to extract user_id: {e}")
            return None

    def get_user_workspace(self, user_id: str) -> str:
        """
        Get or create user's workspace directory.

        Args:
            user_id: User's UUID

        Returns:
            Absolute path to user's workspace directory
        """
        workspace_path = Path(USER_WORKSPACES_DIR) / user_id

        # Create directory if not exists
        workspace_path.mkdir(parents=True, exist_ok=True)

        logger.debug(f"📁 User workspace: {workspace_path}")
        return str(workspace_path.absolute())

    async def download_config(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Download MCP config from Supabase Storage.

        Args:
            user_id: User's UUID (bucket name)

        Returns:
            Parsed MCP configuration or None
        """
        if not self.supabase:
            return None

        try:
            logger.debug(f"📥 Downloading MCP config for user: {user_id}")

            # Download from storage
            response = self.supabase.storage.from_(user_id).download(MCP_FILE_NAME)

            if not response:
                logger.debug(f"ℹ️  No MCP config found for user: {user_id}")
                return None

            # Parse JSON
            config = json.loads(response)

            logger.info(f"✅ Downloaded MCP config for user: {user_id}")
            return config

        except Exception as e:
            logger.error(f"❌ Failed to download MCP config for user {user_id}: {e}")
            return None

    async def get_mcp_servers(self, user_id: str, use_cache: bool = True) -> Dict[str, Any]:
        """
        Get MCP servers for user from local workspace file.

        NOTE: This function now reads from local .mcp.json file that was
        already synced by sync_bucket(). No need to download again.

        Args:
            user_id: User's UUID
            use_cache: Whether to use cached config (default: True)

        Returns:
            Dictionary of MCP servers (empty dict if file not found)
        """
        # Check cache first
        if use_cache:
            cached = self.cache.get(user_id)
            if cached:
                return cached.get("mcpServers", {})

        # Read from local workspace (already synced by sync_bucket)
        workspace = self.get_user_workspace(user_id)
        mcp_file = Path(workspace) / MCP_FILE_NAME

        if not mcp_file.exists():
            logger.debug(f"ℹ️  No .mcp.json found in workspace: {workspace}")
            return {}

        try:
            with open(mcp_file, 'r', encoding='utf-8') as f:
                config = json.load(f)

            # Cache it
            self.cache.set(user_id, config)

            # Track active user
            self._active_users.add(user_id)

            mcp_servers = config.get("mcpServers", {})
            logger.debug(f"✅ Loaded {len(mcp_servers)} MCP servers from local file: {mcp_file}")
            return mcp_servers

        except Exception as e:
            logger.error(f"❌ Failed to read .mcp.json from {mcp_file}: {e}")
            return {}

    async def sync_config(self, user_id: str):
        """
        Sync config for a specific user.
        Force download and update cache.
        """
        logger.info(f"🔄 Syncing config for user: {user_id}")

        config = await self.download_config(user_id)

        if config:
            self.cache.set(user_id, config)
            logger.info(f"✅ Config synced for user: {user_id}")
        else:
            logger.info(f"ℹ️  No config to sync for user: {user_id}")

    async def background_sync(self):
        """
        Background task to periodically sync configs for active users.
        """
        logger.info(f"🔄 Background sync started (interval: {SYNC_INTERVAL}s)")

        while True:
            try:
                await asyncio.sleep(SYNC_INTERVAL)

                if not self._active_users:
                    logger.debug("No active users to sync")
                    continue

                logger.info(f"🔄 Syncing configs for {len(self._active_users)} active users")

                # Sync each active user
                for user_id in list(self._active_users):
                    try:
                        await self.sync_config(user_id)
                    except Exception as e:
                        logger.error(f"❌ Failed to sync user {user_id}: {e}")

                logger.info("✅ Background sync completed")

            except asyncio.CancelledError:
                logger.info("🛑 Background sync cancelled")
                break
            except Exception as e:
                logger.error(f"❌ Background sync error: {e}", exc_info=True)

    def start_background_sync(self):
        """Start background sync task."""
        if self._sync_task and not self._sync_task.done():
            logger.warning("⚠️  Background sync already running")
            return

        if not self.supabase:
            logger.warning("⚠️  Supabase not configured - background sync disabled")
            return

        self._sync_task = asyncio.create_task(self.background_sync())
        logger.info("🚀 Background sync task started")

    def stop_background_sync(self):
        """Stop background sync task."""
        if self._sync_task and not self._sync_task.done():
            self._sync_task.cancel()
            logger.info("🛑 Background sync task stopped")

    def register_user(self, user_id: str):
        """Register user as active (for background sync)."""
        self._active_users.add(user_id)
        logger.debug(f"👤 User registered: {user_id}")

    def unregister_user(self, user_id: str):
        """Unregister user (stop syncing their config)."""
        if user_id in self._active_users:
            self._active_users.remove(user_id)
            logger.debug(f"👋 User unregistered: {user_id}")


# Global instance
_manager: Optional[MCPConfigManager] = None


def get_manager() -> MCPConfigManager:
    """Get or create global MCPConfigManager instance."""
    global _manager

    if _manager is None:
        _manager = MCPConfigManager()
        _manager.initialize()

    return _manager


async def get_user_mcp_servers(auth_token: str, use_cache: bool = True) -> Dict[str, Any]:
    """
    Convenience function to get user's MCP servers.

    Args:
        auth_token: Supabase JWT token
        use_cache: Whether to use cached config

    Returns:
        Dictionary of MCP servers
    """
    manager = get_manager()

    # Extract user_id
    user_id = manager.extract_user_id(auth_token)
    if not user_id:
        logger.warning("Could not extract user_id from token")
        return {}

    # Get MCP servers
    return await manager.get_mcp_servers(user_id, use_cache=use_cache)


def get_user_workspace(auth_token: str) -> str:
    """
    Get user's workspace directory.

    Args:
        auth_token: Supabase JWT token

    Returns:
        Absolute path to workspace directory (default: "." if no user_id)
    """
    manager = get_manager()

    # Extract user_id
    user_id = manager.extract_user_id(auth_token)
    if not user_id:
        return "."

    # Get workspace
    return manager.get_user_workspace(user_id)


def start_background_sync():
    """Start background sync for all active users."""
    manager = get_manager()
    manager.start_background_sync()


def stop_background_sync():
    """Stop background sync."""
    manager = get_manager()
    manager.stop_background_sync()
