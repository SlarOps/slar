"""
Storage & Authentication Utility

This module handles:
1. OIDC JWT token verification (primary auth method)
2. MCP servers from PostgreSQL (user_mcp_servers table) - PRIMARY SOURCE
3. Skills sync from local workspace
4. Plugins sync from git repositories
5. User workspace management

NOTE: MCP servers are stored in PostgreSQL, NOT object storage.
Use get_user_mcp_servers() to load MCP servers from database.

AUTHENTICATION:
- Primary: OIDC (Keycloak, Auth0, Okta, Zitadel, etc.) - requires OIDC_ISSUER env var
"""

import os
import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Dict, Optional, Any, List

from database_util import execute_query
from config import config

logger = logging.getLogger(__name__)

# OIDC namespace for generating deterministic UUIDs from OIDC subject IDs
# Must match Go API's oidcNamespace for consistency
OIDC_UUID_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # DNS namespace


def oidc_sub_to_uuid(sub: str) -> str:
    """
    Convert an OIDC subject ID to a deterministic UUID.

    This ensures the same OIDC user always gets the same UUID in our database.
    Uses UUID v5 (SHA-1 based) for deterministic generation.

    Must match Go API's oidcSubToUUID function for consistency.

    Args:
        sub: OIDC subject identifier (from 'sub' claim)

    Returns:
        UUID string

    Example:
        >>> oidc_sub_to_uuid("google-oauth2|123456")
        "a1b2c3d4-e5f6-5789-0abc-def012345678"
    """
    # If it's already a valid UUID, return as-is
    try:
        uuid.UUID(sub)
        return sub
    except (ValueError, TypeError):
        pass

    # Generate UUID v5 from OIDC subject (deterministic)
    return str(uuid.uuid5(OIDC_UUID_NAMESPACE, sub))


MCP_FILE_NAME = ".mcp.json"
CLAUDE_SKILLS_DIR = ".claude/skills"  # Skills location in workspace
CLAUDE_PLUGINS_DIR = ".claude/plugins"  # Plugins location in workspace

# Workspace configuration
USER_WORKSPACES_DIR = os.getenv("USER_WORKSPACES_DIR", "./workspaces")


def get_user_workspace_path(user_id: str) -> Path:
    """
    Get workspace directory path for user.

    Args:
        user_id: User's UUID

    Returns:
        Path to user's workspace directory
    """
    workspace_root = Path(USER_WORKSPACES_DIR)
    user_workspace = workspace_root / user_id
    return user_workspace


def ensure_user_workspace(user_id: str) -> Path:
    """
    Ensure user's workspace directory exists.

    Args:
        user_id: User's UUID

    Returns:
        Path to created workspace directory
    """
    workspace_path = get_user_workspace_path(user_id)
    workspace_path.mkdir(parents=True, exist_ok=True)
    logger.debug(f"📁 Ensured workspace exists: {workspace_path}")
    return workspace_path


def save_config_to_file(user_id: str, mcp_config: Dict[str, Any]) -> bool:
    """
    Save MCP configuration to file in user's workspace.

    Args:
        user_id: User's UUID
        mcp_config: MCP configuration dictionary

    Returns:
        True if saved successfully, False otherwise
    """
    try:
        # Ensure workspace directory exists
        workspace_path = ensure_user_workspace(user_id)

        # Write config to .mcp.json file
        config_file = workspace_path / MCP_FILE_NAME
        with open(config_file, 'w') as f:
            json.dump(mcp_config, f, indent=2)

        logger.info(f"💾 Saved config to file: {config_file}")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to save config to file for user {user_id}: {e}")
        return False


