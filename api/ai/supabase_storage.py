"""
Supabase Storage Utility for downloading .mcp.json configuration

This module handles:
1. Downloading .mcp.json from user's Supabase Storage bucket
2. Parsing the configuration
3. Converting to format needed by ClaudeAgentOptions
4. Hash-based sync to avoid unnecessary downloads
"""

import os
import json
import logging
import zipfile
import shutil
import hashlib
from pathlib import Path
from typing import Dict, Optional, Any, List
from supabase import create_client, Client
import jwt

logger = logging.getLogger(__name__)

MCP_FILE_NAME = ".mcp.json"
CLAUDE_SKILLS_DIR = ".claude/skills"  # Skills location in both bucket and workspace
CLAUDE_PLUGINS_DIR = ".claude/plugins"  # Plugins location in both bucket and workspace

# Supabase configuration from environment
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Workspace configuration
USER_WORKSPACES_DIR = os.getenv("USER_WORKSPACES_DIR", "./workspaces")

def get_supabase_client() -> Client:
    """
    Create and return Supabase client with service role key.

    Service role key is needed to bypass RLS policies for downloading
    user's .mcp.json files.

    Returns:
        Supabase client instance

    Raises:
        ValueError: If environment variables are not set
    """
    if not SUPABASE_URL:
        raise ValueError("SUPABASE_URL environment variable not set")

    if not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable not set")

    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


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


def save_config_to_file(user_id: str, config: Dict[str, Any]) -> bool:
    """
    Save MCP configuration to file in user's workspace.

    Args:
        user_id: User's UUID
        config: MCP configuration dictionary

    Returns:
        True if saved successfully, False otherwise
    """
    try:
        # Ensure workspace directory exists
        workspace_path = ensure_user_workspace(user_id)

        # Write config to .mcp.json file
        config_file = workspace_path / MCP_FILE_NAME
        with open(config_file, 'w') as f:
            json.dump(config, f, indent=2)

        logger.info(f"💾 Saved config to file: {config_file}")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to save config to file for user {user_id}: {e}")
        return False


