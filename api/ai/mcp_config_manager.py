"""
MCP Configuration Manager with Background Sync

This module manages MCP server configurations with:
1. In-memory cache for fast access
2. User directory management
3. Reads from local .mcp.json files (synced from PostgreSQL)

NOTE: MCP configs are stored in PostgreSQL and synced to local .mcp.json files.
Background sync from object storage is deprecated.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from config import config

logger = logging.getLogger(__name__)

# Configuration
MCP_FILE_NAME = ".mcp.json"
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

    def set(self, user_id: str, mcp_config: Dict[str, Any]):
        """Store config in cache."""
        self._cache[user_id] = mcp_config
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
    Manages MCP configurations with local file access.

    Features:
    - In-memory cache with TTL
    - User workspace management
    - Reads from local .mcp.json files
    """

    def __init__(self):
        self.cache = MCPConfigCache()
        self._active_users: set = set()
        self._initialized = False

    def initialize(self):
        """Initialize manager."""
        if self._initialized:
            return

        logger.info("✅ MCP Config Manager initialized (local file mode)")
        self._initialized = True

    def extract_user_id(self, auth_token: str) -> Optional[str]:
        """
        Extract and VERIFY user ID from JWT token.

        Uses OIDC authentication via supabase_storage module.
        """
        if not auth_token:
            return None

        from supabase_storage import extract_user_id_from_token
        return extract_user_id_from_token(auth_token)

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

    async def get_mcp_servers(
        self, user_id: str, use_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Get MCP servers for user from local workspace file.

        Reads from local .mcp.json file that was synced from PostgreSQL.

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

        # Read from local workspace (synced from PostgreSQL)
        workspace = self.get_user_workspace(user_id)
        mcp_file = Path(workspace) / MCP_FILE_NAME

        if not mcp_file.exists():
            logger.debug(f"ℹ️  No .mcp.json found in workspace: {workspace}")
            return {}

        try:
            with open(mcp_file, "r", encoding="utf-8") as f:
                mcp_config = json.load(f)

            # Cache it
            self.cache.set(user_id, mcp_config)

            # Track active user
            self._active_users.add(user_id)

            mcp_servers = mcp_config.get("mcpServers", {})
            logger.debug(
                f"✅ Loaded {len(mcp_servers)} MCP servers from local file: {mcp_file}"
            )
            return mcp_servers

        except Exception as e:
            logger.error(f"❌ Failed to read .mcp.json from {mcp_file}: {e}")
            return {}

    def register_user(self, user_id: str):
        """Register user as active."""
        self._active_users.add(user_id)
        logger.debug(f"👤 User registered: {user_id}")

    def unregister_user(self, user_id: str):
        """Unregister user."""
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


async def get_user_mcp_servers(
    auth_token: str, use_cache: bool = True
) -> Dict[str, Any]:
    """
    Convenience function to get user's MCP servers.

    Args:
        auth_token: JWT token
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
        auth_token: JWT token

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


# Legacy functions (no-op for backwards compatibility)
def start_background_sync():
    """Deprecated: Background sync is no longer needed."""
    logger.info("ℹ️  Background sync is deprecated - MCP configs are synced from PostgreSQL")


def stop_background_sync():
    """Deprecated: Background sync is no longer needed."""
    pass
