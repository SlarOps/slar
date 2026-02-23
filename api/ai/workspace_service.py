"""
Workspace Service — user workspace management and data loading.

This module handles:
1. OIDC JWT token verification (primary auth method)
2. User workspace directory management
3. MCP servers loading from PostgreSQL
4. Plugin loading from PostgreSQL (files from git clone)
5. Memory sync (CLAUDE.md) from PostgreSQL to workspace
6. Skills directory management
7. Allowed tools management
"""

import os
import json
import logging
import re
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


CLAUDE_SKILLS_DIR = ".claude/skills"  # Skills location in workspace
CLAUDE_PLUGINS_DIR = ".claude/plugins"  # Plugins location in workspace

# Workspace configuration
USER_WORKSPACES_DIR = os.getenv("USER_WORKSPACES_DIR", "./workspaces")


_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def get_user_workspace_path(user_id: str) -> Path:
    """
    Get workspace directory path for user.

    Args:
        user_id: User's UUID

    Returns:
        Path to user's workspace directory (validated against traversal)

    Raises:
        ValueError: If user_id is not a valid UUID
    """
    if not user_id or not _UUID_PATTERN.match(user_id):
        raise ValueError(f"Invalid user_id format: {user_id!r}")
    workspace_root = Path(USER_WORKSPACES_DIR).resolve()
    candidate = (workspace_root / user_id).resolve()
    if not candidate.is_relative_to(workspace_root):
        raise ValueError(f"Invalid user_id: path traversal detected")
    return candidate


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

        # Authentication: Try session token first (fast), then OIDC (backward compat)
        if not config.session_secret and not config.oidc_issuer:
            logger.error("❌ No authentication configured. Set SESSION_SECRET or OIDC_ISSUER.")
            return None

        from oidc_auth import extract_user_id_from_oidc_token
        user_id_or_sub = extract_user_id_from_oidc_token(
            token, 
            config.oidc_issuer, 
            config.oidc_client_id,
            config.session_secret
        )
        
        if user_id_or_sub:
            # Session token returns user_id (UUID), OIDC returns sub (may need conversion)
            # Try to parse as UUID - if it works, it's already a UUID
            try:
                import uuid
                uuid.UUID(user_id_or_sub)
                user_id = user_id_or_sub  # Already a UUID
                logger.debug(f"✅ Token verified: user_id={user_id}")
            except ValueError:
                # Not a UUID - must be OIDC sub, convert it
                user_id = oidc_sub_to_uuid(user_id_or_sub)
                logger.debug(f"✅ OIDC token verified: sub={user_id_or_sub} -> uuid={user_id}")
            return user_id
        else:
            logger.warning("⚠️ Token verification failed")
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
    # Priority: direct user_id > resolve from auth_token
    effective_user_id = user_id

    if not effective_user_id and auth_token:
        # Resolve to actual DB user_id (may differ from provider_id in token)
        from database_util import resolve_user_id_from_token
        effective_user_id = resolve_user_id_from_token(auth_token)

    if not effective_user_id:
        logger.warning("⚠️ No user_id provided and could not resolve from auth_token")
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

        # Authentication: Try session token first (fast), then OIDC (backward compat)
        if not config.session_secret and not config.oidc_issuer:
            logger.error("❌ No authentication configured. Set SESSION_SECRET or OIDC_ISSUER.")
            return None

        from oidc_auth import get_user_info_from_oidc_token
        user_info = get_user_info_from_oidc_token(
            token, 
            config.oidc_issuer, 
            config.oidc_client_id,
            config.session_secret
        )
        
        if user_info:
            user_id_or_sub = user_info.get("id")
            if user_id_or_sub:
                # Session token returns user_id (UUID), OIDC returns sub (may need conversion)
                try:
                    import uuid
                    uuid.UUID(user_id_or_sub)
                    # Already a UUID from session token
                    logger.debug(f"✅ Token verified: user_id={user_id_or_sub}")
                except ValueError:
                    # Not a UUID - must be OIDC sub, convert it
                    user_info["oidc_sub"] = user_id_or_sub  # Keep original for reference
                    user_info["id"] = oidc_sub_to_uuid(user_id_or_sub)  # Convert to UUID
                    logger.debug(f"✅ OIDC token verified: sub={user_id_or_sub} -> uuid={user_info['id']}")
            return user_info
        else:
            logger.warning("⚠️ Token verification failed")
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


async def sync_memory_to_workspace(user_id: str, project_id: str = "") -> Dict[str, Any]:
    """
    Sync CLAUDE.md content from PostgreSQL to user's workspace file.

    Memory is project-scoped: one CLAUDE.md per project, shared by all users.
    Writes to .claude/CLAUDE.md in the user's workspace directory.

    Args:
        user_id: User's UUID (for workspace path)
        project_id: Project UUID (to fetch shared project memory)

    Returns:
        Dictionary with sync results:
        {
            "success": True,
            "content_length": 1234,
            "message": "Memory synced to .claude/CLAUDE.md"
        }
    """
    try:
        logger.info(f"📝 Syncing CLAUDE.md for user: {user_id}, project: {project_id}")

        # Fetch project memory from PostgreSQL
        content = ""
        if project_id:
            result = execute_query(
                "SELECT content FROM claude_memory WHERE project_id = %s",
                (project_id,),
                fetch="one"
            )
            if result:
                content = result.get("content", "")

        # Write to workspace .claude/CLAUDE.md
        workspace_path = get_user_workspace_path(user_id)
        claude_dir = workspace_path / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)
        claude_md_path = claude_dir / "CLAUDE.md"

        claude_md_path.write_text(content, encoding="utf-8")

        logger.info(f"✅ CLAUDE.md synced ({len(content)} chars) to: {claude_md_path}")

        return {
            "success": True,
            "content_length": len(content),
            "message": f"Memory synced to .claude/CLAUDE.md ({len(content)} chars)"
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
    # Resolve to actual DB user_id (may differ from provider_id in token)
    from database_util import resolve_user_id_from_token
    user_id = resolve_user_id_from_token(auth_token)
    if not user_id:
        return {
            "success": False,
            "synced_count": 0,
            "failed_count": 0,
            "skills": [],
            "errors": ["Invalid auth token or failed to resolve user"]
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