def load_config_from_file(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Load MCP configuration from file in user's workspace.

    This can be used as fallback if Supabase download fails,
    or for faster loading if file is recent.

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
            config = json.load(f)

        logger.info(f"📂 Loaded config from file: {config_file}")
        return config

    except Exception as e:
        logger.error(f"❌ Failed to load config from file for user {user_id}: {e}")
        return None


def extract_user_id_from_token(auth_token: str) -> Optional[str]:
    """
    Extract user ID from Supabase JWT token.

    Args:
        auth_token: JWT token from Supabase Auth

    Returns:
        User ID (UUID string) or None if extraction fails
    """
    if not auth_token:
        logger.warning("No auth token provided")
        return None

    try:
        # Remove 'Bearer ' prefix if present
        token = auth_token.replace("Bearer ", "").strip()

        # Decode JWT without verification (we trust Supabase's validation)
        # In production, you might want to verify the signature
        decoded = jwt.decode(token, options={"verify_signature": False})

        # Extract user ID from 'sub' claim
        user_id = decoded.get("sub")

        if user_id:
            logger.info(f"✅ Extracted user_id: {user_id}")
            return user_id
        else:
            logger.warning("Token does not contain 'sub' claim")
            return None

    except jwt.DecodeError as e:
        logger.error(f"❌ Failed to decode JWT token: {e}")
        return None
    except Exception as e:
        logger.error(f"❌ Unexpected error extracting user_id: {e}")
        return None


async def download_mcp_config(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Download .mcp.json configuration from user's Supabase Storage bucket.

    Args:
        user_id: User's UUID (bucket name)

    Returns:
        Parsed MCP configuration dictionary or None if download fails

    Example return:
        {
            "mcpServers": {
                "context7": {
                    "command": "npx",
                    "args": ["-y", "@uptudev/mcp-context7"],
                    "env": {}
                },
                "slar-incident-tools": {
                    "command": "python",
                    "args": ["/path/to/script.py"],
                    "env": {
                        "OPENAI_API_KEY": "${API_KEY:-default}",
                        "PORT": "8002"
                    }
                }
            },
            "metadata": {...}
        }
    """
    if not user_id:
        logger.warning("No user_id provided for MCP config download")
        return None

    try:
        logger.info(f"📥 Downloading MCP config for user: {user_id}")

        # Create Supabase client
        supabase = get_supabase_client()

        # Download file from storage
        # Bucket name is the user_id
        response = supabase.storage.from_(user_id).download(MCP_FILE_NAME)

        if not response:
            logger.warning(f"⚠️  No MCP config found for user: {user_id}")
            return None

        # Parse JSON
        config = json.loads(response)

        logger.info(f"✅ Successfully downloaded MCP config for user: {user_id}")
        logger.debug(f"Config keys: {list(config.keys())}")

        # Save to file in user's workspace
        save_config_to_file(user_id, config)

        return config

    except Exception as e:
        logger.error(f"❌ Failed to download MCP config for user {user_id}: {e}")
        return None


def parse_mcp_servers(config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Parse MCP configuration and extract mcpServers.

    Args:
        config: Full MCP configuration dictionary

    Returns:
        Dictionary of MCP servers in format expected by ClaudeAgentOptions
        Empty dict if config is None or invalid

    Example:
        Input:
            {
                "mcpServers": {
                    "context7": {...},
                    "slar-incident-tools": {...}
                }
            }

        Output:
            {
                "context7": MCPServer(...),
                "slar-incident-tools": MCPServer(...)
            }
    """
    if not config:
        logger.warning("No config provided to parse")
        return {}

    mcp_servers = config.get("mcpServers", {})

    if not mcp_servers:
        logger.warning("Config does not contain 'mcpServers' field")
        return {}

    logger.info(f"📋 Found {len(mcp_servers)} MCP servers in config")

    # TODO: Convert to MCPServer objects if needed
    # For now, return the raw dictionary
    # The claude-agent-sdk should handle the conversion

    return mcp_servers


async def get_user_mcp_servers(auth_token: str) -> Dict[str, Any]:
    """
    Get MCP servers configuration from PostgreSQL database (instant, no S3 lag).

    NEW APPROACH (Fast & Reliable):
    - Reads from PostgreSQL user_mcp_servers table
    - No S3 download required
    - Instant access, no lag
    - Frontend saves directly to PostgreSQL
    - Supports all three server types: stdio, sse, http

    Args:
        auth_token: Supabase JWT token

    Returns:
        Dictionary of MCP servers ready to pass to ClaudeAgentOptions
        Empty dict if no servers found (safe for mcp_servers.update())

    Example usage:
        user_mcp_servers = await get_user_mcp_servers(auth_token)
        options = ClaudeAgentOptions(
            mcp_servers={"incident_tools": incident_tools, **user_mcp_servers},
            ...
        )

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
    # Extract user ID from token
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        logger.warning("Could not extract user_id from auth token")
        return {}

    try:
        # Get Supabase client
        supabase = get_supabase_client()

        # Query MCP servers from PostgreSQL
        result = supabase.table("user_mcp_servers").select("*").eq("user_id", user_id).eq("status", "active").execute()

        if not result.data:
            logger.debug(f"ℹ️  No MCP servers found for user {user_id}")
            return {}

        # Convert to MCP server format based on server_type
        mcp_servers = {}
        for server in result.data:
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

        logger.info(f"✅ Loaded {len(mcp_servers)} MCP servers from PostgreSQL for user {user_id}")
        logger.debug(f"   Servers: {list(mcp_servers.keys())}")
        return mcp_servers

    except Exception as e:
        logger.error(f"❌ Failed to load MCP servers from PostgreSQL for user {user_id}: {e}")
        return {}


def get_user_id_from_token(auth_token: str) -> Optional[str]:
    """
    Convenience function to extract user_id from token.
    Alias for extract_user_id_from_token for backward compatibility.

    Args:
        auth_token: Supabase JWT token

    Returns:
        User ID or None
    """
    return extract_user_id_from_token(auth_token)


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

    Example:
        plugins = load_user_plugins(user_id)
        options = ClaudeAgentOptions(
            plugins=plugins,
            max_turns=3
        )
    """
    from claude_agent_sdk import SdkPluginConfig
    if not user_id:
        logger.debug(f"ℹ️  No user_id provided")
        return []

    try:
        # Get Supabase client
        supabase = get_supabase_client()

        # Query installed plugins from PostgreSQL
        result = supabase.table("installed_plugins").select("*").eq("user_id", user_id).eq("status", "active").execute()

        if not result.data:
            logger.debug(f"ℹ️  No installed plugins found for user {user_id}")
            return []

        workspace_path = get_user_workspace_path(user_id)
        plugin_configs = []

        for plugin in result.data:
            plugin_name = plugin.get("plugin_name")
            install_path = plugin.get("install_path")

            if not plugin_name or not install_path:
                logger.warning(f"⚠️  Plugin missing name or install_path, skipping: {plugin}")
                continue

            # Build absolute path from install_path
            # install_path is relative to workspace root (e.g., ".claude/plugins/marketplaces/anthropics-skills/document-skills/xlsx")
            plugin_absolute_path = workspace_path / install_path

            # Check if plugin directory exists
            if not plugin_absolute_path.exists():
                logger.warning(f"⚠️  Plugin directory not found: {plugin_absolute_path}")
                logger.debug(f"   Plugin: {plugin_name}, install_path: {install_path}")
                continue

            # Add plugin config using SdkPluginConfig
            # Path should be relative to workspace (install_path), not absolute
            plugin_config = SdkPluginConfig(
                type="local",
                path=str(install_path)
            )
            plugin_configs.append(plugin_config)

            logger.debug(f"✅ Loaded plugin: {plugin_name} from {install_path} (path: {install_path})")

        logger.info(f"📦 Loaded {len(plugin_configs)} plugins for user {user_id}")
        return plugin_configs

    except Exception as e:
        logger.error(f"❌ Failed to load plugins for user {user_id}: {e}")
        return []


# ============================================================
# SKILL STORAGE FUNCTIONS
# ============================================================
# All skills are now stored in .claude/skills/ directory in Supabase bucket.
# This follows the Claude Code workspace structure:
# user_id/
#   .mcp.json
#   .claude/
#     skills/
#       skill1.skill
#       skill2.skill
#     plugins/
#       installed_plugins.json
#       marketplaces/
# ============================================================


async def list_skill_files(user_id: str) -> List[Dict[str, Any]]:
    """
    List all skill files in user's Supabase Storage bucket from .claude/skills/.

    Args:
        user_id: User's UUID (bucket name)

    Returns:
        List of skill file metadata dictionaries

    Example:
        [
            {
                "name": "my-skill.skill",
                "id": "abc123",
                "created_at": "2025-11-03T00:00:00Z",
                "size": 1024
            },
            {
                "name": "skill-bundle.zip",
                "id": "def456",
                "created_at": "2025-11-03T00:00:00Z",
                "size": 8192
            }
        ]
    """
    if not user_id:
        logger.warning("No user_id provided for listing skill files")
        return []

    try:
        logger.info(f"📋 Listing skill files from .claude/skills/ for user: {user_id}")

        # Create Supabase client
        supabase = get_supabase_client()

        # List files in .claude/skills/ directory
        response = supabase.storage.from_(user_id).list(CLAUDE_SKILLS_DIR, {
            "limit": 100,
            "offset": 0,
            "sortBy": {"column": "created_at", "order": "desc"}
        })

        if not response:
            logger.info(f"⚠️  No .claude/skills/ directory found for user: {user_id}")
            return []

        # Filter only .skill and .zip files
        skill_files = [
            file for file in response
            if file.get("name", "").endswith((".skill", ".zip", ".md"))
        ]

        logger.info(f"✅ Found {len(skill_files)} skill files in .claude/skills/ for user: {user_id}")
        return skill_files

    except Exception as e:
        logger.error(f"❌ Failed to list skill files for user {user_id}: {e}")
        return []


async def download_skill_file(user_id: str, skill_filename: str) -> Optional[bytes]:
    """
    Download a single skill file from user's Supabase Storage bucket (.claude/skills/).

    Args:
        user_id: User's UUID (bucket name)
        skill_filename: Name of the skill file

    Returns:
        File content as bytes or None if download fails
    """
    if not user_id or not skill_filename:
        logger.warning("Missing user_id or skill_filename for download")
        return None

    try:
        logger.info(f"📥 Downloading skill file from .claude/skills/: {skill_filename} for user: {user_id}")

        # Create Supabase client
        supabase = get_supabase_client()

        # Download file from .claude/skills/ directory
        skill_path = f"{CLAUDE_SKILLS_DIR}/{skill_filename}"
        response = supabase.storage.from_(user_id).download(skill_path)

        if not response:
            logger.warning(f"⚠️  Skill file not found: {skill_path}")
            return None

        logger.info(f"✅ Successfully downloaded skill file: {skill_filename}")
        return response

    except Exception as e:
        logger.error(f"❌ Failed to download skill file {skill_filename} for user {user_id}: {e}")
        return None


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


def extract_skill_file(skill_content: bytes, skill_filename: str, target_dir: Path) -> bool:
    """
    Extract or copy skill file to target directory.

    - .zip files: Extract contents (handles nested .claude directories)
    - .skill files: Copy directly

    Args:
        skill_content: File content as bytes
        skill_filename: Name of the skill file
        target_dir: Target directory (.claude/skills)

    Returns:
        True if extraction/copy succeeded, False otherwise
    """
    try:
        if skill_filename.endswith(".zip"):
            # Extract zip file
            logger.info(f"📦 Extracting zip file: {skill_filename}")

            # Create a temporary extraction directory
            temp_extract_dir = target_dir / f"_temp_extract_{skill_filename.replace('.zip', '')}"
            temp_extract_dir.mkdir(parents=True, exist_ok=True)

            # Write zip to temp file
            temp_zip = target_dir / f"_temp_{skill_filename}"
            temp_zip.write_bytes(skill_content)

            # Extract all files to temp directory
            with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
                zip_ref.extractall(temp_extract_dir)

            # Check if extracted content has a nested .claude directory
            nested_claude = temp_extract_dir / ".claude"
            if nested_claude.exists() and nested_claude.is_dir():
                logger.info(f"📁 Found nested .claude directory, moving contents up")

                # Move contents from nested .claude to target_dir
                # Check for both commands/ and skills/ subdirectories
                nested_commands = nested_claude / "commands"
                nested_skills = nested_claude / "skills"

                if nested_commands.exists():
                    # Move commands to parent .claude/commands (not .claude/skills/commands)
                    parent_claude = target_dir.parent
                    target_commands = parent_claude / "commands"
                    target_commands.mkdir(parents=True, exist_ok=True)

                    for item in nested_commands.iterdir():
                        dest = target_commands / item.name
                        if dest.exists():
                            if dest.is_dir():
                                shutil.rmtree(dest)
                            else:
                                dest.unlink()
                        shutil.move(str(item), str(dest))
                    logger.info(f"✅ Moved commands to {target_commands}")

                if nested_skills.exists():
                    # Move skills to target_dir (which is .claude/skills)
                    for item in nested_skills.iterdir():
                        dest = target_dir / item.name
                        if dest.exists():
                            if dest.is_dir():
                                shutil.rmtree(dest)
                            else:
                                dest.unlink()
                        shutil.move(str(item), str(dest))
                    logger.info(f"✅ Moved skills to {target_dir}")
            else:
                # No nested .claude, move all contents directly
                for item in temp_extract_dir.iterdir():
                    if item.name.startswith("_temp"):
                        continue
                    dest = target_dir / item.name
                    if dest.exists():
                        if dest.is_dir():
                            shutil.rmtree(dest)
                        else:
                            dest.unlink()
                    shutil.move(str(item), str(dest))

            # Clean up temp files
            try:
                if temp_zip.exists():
                    temp_zip.unlink()
            except Exception as e:
                logger.warning(f"⚠️ Failed to delete temp zip: {e}")

            try:
                if temp_extract_dir.exists():
                    shutil.rmtree(temp_extract_dir)
            except Exception as e:
                logger.warning(f"⚠️ Failed to delete temp extract dir: {e}")

            logger.info(f"✅ Extracted {skill_filename} to {target_dir}")

        elif skill_filename.endswith(".skill"):
            # Copy .skill file directly
            logger.info(f"📄 Copying skill file: {skill_filename}")

            skill_file = target_dir / skill_filename
            skill_file.write_bytes(skill_content)

            logger.info(f"✅ Copied {skill_filename} to {target_dir}")

        else:
            logger.warning(f"⚠️  Unknown skill file format: {skill_filename}")
            return False

        return True

    except zipfile.BadZipFile as e:
        logger.error(f"❌ Invalid zip file {skill_filename}: {e}")
        return False
    except Exception as e:
        logger.error(f"❌ Failed to extract/copy skill file {skill_filename}: {e}")
        return False


async def sync_user_skills(auth_token: str) -> Dict[str, Any]:
    """
    Sync all skill files from Supabase Storage (.claude/skills/) to user's workspace.

    This is the main function to sync skills. It handles:
    1. Extract user_id from auth token
    2. List all skill files in .claude/skills/ directory in Supabase bucket
    3. Download each skill file from .claude/skills/
    4. Extract/copy to workspace .claude/skills/ directory

    Note: Skills are stored in .claude/skills/ in both bucket and workspace.
    This follows Claude Code workspace structure.

    Args:
        auth_token: Supabase JWT token

    Returns:
        Dictionary with sync results:
        {
            "success": True/False,
            "synced_count": 3,
            "failed_count": 0,
            "skills": ["skill1.skill", "skill2.skill", "bundle.zip"],
            "errors": []
        }

    Example usage:
        result = await sync_user_skills(auth_token)
        if result["success"]:
            logger.info(f"Synced {result['synced_count']} skills")
    """
    # Extract user ID from token
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        logger.warning("Could not extract user_id from auth token for skill sync")
        return {
            "success": False,
            "synced_count": 0,
            "failed_count": 0,
            "skills": [],
            "errors": ["Invalid auth token"]
        }

    logger.info(f"🔄 Starting skill sync for user: {user_id}")

    # Get user's workspace path
    workspace_path = get_user_workspace_path(user_id)

    # Ensure .claude/skills directory exists
    skills_dir = ensure_claude_skills_dir(workspace_path)

    # List all skill files in Supabase Storage
    skill_files = await list_skill_files(user_id)

    if not skill_files:
        logger.info(f"ℹ️  No skill files found for user: {user_id}")
        return {
            "success": True,
            "synced_count": 0,
            "failed_count": 0,
            "skills": [],
            "errors": []
        }

    # Download and extract each skill file
    synced_count = 0
    failed_count = 0
    synced_skills = []
    errors = []

    for skill_file in skill_files:
        skill_filename = skill_file.get("name", "")
        if not skill_filename:
            continue

        try:
            # Download skill file
            skill_content = await download_skill_file(user_id, skill_filename)

            if not skill_content:
                failed_count += 1
                errors.append(f"Failed to download: {skill_filename}")
                continue

            # Extract/copy to workspace
            if extract_skill_file(skill_content, skill_filename, skills_dir):
                synced_count += 1
                synced_skills.append(skill_filename)
                logger.info(f"✅ Synced skill: {skill_filename}")
            else:
                failed_count += 1
                errors.append(f"Failed to extract: {skill_filename}")

        except Exception as e:
            failed_count += 1
            error_msg = f"Error syncing {skill_filename}: {str(e)}"
            errors.append(error_msg)
            logger.error(f"❌ {error_msg}")

    logger.info(
        f"🏁 Skill sync completed for user {user_id}: "
        f"{synced_count} synced, {failed_count} failed"
    )

    return {
        "success": failed_count == 0,
        "synced_count": synced_count,
        "failed_count": failed_count,
        "skills": synced_skills,
        "errors": errors
    }


async def sync_user_plugins(auth_token: str) -> Dict[str, Any]:
    """
    Sync all plugin files from Supabase Storage (.claude/plugins/) to user's workspace.

    This syncs the entire plugins directory tree including:
    - .claude/plugins/installed_plugins.json
    - .claude/plugins/marketplaces/{marketplace-name}/.claude-plugin/marketplace.json
    - .claude/plugins/marketplaces/{marketplace-name}/{plugin-name}/* (all plugin files)

    Args:
        auth_token: Supabase JWT token

    Returns:
        Dictionary with sync results:
        {
            "success": True/False,
            "synced_count": 50,
            "failed_count": 0,
            "files": [...],
            "errors": []
        }

    Example usage:
        result = await sync_user_plugins(auth_token)
        if result["success"]:
            logger.info(f"Synced {result['synced_count']} plugin files")
    """
    # Extract user ID from token
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        logger.warning("Could not extract user_id from auth token for plugin sync")
        return {
            "success": False,
            "synced_count": 0,
            "failed_count": 0,
            "files": [],
            "errors": ["Invalid auth token"]
        }

    logger.info(f"🔄 Starting plugin sync for user: {user_id}")

    # Get user's workspace path
    workspace_path = get_user_workspace_path(user_id)
    plugins_dir = workspace_path / CLAUDE_PLUGINS_DIR

    # Ensure .claude/plugins directory exists
    plugins_dir.mkdir(parents=True, exist_ok=True)
    logger.debug(f"📁 Ensured plugins directory exists: {plugins_dir}")

    try:
        # Get Supabase client
        supabase = get_supabase_client()

        # List ALL plugin files (optimized with prefix listing)
        plugin_files = await list_all_files_optimized(supabase, user_id, CLAUDE_PLUGINS_DIR)

        if not plugin_files:
            logger.info(f"ℹ️  No plugin files found for user: {user_id}")
            return {
                "success": True,
                "synced_count": 0,
                "failed_count": 0,
                "files": [],
                "errors": []
            }

        logger.info(f"📋 Found {len(plugin_files)} plugin files to sync")

        # Download each file and recreate directory structure
        synced_count = 0
        failed_count = 0
        synced_files = []
        errors = []

        for file_info in plugin_files:
            # Get full path from file metadata
            file_path = file_info.get("name", "")
            if not file_path:
                continue

            try:
                # Download file from bucket
                response = supabase.storage.from_(user_id).download(file_path)

                if not response:
                    failed_count += 1
                    errors.append(f"Failed to download: {file_path}")
                    continue

                # Create local file path (remove .claude/plugins/ prefix to get relative path)
                # file_path: ".claude/plugins/installed_plugins.json"
                # relative_path: "installed_plugins.json"
                relative_path = file_path.replace(f"{CLAUDE_PLUGINS_DIR}/", "")

                local_file = plugins_dir / relative_path

                # Ensure parent directory exists
                local_file.parent.mkdir(parents=True, exist_ok=True)

                # Write file to local workspace
                local_file.write_bytes(response)

                synced_count += 1
                synced_files.append(file_path)
                logger.debug(f"✅ Synced: {file_path}")

            except Exception as e:
                failed_count += 1
                error_msg = f"Error syncing {file_path}: {str(e)}"
                errors.append(error_msg)
                logger.error(f"❌ {error_msg}")

        logger.info(
            f"🏁 Plugin sync completed for user {user_id}: "
            f"{synced_count} synced, {failed_count} failed"
        )

        return {
            "success": failed_count == 0,
            "synced_count": synced_count,
            "failed_count": failed_count,
            "files": synced_files,
            "errors": errors
        }

    except Exception as e:
        error_msg = f"Plugin sync failed: {str(e)}"
        logger.error(f"❌ {error_msg}")
        return {
            "success": False,
            "synced_count": 0,
            "failed_count": 0,
            "files": [],
            "errors": [error_msg]
        }


# ============================================================
# HASH-BASED SYNC FUNCTIONS
# ============================================================


def calculate_directory_hash(directory: Path) -> str:
    """
    Calculate hash of all files in a directory recursively.

    Args:
        directory: Path to directory

    Returns:
        SHA256 hash of all file contents and names

    Example:
        hash = calculate_directory_hash(Path("/workspace/user/.claude"))
    """
    hasher = hashlib.sha256()

    if not directory.exists():
        return ""

    # Sort files for consistent hash
    files = sorted(directory.rglob("*"))

    for file_path in files:
        if file_path.is_file() and not file_path.name.startswith("_temp"):
            # Hash file path (relative to directory)
            rel_path = file_path.relative_to(directory)
            hasher.update(str(rel_path).encode())

            # Hash file content
            try:
                hasher.update(file_path.read_bytes())
            except Exception as e:
                logger.warning(f"⚠️  Could not read file {file_path}: {e}")

    return hasher.hexdigest()


async def list_all_files_optimized(supabase: Client, bucket_id: str, prefix: str = "") -> List[Dict[str, Any]]:
    """
    OPTIMIZED: List all files with a prefix using search API (1 API call instead of N calls).

    This is the BEST PRACTICE for object storage - uses prefix matching instead of recursive traversal.
    Object storage is flat key-value, not hierarchical filesystem.

    Args:
        supabase: Supabase client
        bucket_id: Bucket ID (user_id)
        prefix: Prefix to filter (e.g., ".claude/plugins")

    Returns:
        List of all file metadata with full paths (single API call)

    Performance:
        - Old approach: N API calls (one per directory level)
        - New approach: 1 API call (uses prefix search)
        - 10x-100x faster for nested structures

    Example:
        # Get ALL files under .claude/plugins in ONE call
        files = await list_all_files_optimized(supabase, user_id, ".claude/plugins")
    """
    try:
        # Try using search API if available (Supabase Storage >= v0.40.0)
        # This gets ALL files matching prefix in single API call
        try:
            response = supabase.storage.from_(bucket_id).list(prefix, {
                "limit": 1000,
                "search": "",  # Empty search with prefix gets all files
                "sortBy": {"column": "name", "order": "asc"}
            })

            if response:
                # Normalize paths: list() returns paths relative to prefix
                # Need to prepend prefix to get full path for download()
                normalized_files = []
                for item in response:
                    item_name = item.get("name", "")
                    if not item_name or not item.get("id"):  # Skip if no name or is directory
                        continue

                    # Build full path: prefix + "/" + relative_name
                    # e.g., ".claude/plugins" + "/" + "installed_plugins.json"
                    full_path = f"{prefix}/{item_name}" if prefix else item_name

                    # Update item with full path
                    item["name"] = full_path
                    normalized_files.append(item)

                logger.debug(f"✅ Got {len(normalized_files)} files with prefix '{prefix}' (optimized)")
                return normalized_files
        except Exception as e:
            logger.debug(f"Search API not available, falling back to recursive: {e}")
            # Fallback to recursive if search not supported
            pass

        # Fallback: Use recursive approach
        return await list_directory_recursive(supabase, bucket_id, prefix)

    except Exception as e:
        logger.error(f"❌ Failed to list files with prefix '{prefix}': {e}")
        return []


async def list_all_files_in_bucket(supabase: Client, bucket_id: str) -> List[Dict[str, Any]]:
    """
    List ALL files in bucket (entire bucket, no prefix filter).

    Simple approach: Recursively list from root to get everything.

    Args:
        supabase: Supabase client
        bucket_id: Bucket ID (user_id)

    Returns:
        List of all file metadata with full paths
    """
    return await list_directory_recursive(supabase, bucket_id, "")


async def list_directory_recursive(supabase: Client, bucket_id: str, path: str = "") -> List[Dict[str, Any]]:
    """
    FALLBACK: Recursive directory listing (N API calls - slower but works everywhere).

    ⚠️  WARNING: This approach has performance issues:
    - Makes N+1 API calls (one per directory level)
    - Slow with deep nested structures
    - Risk of rate limiting
    - NOT recommended for production with many files

    Use list_all_files_optimized() instead when possible.

    Args:
        supabase: Supabase client
        bucket_id: Bucket ID (user_id)
        path: Directory path to list

    Returns:
        List of file metadata with full paths
    """
    all_files = []

    try:
        items = supabase.storage.from_(bucket_id).list(path, {"limit": 1000})

        if not items:
            return all_files

        for item in items:
            item_name = item.get("name", "")
            item_type = item.get("id")  # If id exists, it's a file

            # Build full path
            full_path = f"{path}/{item_name}" if path else item_name

            if item.get("id"):  # It's a file
                # Add full path to metadata
                item["name"] = full_path
                all_files.append(item)
            else:  # It's a directory, recurse into it
                logger.debug(f"📁 Recursing into directory: {full_path}")
                subdirectory_files = await list_directory_recursive(supabase, bucket_id, full_path)
                all_files.extend(subdirectory_files)

    except Exception as e:
        logger.debug(f"⚠️  Could not list directory {path}: {e}")

    return all_files


async def get_bucket_files_metadata(user_id: str) -> List[Dict[str, Any]]:
    """
    Get metadata of all files in user's bucket (.mcp.json + .claude/).

    Lists all files in:
    - .mcp.json (root)
    - .claude/skills/* (all files, including nested)
    - .claude/plugins/* (all files recursively, including marketplaces)

    PERFORMANCE: Uses optimized prefix listing (1 API call per directory tree) instead of
    recursive traversal (N API calls). Automatically falls back to recursive if needed.

    Args:
        user_id: User's UUID

    Returns:
        List of file metadata with name, size, updated_at

    Example:
        [
            {"name": ".mcp.json", "size": 1024, "updated_at": "2025-11-03..."},
            {"name": ".claude/skills/my-skill.skill", "size": 2048, "updated_at": "..."},
            {"name": ".claude/plugins/installed_plugins.json", "size": 512, ...},
            {"name": ".claude/plugins/marketplaces/anthropic-agent-skills/.claude-plugin/marketplace.json", ...}
        ]
    """
    if not user_id:
        return []

    try:
        supabase = get_supabase_client()
        all_files = []

        # Get .mcp.json from root
        try:
            root_files = supabase.storage.from_(user_id).list("", {"limit": 100})
            if root_files:
                mcp_file = [f for f in root_files if f.get("name") == ".mcp.json"]
                all_files.extend(mcp_file)
        except Exception as e:
            logger.debug(f"No .mcp.json file: {e}")

        # Get all files from .claude/skills/ (OPTIMIZED: 1 API call instead of N)
        try:
            skill_files = await list_all_files_optimized(supabase, user_id, CLAUDE_SKILLS_DIR)
            all_files.extend(skill_files)
            logger.debug(f"Found {len(skill_files)} files in .claude/skills/")
        except Exception as e:
            logger.debug(f"No skill files in .claude/skills/: {e}")

        # Get all files from .claude/plugins/ (OPTIMIZED: 1 API call instead of N)
        # This includes all nested marketplace files like:
        # - .claude/plugins/installed_plugins.json
        # - .claude/plugins/marketplaces/anthropic-agent-skills/.claude-plugin/marketplace.json
        # - .claude/plugins/marketplaces/anthropic-agent-skills/plugin-1/...
        try:
            plugin_files = await list_all_files_optimized(supabase, user_id, CLAUDE_PLUGINS_DIR)
            all_files.extend(plugin_files)
            logger.debug(f"Found {len(plugin_files)} files in .claude/plugins/")
        except Exception as e:
            logger.debug(f"No plugin files in .claude/plugins/: {e}")

        logger.info(f"📊 Total files in bucket: {len(all_files)}")
        return all_files

    except Exception as e:
        logger.error(f"❌ Failed to get bucket metadata for user {user_id}: {e}")
        return []


def calculate_bucket_hash(files_metadata: List[Dict[str, Any]]) -> str:
    """
    Calculate hash from bucket files metadata.

    Args:
        files_metadata: List of file metadata from bucket

    Returns:
        SHA256 hash of all file names, sizes, and timestamps

    Example:
        files = await get_bucket_files_metadata(user_id)
        hash = calculate_bucket_hash(files)
    """
    hasher = hashlib.sha256()

    # Sort by name for consistent hash
    sorted_files = sorted(files_metadata, key=lambda f: f.get("name", ""))

    for file_info in sorted_files:
        # Hash file name
        name = file_info.get("name", "")
        hasher.update(name.encode())

        # Hash file size
        size = file_info.get("size", 0)
        hasher.update(str(size).encode())

        # Hash updated_at timestamp
        updated_at = file_info.get("updated_at", "")
        hasher.update(str(updated_at).encode())

    return hasher.hexdigest()


async def get_local_workspace_hash(user_id: str) -> str:
    """
    Calculate hash of user's local workspace (.claude directory).

    Args:
        user_id: User's UUID

    Returns:
        SHA256 hash of local workspace

    Example:
        local_hash = await get_local_workspace_hash(user_id)
    """
    workspace_path = get_user_workspace_path(user_id)
    claude_dir = workspace_path / ".claude"

    if not claude_dir.exists():
        logger.debug(f"📁 No .claude directory for user {user_id}")
        return ""

    return calculate_directory_hash(claude_dir)


async def get_bucket_hash(user_id: str) -> str:
    """
    Calculate hash of user's bucket contents.

    Args:
        user_id: User's UUID

    Returns:
        SHA256 hash of bucket contents

    Example:
        bucket_hash = await get_bucket_hash(user_id)
    """
    files_metadata = await get_bucket_files_metadata(user_id)
    return calculate_bucket_hash(files_metadata)


def save_sync_state(user_id: str, bucket_hash: str, local_hash: str) -> None:
    """
    Save sync state to .claude/.sync_state file.

    Args:
        user_id: User's UUID
        bucket_hash: Hash of bucket contents
        local_hash: Hash of local workspace

    Example:
        save_sync_state(user_id, bucket_hash, local_hash)
    """
    try:
        workspace_path = get_user_workspace_path(user_id)
        claude_dir = workspace_path / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)

        sync_state_file = claude_dir / ".sync_state"
        sync_state = {
            "bucket_hash": bucket_hash,
            "local_hash": local_hash,
            "last_sync": json.dumps({"timestamp": "now"})  # Could use datetime
        }

        with open(sync_state_file, 'w') as f:
            json.dump(sync_state, f, indent=2)

        logger.debug(f"💾 Saved sync state for user {user_id}")

    except Exception as e:
        logger.error(f"❌ Failed to save sync state for user {user_id}: {e}")


def load_sync_state(user_id: str) -> Optional[Dict[str, str]]:
    """
    Load sync state from .claude/.sync_state file.

    Args:
        user_id: User's UUID

    Returns:
        Sync state dictionary or None if not found

    Example:
        state = load_sync_state(user_id)
        if state:
            last_bucket_hash = state["bucket_hash"]
    """
    try:
        workspace_path = get_user_workspace_path(user_id)
        sync_state_file = workspace_path / ".claude" / ".sync_state"

        if not sync_state_file.exists():
            return None

        with open(sync_state_file, 'r') as f:
            return json.load(f)

    except Exception as e:
        logger.debug(f"No sync state found for user {user_id}: {e}")
        return None


async def should_sync_bucket(user_id: str) -> bool:
    """
    Check if bucket needs to be synced based on hash comparison.

    Args:
        user_id: User's UUID

    Returns:
        True if sync needed, False otherwise

    Example:
        if await should_sync_bucket(user_id):
            await sync_all_from_bucket(user_id)
    """
    try:
        # Get current bucket hash
        bucket_hash = await get_bucket_hash(user_id)

        if not bucket_hash:
            logger.debug(f"📭 Empty bucket for user {user_id}")
            return False

        # Load saved sync state
        sync_state = load_sync_state(user_id)

        if not sync_state:
            logger.info(f"🆕 No sync state, need initial sync for user {user_id}")
            return True

        # Compare bucket hash
        saved_bucket_hash = sync_state.get("bucket_hash", "")

        if bucket_hash != saved_bucket_hash:
            logger.info(f"🔄 Bucket changed, need sync for user {user_id}")
            logger.debug(f"   Old hash: {saved_bucket_hash[:8]}...")
            logger.debug(f"   New hash: {bucket_hash[:8]}...")
            return True

        logger.debug(f"✅ Bucket unchanged for user {user_id}")
        return False

    except Exception as e:
        logger.error(f"❌ Error checking sync status for user {user_id}: {e}")
        return True  # Sync on error to be safe


async def unzip_installed_plugins(user_id: str) -> Dict[str, Any]:
    """
    Unzip ONLY installed plugins from marketplace ZIP files.

    This is the key optimization: Instead of unzipping entire marketplace (20 plugins),
    only unzip the 2-3 plugins user actually installed.

    Flow:
    1. Get list of installed plugins from PostgreSQL
    2. Find corresponding marketplace ZIP files in S3
    3. Unzip ONLY the installed plugin directories

    Args:
        user_id: User's UUID

    Returns:
        {
            "success": bool,
            "unzipped_count": int,
            "message": str
        }
    """
    try:
        logger.info(f"📦 Unzipping installed plugins for user: {user_id}")

        # Get Supabase client
        supabase = get_supabase_client()

        # Get installed plugins from PostgreSQL
        result = supabase.table("installed_plugins").select("*").eq("user_id", user_id).eq("status", "active").execute()

        if not result.data:
            logger.info(f"ℹ️  No installed plugins found for user: {user_id}")
            logger.info(f"   💡 To unzip plugins, you need to install them first via the frontend")
            logger.info(f"   💡 Go to Integrations → Marketplace → Expand plugin → Install")
            return {
                "success": True,
                "unzipped_count": 0,
                "message": "No plugins to unzip (install plugins first via frontend)"
            }

        installed_plugins = result.data
        logger.info(f"📋 Found {len(installed_plugins)} installed plugins")
        for plugin in installed_plugins:
            logger.info(f"   - {plugin['plugin_name']} from {plugin['marketplace_name']}")

        # Get user workspace
        workspace_path = get_user_workspace_path(user_id)

        # Group plugins by marketplace
        plugins_by_marketplace = {}
        for plugin in installed_plugins:
            marketplace_name = plugin["marketplace_name"]
            if marketplace_name not in plugins_by_marketplace:
                plugins_by_marketplace[marketplace_name] = []
            plugins_by_marketplace[marketplace_name].append(plugin)

        unzipped_count = 0

        # Unzip plugins for each marketplace
        for marketplace_name, plugins in plugins_by_marketplace.items():
            # Get marketplace metadata from PostgreSQL
            logger.info(f"🔍 Looking for marketplace: {marketplace_name}")
            marketplace_result = supabase.table("marketplaces").select("*").eq("user_id", user_id).eq("name", marketplace_name).single().execute()

            if not marketplace_result.data:
                logger.warning(f"⚠️  Marketplace '{marketplace_name}' not found in database")
                logger.info(f"   💡 Available marketplaces:")
                all_marketplaces = supabase.table("marketplaces").select("name, zip_path").eq("user_id", user_id).execute()
                for mp in (all_marketplaces.data or []):
                    logger.info(f"      - {mp.get('name')} (ZIP: {mp.get('zip_path')})")
                continue

            # Get zip_path from database, or search in workspace
            zip_path = marketplace_result.data.get("zip_path")

            if not zip_path:
                logger.info(f"ℹ️  No ZIP path in database for marketplace: {marketplace_name}")
                logger.info(f"   Searching for local ZIP files in workspace...")

                # Search for ZIP files in marketplace directory
                marketplace_dir = workspace_path / ".claude" / "plugins" / "marketplaces" / marketplace_name
                if marketplace_dir.exists():
                    zip_files = list(marketplace_dir.glob("*.zip"))
                    if zip_files:
                        # Use first ZIP found
                        zip_path = str(zip_files[0].relative_to(workspace_path))
                        logger.info(f"✅ Found local ZIP: {zip_path}")
                    else:
                        logger.warning(f"⚠️  No ZIP file found in: {marketplace_dir}")
                        continue
                else:
                    logger.warning(f"⚠️  Marketplace directory not found: {marketplace_dir}")
                    continue

            logger.info(f"📦 Processing marketplace: {marketplace_name}")
            logger.info(f"   ZIP path: {zip_path}")
            logger.info(f"   Plugins to unzip: {[p['plugin_name'] for p in plugins]}")

            try:
                # Check if ZIP exists locally in workspace first
                local_zip_path = workspace_path / zip_path

                if local_zip_path.exists():
                    logger.info(f"✅ Using local ZIP file: {local_zip_path}")
                    zip_data = local_zip_path.read_bytes()
                else:
                    logger.info(f"⬇️  Downloading ZIP from S3: {zip_path}")
                    zip_data = supabase.storage.from_(user_id).download(zip_path)

                # Simply unzip entire marketplace ZIP
                import io
                with zipfile.ZipFile(io.BytesIO(zip_data)) as zip_ref:
                    # Get ZIP root folder name (e.g., "skills-main/")
                    zip_files = zip_ref.namelist()
                    if not zip_files:
                        continue

                    # Detect root folder
                    root_folder = zip_files[0].split('/')[0] + '/'
                    logger.info(f"📦 Unzipping marketplace: {marketplace_name}")
                    logger.info(f"   Root folder: {root_folder}")
                    logger.info(f"   Total files: {len(zip_files)}")

                    # Extract all files
                    marketplace_target = workspace_path / ".claude" / "plugins" / "marketplaces" / marketplace_name
                    marketplace_target.mkdir(parents=True, exist_ok=True)

                    for file_path in zip_files:
                        # Remove root folder from path (e.g., "skills-main/" -> "")
                        relative_path = file_path[len(root_folder):]
                        target_path = marketplace_target / relative_path

                        # Skip directories
                        if file_path.endswith('/'):
                            target_path.mkdir(parents=True, exist_ok=True)
                            continue

                        # Extract file
                        target_path.parent.mkdir(parents=True, exist_ok=True)
                        with zip_ref.open(file_path) as source:
                            target_path.write_bytes(source.read())

                    logger.info(f"✅ Unzipped all files to: {marketplace_target}")
                    unzipped_count += 1

            except Exception as e:
                logger.error(f"❌ Error unzipping marketplace {marketplace_name}: {e}")
                continue

        logger.info(f"✅ Unzipped {unzipped_count} plugins for user: {user_id}")

        return {
            "success": True,
            "unzipped_count": unzipped_count,
            "message": f"Unzipped {unzipped_count} installed plugins"
        }

    except Exception as e:
        logger.error(f"❌ Error unzipping plugins: {e}", exc_info=True)
        return {
            "success": False,
            "unzipped_count": 0,
            "message": f"Error: {str(e)}"
        }


async def sync_memory_to_workspace(user_id: str) -> Dict[str, Any]:
    """
    Sync CLAUDE.md content from PostgreSQL to workspace file.

    Fetches memory content from claude_memory table and writes to
    .claude/CLAUDE.md in user's workspace.

    Args:
        user_id: User's UUID

    Returns:
        Dictionary with sync results:
        {
            "success": True,
            "content_length": 1234,
            "message": "Memory synced to .claude/CLAUDE.md"
        }
    """
    try:
        logger.info(f"📝 Syncing CLAUDE.md for user: {user_id}")

        # Get workspace path
        workspace_path = get_user_workspace_path(user_id)

        # Ensure .claude directory exists
        claude_dir = workspace_path / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)

        # Get Supabase client
        supabase = get_supabase_client()

        # Fetch memory from PostgreSQL
        result = supabase.table("claude_memory").select("content").eq("user_id", user_id).execute()

        # Get content (empty string if no memory)
        content = ""
        if result.data and len(result.data) > 0:
            content = result.data[0].get("content", "")

        # Write to .claude/CLAUDE.md
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