def load_config_from_file(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Load MCP configuration from file in user's workspace.

    Args:
        user_id: User's UUID

    Returns:
        Parsed MCP configuration dictionary or None if file doesn't exist
    """
    try:
        workspace_path = get_user_workspace_path(user_id)
        config_file = workspace_path / MCP_FILE_NAME

        if not config_file.exists():
            logger.debug(f"📄 Config file does not exist: {config_file}")
            return None

        with open(config_file, 'r') as f:
            mcp_config = json.load(f)

        logger.info(f"📂 Loaded config from file: {config_file}")
        return mcp_config

    except Exception as e:
        logger.error(f"❌ Failed to load config from file for user {user_id}: {e}")
        return None


def extract_user_id_from_token(auth_token: str) -> Optional[str]:
    """
    Extract and VERIFY user ID from JWT token.

    Uses OIDC authentication (Keycloak, Auth0, Okta, Zitadel, etc.)

    SECURITY: This function verifies JWT signature using:
    - OIDC: RS256/RS384/RS512 with JWKS public key

    The returned user_id is a UUID:
    - If OIDC 'sub' claim is already a UUID, it's returned as-is
    - Otherwise, OIDC 'sub' is converted to UUID v5 (deterministic)

    Args:
        auth_token: JWT token from OIDC provider

    Returns:
        User ID (UUID string) or None if verification fails

    Raises:
        None - Returns None on any error to prevent information disclosure
    """
    if not auth_token:
        logger.warning("⚠️ No auth token provided")
        return None

    try:
        # Remove 'Bearer ' prefix if present
        token = auth_token.replace("Bearer ", "").strip()

        # OIDC Authentication (Required)
        if not config.oidc_issuer:
            logger.error("❌ No authentication provider configured. Set OIDC_ISSUER environment variable.")
            return None

        from oidc_auth import extract_user_id_from_oidc_token
        oidc_sub = extract_user_id_from_oidc_token(token, config.oidc_issuer, config.oidc_client_id)
        if oidc_sub:
            # Convert OIDC subject to UUID for database compatibility
            user_id = oidc_sub_to_uuid(oidc_sub)
            logger.debug(f"✅ Verified OIDC token: sub={oidc_sub} -> uuid={user_id}")
            return user_id
        else:
            logger.warning("⚠️ OIDC token verification failed")
            return None

    except Exception as e:
        logger.error(f"❌ Unexpected error verifying token: {type(e).__name__}: {e}")
        return None


def parse_mcp_servers(mcp_config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Parse MCP configuration and extract mcpServers.

    Args:
        mcp_config: Full MCP configuration dictionary

    Returns:
        Dictionary of MCP servers in format expected by ClaudeAgentOptions
        Empty dict if config is None or invalid
    """
    if not mcp_config:
        logger.warning("No config provided to parse")
        return {}

    mcp_servers = mcp_config.get("mcpServers", {})

    if not mcp_servers:
        logger.warning("Config does not contain 'mcpServers' field")
        return {}

    logger.info(f"📋 Found {len(mcp_servers)} MCP servers in config")
    return mcp_servers


async def get_user_mcp_servers(auth_token: str = "", user_id: str = "") -> Dict[str, Any]:
    """
    Get MCP servers configuration from PostgreSQL database (instant, no lag).

    Reads from PostgreSQL user_mcp_servers table.
    Supports all three server types: stdio, sse, http

    Args:
        auth_token: JWT token (for unsecure flow)
        user_id: User ID directly (for secure/Zero-Trust flow, takes priority)

    Returns:
        Dictionary of MCP servers ready to pass to ClaudeAgentOptions
        Empty dict if no servers found (safe for mcp_servers.update())

    Example return format (stdio):
        {
            "context7": {
                "command": "npx",
                "args": ["-y", "@uptudev/mcp-context7"],
                "env": {}
            }
        }

    Example return format (sse/http):
        {
            "remote-api": {
                "type": "sse",
                "url": "https://api.example.com/mcp/sse",
                "headers": {"Authorization": "Bearer token"}
            }
        }
    """
    # Priority: direct user_id > extract from auth_token
    effective_user_id = user_id

    if not effective_user_id and auth_token:
        effective_user_id = extract_user_id_from_token(auth_token)

    if not effective_user_id:
        logger.warning("⚠️ No user_id provided and could not extract from auth_token")
        return {}

    try:
        # Query MCP servers from PostgreSQL using raw SQL
        query = "SELECT * FROM user_mcp_servers WHERE user_id = %s AND status = 'active'"
        results = execute_query(query, (effective_user_id,), fetch="all")

        if not results:
            logger.debug(f"ℹ️  No MCP servers found for user {effective_user_id}")
            return {}

        # Convert to MCP server format based on server_type
        mcp_servers = {}
        for server in results:
            server_name = server.get("server_name")
            server_type = server.get("server_type", "stdio")

            if not server_name:
                continue

            # Build server config based on type
            if server_type == "stdio":
                # stdio servers: command-based
                mcp_servers[server_name] = {
                    "command": server.get("command", ""),
                    "args": server.get("args", []),
                    "env": server.get("env", {})
                }
            elif server_type in ["sse", "http"]:
                # sse/http servers: URL-based
                mcp_servers[server_name] = {
                    "type": server_type,
                    "url": server.get("url", ""),
                    "headers": server.get("headers", {})
                }
            else:
                logger.warning(f"⚠️  Unknown server_type '{server_type}' for server '{server_name}', skipping")
                continue

        logger.info(f"✅ Loaded {len(mcp_servers)} MCP servers from PostgreSQL for user {effective_user_id}")
        logger.debug(f"   Servers: {list(mcp_servers.keys())}")
        return mcp_servers

    except Exception as e:
        logger.error(f"❌ Failed to load MCP servers from PostgreSQL for user {effective_user_id}: {e}")
        return {}


async def sync_mcp_config_to_local(user_id: str) -> Dict[str, Any]:
    """
    Sync MCP configuration from PostgreSQL to local .mcp.json file.

    This ensures the local workspace file matches the database state.
    Should be called after any MCP server add/delete operation.

    Args:
        user_id: User's UUID

    Returns:
        {"success": bool, "message": str, "servers_count": int}
    """
    try:
        from datetime import datetime

        # Get all active MCP servers from PostgreSQL using raw SQL
        query = "SELECT * FROM user_mcp_servers WHERE user_id = %s AND status = 'active'"
        results = execute_query(query, (user_id,), fetch="all")

        # Convert to .mcp.json format
        mcp_servers = {}
        for server in results or []:
            server_name = server.get("server_name")
            server_type = server.get("server_type", "stdio")

            if not server_name:
                continue

            if server_type == "stdio":
                mcp_servers[server_name] = {
                    "command": server.get("command", ""),
                    "args": server.get("args", []),
                    "env": server.get("env", {})
                }
            elif server_type in ["sse", "http"]:
                mcp_servers[server_name] = {
                    "type": server_type,
                    "url": server.get("url", ""),
                    "headers": server.get("headers", {})
                }

        # Build config object
        mcp_config = {
            "mcpServers": mcp_servers,
            "metadata": {
                "version": "1.0.0",
                "updatedAt": datetime.now().isoformat(),
                "syncedFrom": "postgresql"
            }
        }

        # Save to local .mcp.json file
        save_config_to_file(user_id, mcp_config)

        logger.info(f"✅ Synced {len(mcp_servers)} MCP servers to local .mcp.json for user {user_id}")

        return {
            "success": True,
            "message": f"Synced {len(mcp_servers)} servers to local file",
            "servers_count": len(mcp_servers)
        }

    except Exception as e:
        logger.error(f"❌ Failed to sync MCP config to local for user {user_id}: {e}")
        return {
            "success": False,
            "message": f"Sync failed: {str(e)}",
            "servers_count": 0
        }


def get_user_id_from_token(auth_token: str) -> Optional[str]:
    """
    Convenience function to extract user_id from token.
    Alias for extract_user_id_from_token for backward compatibility.

    Args:
        auth_token: JWT token

    Returns:
        User ID or None
    """
    return extract_user_id_from_token(auth_token)


def get_user_info_from_token(auth_token: str) -> Optional[Dict[str, Any]]:
    """
    Get full user info from OIDC JWT token.

    This function first verifies the token, then extracts user info.
    Uses OIDC providers (Keycloak, Auth0, Okta, Zitadel, etc.)

    Args:
        auth_token: JWT token (with or without Bearer prefix)

    Returns:
        User info dictionary or None if verification fails:
        {
            "id": "user-uuid",           # UUID (converted from OIDC sub if needed)
            "oidc_sub": "original-sub",  # Original OIDC subject for reference
            "email": "user@example.com",
            "name": "John Doe",
            "email_verified": True,
            "preferred_username": "johndoe"
        }
    """
    if not auth_token:
        logger.warning("⚠️ No auth token provided")
        return None

    try:
        # Remove Bearer prefix if present
        token = auth_token.replace("Bearer ", "").strip()

        # OIDC Authentication (Required)
        if not config.oidc_issuer:
            logger.error("❌ No authentication provider configured. Set OIDC_ISSUER environment variable.")
            return None

        from oidc_auth import get_user_info_from_oidc_token
        user_info = get_user_info_from_oidc_token(token, config.oidc_issuer, config.oidc_client_id)
        if user_info:
            # Convert OIDC subject to UUID for database compatibility
            oidc_sub = user_info.get("id")
            if oidc_sub:
                user_info["oidc_sub"] = oidc_sub  # Keep original for reference
                user_info["id"] = oidc_sub_to_uuid(oidc_sub)  # Convert to UUID
            logger.debug(f"✅ Got user info from OIDC token: {user_info.get('id')}")
            return user_info
        else:
            logger.warning("⚠️ OIDC token verification failed")
            return None

    except Exception as e:
        logger.error(f"❌ Unexpected error getting user info: {type(e).__name__}: {e}")
        return None


def load_user_plugins(user_id: str) -> List[Dict[str, str]]:
    """
    Load user's installed plugins from PostgreSQL database.

    Queries the installed_plugins table for active plugins and
    converts to format required by ClaudeAgentOptions.

    Args:
        user_id: User's UUID

    Returns:
        List of plugin configs in format:
        [
            {"type": "local", "path": "/path/to/plugin1"},
            {"type": "local", "path": "/path/to/plugin2"}
        ]
    """
    from claude_agent_sdk import SdkPluginConfig
    if not user_id:
        logger.debug(f"ℹ️  No user_id provided")
        return []

    try:
        # Query installed plugins from PostgreSQL using raw SQL
        query = "SELECT * FROM installed_plugins WHERE user_id = %s AND status = 'active'"
        results = execute_query(query, (user_id,), fetch="all")

        if not results:
            logger.debug(f"ℹ️  No installed plugins found for user {user_id}")
            return []

        workspace_path = get_user_workspace_path(user_id)
        plugin_configs = []

        for plugin in results:
            plugin_name = plugin.get("plugin_name")
            install_path = plugin.get("install_path")

            if not plugin_name or not install_path:
                logger.warning(f"⚠️  Plugin missing name or install_path, skipping: {plugin}")
                continue

            # Build absolute path from install_path
            # We use resolve() and is_relative_to() to satisfy security scans (CodeQL)
            try:
                plugin_absolute_path = (workspace_path / install_path).resolve()
                if not plugin_absolute_path.is_relative_to(workspace_path.resolve()):
                    logger.warning(f"🚨 Potential path traversal detected in plugin path: {install_path}")
                    continue
            except Exception as e:
                logger.warning(f"⚠️ Error resolving plugin path {install_path}: {e}")
                continue

            # Check if plugin directory exists
            if not plugin_absolute_path.exists():
                logger.warning(f"⚠️  Plugin directory not found: {plugin_absolute_path}")
                logger.debug(f"   Plugin: {plugin_name}, install_path: {install_path}")
                continue

            # Add plugin config using SdkPluginConfig
            plugin_config = SdkPluginConfig(
                type="local",
                path=str(install_path)
            )
            plugin_configs.append(plugin_config)

            logger.debug(f"✅ Loaded plugin: {plugin_name} from {install_path}")

        logger.info(f"📦 Loaded {len(plugin_configs)} plugins for user {user_id}")
        return plugin_configs

    except Exception as e:
        logger.error(f"❌ Failed to load plugins for user {user_id}: {e}")
        return []


def ensure_claude_skills_dir(workspace_path: Path) -> Path:
    """
    Ensure .claude/skills directory exists in user's workspace.

    Args:
        workspace_path: Path to user's workspace

    Returns:
        Path to .claude/skills directory
    """
    claude_skills_path = workspace_path / CLAUDE_SKILLS_DIR
    claude_skills_path.mkdir(parents=True, exist_ok=True)

    # Cleanup any leftover temp files/directories
    try:
        for item in claude_skills_path.iterdir():
            if item.name.startswith("_temp"):
                logger.info(f"🧹 Cleaning up leftover temp: {item.name}")
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
    except Exception as e:
        logger.debug(f"⚠️ Error during temp cleanup: {e}")

    logger.debug(f"📁 Ensured .claude/skills directory exists: {claude_skills_path}")
    return claude_skills_path


async def unzip_installed_plugins(user_id: str) -> Dict[str, Any]:
    """
    Verify installed plugins exist in workspace, auto-cloning marketplaces if missing.

    Git-based approach:
    - Plugin files are already in workspace from git clone
    - If marketplace not cloned, automatically clone it from repository_url
    - Re-verify plugin after cloning

    Args:
        user_id: User's UUID

    Returns:
        {
            "success": bool,
            "verified_count": int,
            "cloned_count": int,
            "message": str
        }
    """
    from git_utils import ensure_repository, get_marketplace_dir

    try:
        logger.info(f"📦 Verifying installed plugins for user: {user_id}")

        # Get installed plugins from PostgreSQL
        installed_plugins = execute_query(
            "SELECT * FROM installed_plugins WHERE user_id = %s AND status = 'active'",
            (user_id,),
            fetch="all"
        )

        if not installed_plugins:
            logger.info(f"ℹ️  No installed plugins found for user: {user_id}")
            return {
                "success": True,
                "verified_count": 0,
                "cloned_count": 0,
                "message": "No plugins installed"
            }

        logger.info(f"📋 Found {len(installed_plugins)} installed plugins")

        # Get user workspace
        workspace_path = get_user_workspace_path(user_id)
        verified_count = 0
        cloned_count = 0
        missing_plugins = []

        # Cache for marketplace info (avoid repeated DB queries)
        marketplace_cache: Dict[str, Optional[Dict]] = {}

        for plugin in installed_plugins:
            plugin_name = plugin["plugin_name"]
            marketplace_name = plugin["marketplace_name"]
            marketplace_id = plugin.get("marketplace_id")
            install_path = plugin.get("install_path", "")

            # Build full path to plugin
            if install_path:
                plugin_path = workspace_path / install_path
            else:
                plugin_path = workspace_path / ".claude" / "plugins" / "marketplaces" / marketplace_name / plugin_name

            # Check if plugin exists (from git clone)
            if plugin_path.exists():
                logger.info(f"   ✅ {plugin_name} - exists at {plugin_path}")
                verified_count += 1
                continue

            # Plugin not found - check if marketplace directory exists (git repo)
            marketplace_dir = get_marketplace_dir(workspace_path, marketplace_name)
            git_dir = marketplace_dir / ".git"

            if git_dir.exists():
                # Git repo exists but plugin path doesn't - might be wrong install_path
                logger.warning(f"   ⚠️  {plugin_name} - not found at {plugin_path}")
                logger.info(f"      Git repo exists at {marketplace_dir}")
                missing_plugins.append(plugin_name)
                continue

            # No git repo - need to clone the marketplace
            logger.info(f"   🔄 {plugin_name} - marketplace not cloned, attempting to clone: {marketplace_name}")

            # Get marketplace info from cache or database
            if marketplace_name not in marketplace_cache:
                marketplace_info = None
                if marketplace_id:
                    marketplace_info = execute_query(
                        "SELECT repository_url, branch FROM marketplaces WHERE id = %s",
                        (marketplace_id,),
                        fetch="one"
                    )
                if not marketplace_info:
                    # Fallback: query by user_id and name
                    marketplace_info = execute_query(
                        "SELECT repository_url, branch FROM marketplaces WHERE user_id = %s AND name = %s",
                        (user_id, marketplace_name),
                        fetch="one"
                    )
                marketplace_cache[marketplace_name] = marketplace_info

            marketplace_info = marketplace_cache[marketplace_name]

            if not marketplace_info or not marketplace_info.get("repository_url"):
                logger.warning(f"   ❌ {plugin_name} - no repository_url found for marketplace: {marketplace_name}")
                missing_plugins.append(plugin_name)
                continue

            # Clone the marketplace repository
            repo_url = marketplace_info["repository_url"]
            branch = marketplace_info.get("branch", "main")

            logger.info(f"   📥 Cloning marketplace: {repo_url} (branch: {branch})")
            success, result, was_cloned = await ensure_repository(repo_url, marketplace_dir, branch)

            if not success:
                logger.error(f"   ❌ Failed to clone marketplace {marketplace_name}: {result}")
                missing_plugins.append(plugin_name)
                continue

            if was_cloned:
                cloned_count += 1
                logger.info(f"   ✅ Cloned marketplace: {marketplace_name} (commit: {result[:8] if result else 'unknown'})")

            # Re-check if plugin exists after cloning
            if plugin_path.exists():
                logger.info(f"   ✅ {plugin_name} - now exists at {plugin_path}")
                verified_count += 1
            else:
                logger.warning(f"   ⚠️  {plugin_name} - still not found after cloning marketplace")
                missing_plugins.append(plugin_name)

        # Log summary
        if missing_plugins:
            logger.warning(f"⚠️  {len(missing_plugins)} plugins not found: {missing_plugins}")

        if cloned_count > 0:
            logger.info(f"📥 Auto-cloned {cloned_count} marketplaces")

        logger.info(f"✅ Verified {verified_count}/{len(installed_plugins)} plugins for user: {user_id}")

        return {
            "success": True,
            "verified_count": verified_count,
            "cloned_count": cloned_count,
            "missing_plugins": missing_plugins,
            "message": f"Verified {verified_count} plugins, cloned {cloned_count} marketplaces"
        }

    except Exception as e:
        logger.error(f"❌ Error verifying plugins: {e}", exc_info=True)
        return {
            "success": False,
            "verified_count": 0,
            "cloned_count": 0,
            "message": f"Error: {str(e)}"
        }


async def sync_memory_to_workspace(user_id: str, scope: str = "local") -> Dict[str, Any]:
    """
    Sync CLAUDE.md content from PostgreSQL to workspace file.

    Fetches memory content from claude_memory table and writes to:
    - Local scope: .claude/CLAUDE.md in user's workspace
    - User scope: ~/.claude/CLAUDE.md (global user directory)

    Args:
        user_id: User's UUID
        scope: Memory scope ('local' or 'user', default: 'local')

    Returns:
        Dictionary with sync results:
        {
            "success": True,
            "content_length": 1234,
            "message": "Memory synced to .claude/CLAUDE.md"
        }
    """
    try:
        logger.info(f"📝 Syncing CLAUDE.md for user: {user_id}, scope: {scope}")

        # Fetch memory from PostgreSQL using raw SQL
        result = execute_query(
            "SELECT content FROM claude_memory WHERE user_id = %s AND scope = %s",
            (user_id, scope),
            fetch="one"
        )

        # Get content (empty string if no memory)
        content = ""
        if result:
            content = result.get("content", "")

        # Determine target path based on scope
        if scope == "user":
            # User memory: ~/.claude/CLAUDE.md (global)
            home_dir = Path(os.path.expanduser("~"))
            claude_dir = home_dir / ".claude"
            claude_dir.mkdir(parents=True, exist_ok=True)
            claude_md_path = claude_dir / "CLAUDE.md"
            target_description = "~/.claude/CLAUDE.md"
        else:
            # Local memory: workspaces/{user_id}/.claude/CLAUDE.md
            workspace_path = get_user_workspace_path(user_id)
            claude_dir = workspace_path / ".claude"
            claude_dir.mkdir(parents=True, exist_ok=True)
            claude_md_path = claude_dir / "CLAUDE.md"
            target_description = ".claude/CLAUDE.md"

        # Write to CLAUDE.md
        claude_md_path.write_text(content, encoding="utf-8")

        logger.info(f"✅ CLAUDE.md synced ({len(content)} chars) to: {claude_md_path}")

        return {
            "success": True,
            "content_length": len(content),
            "message": f"Memory synced to {target_description} ({len(content)} chars)"
        }

    except Exception as e:
        error_msg = f"Failed to sync memory: {str(e)}"
        logger.error(f"❌ {error_msg}")
        return {
            "success": False,
            "content_length": 0,
            "message": error_msg
        }


async def get_user_allowed_tools(user_id: str) -> List[str]:
    """
    Get list of allowed tools for user from PostgreSQL.

    Args:
        user_id: User's UUID

    Returns:
        List of tool names that are allowed to run without permission
    """
    if not user_id:
        return []

    try:
        # Query user_allowed_tools table using raw SQL
        result = execute_query(
            "SELECT tool_name FROM user_allowed_tools WHERE user_id = %s",
            (user_id,),
            fetch="all"
        )

        if not result:
            return []

        allowed_tools = [item.get("tool_name") for item in result if item.get("tool_name")]
        logger.info(f"✅ Loaded {len(allowed_tools)} allowed tools for user {user_id}")
        return allowed_tools

    except Exception as e:
        logger.error(f"❌ Failed to load allowed tools for user {user_id}: {e}")
        return []


async def add_user_allowed_tool(user_id: str, tool_name: str) -> bool:
    """
    Add a tool to the user's allowed tools list in PostgreSQL.

    Args:
        user_id: User's UUID
        tool_name: Name of the tool to allow

    Returns:
        True if successful, False otherwise
    """
    if not user_id or not tool_name:
        return False

    try:
        # Use UPSERT pattern - INSERT with ON CONFLICT DO NOTHING
        execute_query(
            """
            INSERT INTO user_allowed_tools (user_id, tool_name)
            VALUES (%s, %s)
            ON CONFLICT (user_id, tool_name) DO NOTHING
            """,
            (user_id, tool_name),
            fetch="none"
        )

        logger.info(f"✅ Added {tool_name} to allowed tools for user {user_id}")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to add allowed tool {tool_name} for user {user_id}: {e}")
        return False


async def delete_user_allowed_tool(user_id: str, tool_name: str) -> bool:
    """
    Remove a tool from the user's allowed tools list in PostgreSQL.

    Args:
        user_id: User's UUID
        tool_name: Name of the tool to remove

    Returns:
        True if successful, False otherwise
    """
    if not user_id or not tool_name:
        return False

    try:
        # Delete record using raw SQL
        execute_query(
            "DELETE FROM user_allowed_tools WHERE user_id = %s AND tool_name = %s",
            (user_id, tool_name),
            fetch="none"
        )

        logger.info(f"✅ Removed {tool_name} from allowed tools for user {user_id}")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to remove allowed tool {tool_name} for user {user_id}: {e}")
        return False


async def sync_user_skills(auth_token: str) -> Dict[str, Any]:
    """
    Sync user skills from git repositories to workspace.

    Skills are now managed via git repositories (marketplaces), not Supabase Storage.
    This function ensures the .claude/skills directory exists.

    Args:
        auth_token: JWT token

    Returns:
        Dictionary with sync results
    """
    user_id = extract_user_id_from_token(auth_token)
    if not user_id:
        return {
            "success": False,
            "synced_count": 0,
            "failed_count": 0,
            "skills": [],
            "errors": ["Invalid auth token"]
        }

    try:
        workspace_path = get_user_workspace_path(user_id)
        skills_dir = ensure_claude_skills_dir(workspace_path)

        # List existing skills in workspace
        skill_files = []
        if skills_dir.exists():
            for item in skills_dir.iterdir():
                if item.suffix in [".skill", ".md"]:
                    skill_files.append(item.name)

        logger.info(f"✅ Skills directory ready: {skills_dir} ({len(skill_files)} skills)")

        return {
            "success": True,
            "synced_count": len(skill_files),
            "failed_count": 0,
            "skills": skill_files,
            "errors": []
        }

    except Exception as e:
        logger.error(f"❌ Failed to sync skills for user: {e}")
        return {
            "success": False,
            "synced_count": 0,
            "failed_count": 1,
            "skills": [],
            "errors": [str(e)]
        }