async def sync_all_from_bucket(auth_token: str) -> Dict[str, Any]:
    """
    Sync ALL files from bucket to local workspace (simple bucket mirror).

    Downloads entire bucket and recreates exact directory structure locally.
    No complex filtering - just mirror everything from bucket to workspace.

    Args:
        auth_token: Supabase JWT token

    Returns:
        Dictionary with sync results:
        {
            "success": True,
            "skipped": False,
            "files_synced": 150,
            "files_failed": 0,
            "errors": [],
            "message": "Synced 150 files from bucket"
        }

    Example usage (in WebSocket handler):
        result = await sync_all_from_bucket(auth_token)
        if result["success"]:
            logger.info(f"Workspace synced: {result['message']}")
    """
    # Extract user ID
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        return {
            "success": False,
            "skipped": False,
            "message": "Invalid auth token"
        }

    logger.info(f"🔍 Checking sync status for user: {user_id}")

    # Check if sync needed
    if not await should_sync_bucket(user_id):
        logger.info(f"⏭️  Skipping bucket sync, unchanged for user: {user_id}")

        # Still sync CLAUDE.md from PostgreSQL (might have been updated)
        memory_result = await sync_memory_to_workspace(user_id)
        if memory_result["success"]:
            logger.info(f"✅ {memory_result['message']}")
        else:
            logger.warning(f"⚠️  Memory sync failed: {memory_result['message']}")

        return {
            "success": True,
            "skipped": True,
            "message": "Bucket unchanged (skipped), but synced CLAUDE.md from database"
        }

    logger.info(f"🔄 Starting full bucket sync for user: {user_id}")

    # Get bucket hash before sync
    bucket_hash = await get_bucket_hash(user_id)

    # Get workspace path
    workspace_path = get_user_workspace_path(user_id)
    workspace_path.mkdir(parents=True, exist_ok=True)

    try:
        # Get Supabase client
        supabase = get_supabase_client()

        # List ALL files in bucket (simple - no prefix filtering)
        all_files = await list_all_files_in_bucket(supabase, user_id)

        if not all_files:
            logger.info(f"ℹ️  No files found in bucket for user: {user_id}")
            return {
                "success": True,
                "skipped": False,
                "files_synced": 0,
                "message": "No files to sync"
            }

        logger.info(f"📋 Found {len(all_files)} files to sync from bucket")

        # Download each file and recreate exact directory structure
        synced_count = 0
        failed_count = 0
        errors = []

        for file_info in all_files:
            file_path = file_info.get("name", "")
            if not file_path:
                continue

            try:
                # Download file from bucket
                response = supabase.storage.from_(user_id).download(file_path)

                if not response:
                    failed_count += 1
                    errors.append(f"Failed to download: {file_path}")
                    continue

                # Create local file (mirror bucket structure exactly)
                local_file = workspace_path / file_path

                # Ensure parent directory exists
                local_file.parent.mkdir(parents=True, exist_ok=True)

                # Write file to local workspace
                local_file.write_bytes(response)

                synced_count += 1
                logger.debug(f"✅ Synced: {file_path}")

            except Exception as e:
                failed_count += 1
                error_msg = f"Error syncing {file_path}: {str(e)}"
                errors.append(error_msg)
                logger.error(f"❌ {error_msg}")

        # Calculate new local hash
        local_hash = await get_local_workspace_hash(user_id)

        # Save sync state
        save_sync_state(user_id, bucket_hash, local_hash)

        # Sync CLAUDE.md from PostgreSQL to workspace
        memory_result = await sync_memory_to_workspace(user_id)
        if memory_result["success"]:
            logger.info(f"✅ {memory_result['message']}")
        else:
            logger.warning(f"⚠️  Memory sync failed: {memory_result['message']}")

        logger.info(
            f"🏁 Full sync completed for user {user_id}: "
            f"{synced_count} synced, {failed_count} failed"
        )

        return {
            "success": failed_count == 0,
            "skipped": False,
            "files_synced": synced_count,
            "files_failed": failed_count,
            "errors": errors,
            "message": f"Synced {synced_count} files from bucket + CLAUDE.md from database"
        }

    except Exception as e:
        error_msg = f"Bucket sync failed: {str(e)}"
        logger.error(f"❌ {error_msg}")
        return {
            "success": False,
            "skipped": False,
            "files_synced": 0,
            "message": error_msg
        }


async def handle_bucket_sync_on_connect(auth_token: str, websocket) -> bool:
    """
    Handle bucket sync on WebSocket connect and send status to client.

    This is a convenience function that wraps sync_all_from_bucket()
    and handles WebSocket messaging for you.

    Args:
        auth_token: Supabase JWT token
        websocket: FastAPI WebSocket instance

    Returns:
        True if sync succeeded or skipped, False if failed

    Example usage (in WebSocket handler):
        if auth_token and not sync_checked:
            sync_checked = True
            await handle_bucket_sync_on_connect(auth_token, websocket)
    """
    logger.info("🔍 Checking bucket sync status...")

    try:
        sync_result = await sync_all_from_bucket(auth_token)

        # Helper function to safely send to WebSocket
        async def safe_send(data: dict) -> bool:
            """Send data to WebSocket only if connection is still open."""
            try:
                # Check if WebSocket is still connected
                if hasattr(websocket, 'client_state'):
                    from starlette.websockets import WebSocketState
                    if websocket.client_state != WebSocketState.CONNECTED:
                        logger.debug("⚠️ WebSocket closed, skipping sync status send")
                        return False

                await websocket.send_json(data)
                return True
            except Exception as e:
                logger.debug(f"⚠️ Failed to send sync status (connection closed): {e}")
                return False

        if sync_result["success"]:
            if sync_result.get("skipped"):
                logger.info("⏭️  Bucket sync skipped (unchanged)")
                await safe_send({
                    "type": "sync_status",
                    "status": "skipped",
                    "message": sync_result["message"]
                })
            else:
                logger.info(f"✅ Bucket synced: {sync_result['message']}")
                await safe_send({
                    "type": "sync_status",
                    "status": "synced",
                    "message": sync_result["message"],
                    "files_synced": sync_result.get("files_synced", 0),
                    "files_failed": sync_result.get("files_failed", 0)
                })
            return True
        else:
            logger.warning(f"⚠️  Bucket sync failed: {sync_result.get('message')}")
            await safe_send({
                "type": "sync_status",
                "status": "failed",
                "message": sync_result.get("message", "Sync failed")
            })
            return False

    except Exception as sync_error:
        logger.error(f"❌ Error during bucket sync: {sync_error}", exc_info=True)
        try:
            await safe_send({
                "type": "sync_status",
                "status": "error",
                "message": f"Sync error: {str(sync_error)}"
            })
        except:
            pass  # Already logged, connection likely closed
        return False
