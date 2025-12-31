"""
Supabase Storage & Database Utility

This module handles:
1. MCP servers from PostgreSQL (user_mcp_servers table) - PRIMARY SOURCE
2. Skills sync from Supabase Storage bucket
3. Plugins sync from Supabase Storage bucket
4. Hash-based sync to avoid unnecessary downloads
5. User workspace management

NOTE: MCP servers are now stored in PostgreSQL, NOT object storage.
Use get_user_mcp_servers() to load MCP servers from database.
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
from database_util import execute_query
from config import config

logger = logging.getLogger(__name__)

MCP_FILE_NAME = ".mcp.json"
CLAUDE_SKILLS_DIR = ".claude/skills"  # Skills location in both bucket and workspace
CLAUDE_PLUGINS_DIR = ".claude/plugins"  # Plugins location in both bucket and workspace

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
    if not config.supabase_url:
        raise ValueError("SUPABASE_URL environment variable not set")

    if not config.supabase_service_role_key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable not set")

    return create_client(config.supabase_url, config.supabase_service_role_key)


def ensure_user_bucket_exists(user_id: str) -> bool:
    """
    Ensure user's storage bucket exists in Supabase Storage.
    Creates the bucket if it doesn't exist.

    Args:
        user_id: User's UUID (used as bucket name)

    Returns:
        True if bucket exists or was created successfully
    """
    if not user_id:
        logger.warning("No user_id provided for bucket check")
        return False

    try:
        supabase = get_supabase_client()

        # Try to list buckets and check if user's bucket exists
        buckets = supabase.storage.list_buckets()
        bucket_names = [b.name for b in buckets]

        if user_id in bucket_names:
            logger.debug(f"✅ Bucket already exists: {user_id}")
            return True

        # Create bucket for user
        logger.info(f"📦 Creating storage bucket for user: {user_id}")
        supabase.storage.create_bucket(
            user_id,
            options={
                "public": False,
                "file_size_limit": 52428800,  # 50MB
            }
        )
        logger.info(f"✅ Created storage bucket: {user_id}")
        return True

    except Exception as e:
        # Bucket might already exist (race condition) - that's OK
        if "already exists" in str(e).lower() or "duplicate" in str(e).lower():
            logger.debug(f"Bucket already exists: {user_id}")
            return True
        logger.error(f"❌ Failed to ensure bucket exists for {user_id}: {e}")
        return False


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
    Extract and VERIFY user ID from Supabase JWT token.

    SECURITY: This function verifies JWT signature using either:
    - ES256/RS256: JWKS public key from Supabase (new default)
    - HS256: JWT secret (legacy fallback)

    Args:
        auth_token: JWT token from Supabase Auth

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

        # Decode header to check algorithm
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")
        kid = header.get("kid")

        logger.debug(f"Token algorithm: {alg}, kid: {kid}")

        # For ES256/RS256 (asymmetric), use JWKS public key verification
        if alg in ["ES256", "RS256"] and kid and config.supabase_url:
            decoded = _verify_with_jwks(token, alg, kid)
        # For HS256 (symmetric), use JWT secret
        elif alg == "HS256" and config.supabase_jwt_secret:
            decoded = jwt.decode(
                token,
                config.supabase_jwt_secret,
                algorithms=["HS256"],
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_aud": False,
                }
            )
        else:
            logger.warning(f"⚠️ Cannot verify token: alg={alg}, has_secret={bool(config.supabase_jwt_secret)}, has_url={bool(config.supabase_url)}")
            return None

        # Extract user ID from 'sub' claim
        user_id = decoded.get("sub")

        if user_id:
            logger.debug(f"✅ Verified token for user_id: {user_id}")
            return user_id
        else:
            logger.warning("⚠️ Token does not contain 'sub' claim")
            return None

    except jwt.ExpiredSignatureError:
        logger.warning("⚠️ Token has expired")
        return None
    except jwt.InvalidSignatureError:
        logger.warning("🚨 Invalid token signature - possible forgery attempt!")
        return None
    except jwt.DecodeError as e:
        logger.warning(f"⚠️ Failed to decode JWT token: {type(e).__name__}")
        return None
    except Exception as e:
        logger.error(f"❌ Unexpected error verifying token: {type(e).__name__}: {e}")
        return None


# Cache for JWKS keys (10 min TTL per Supabase docs)
_jwks_cache: Dict[str, Any] = {}
_jwks_cache_time: float = 0
JWKS_CACHE_TTL = 600  # 10 minutes


def _verify_with_jwks(token: str, alg: str, kid: str) -> Dict[str, Any]:
    """
    Verify JWT using JWKS public key from Supabase.

    Args:
        token: JWT token string
        alg: Algorithm (ES256 or RS256)
        kid: Key ID from token header

    Returns:
        Decoded token payload

    Raises:
        jwt.InvalidSignatureError: If signature verification fails
    """
    import httpx
    import time
    from jwt.algorithms import ECAlgorithm, RSAAlgorithm

    global _jwks_cache, _jwks_cache_time

    # Check cache
    current_time = time.time()
    if current_time - _jwks_cache_time > JWKS_CACHE_TTL:
        _jwks_cache = {}
        _jwks_cache_time = current_time

    # Get public key from cache or fetch from JWKS
    cache_key = f"{alg}:{kid}"
    if cache_key not in _jwks_cache:
        # Fetch JWKS from Supabase
        jwks_url = f"{config.supabase_url}/auth/v1/.well-known/jwks.json"
        logger.debug(f"Fetching JWKS from: {jwks_url}")

        response = httpx.get(jwks_url, timeout=10)
        response.raise_for_status()
        jwks = response.json()

        # Find key by kid
        key_data = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                key_data = key
                break

        if not key_data:
            raise jwt.InvalidSignatureError(f"Key ID {kid} not found in JWKS")

        # Convert JWK to public key
        if alg == "ES256" and key_data.get("kty") == "EC":
            public_key = ECAlgorithm.from_jwk(key_data)
        elif alg == "RS256" and key_data.get("kty") == "RSA":
            public_key = RSAAlgorithm.from_jwk(key_data)
        else:
            raise jwt.InvalidSignatureError(f"Unsupported key type: {key_data.get('kty')} for algorithm {alg}")

        _jwks_cache[cache_key] = public_key
        logger.debug(f"Cached public key for {cache_key}")

    # Verify token with public key
    return jwt.decode(
        token,
        _jwks_cache[cache_key],
        algorithms=[alg],
        options={
            "verify_signature": True,
            "verify_exp": True,
            "verify_iat": True,
            "verify_aud": False,
        }
    )


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


async def get_user_mcp_servers(auth_token: str = "", user_id: str = "") -> Dict[str, Any]:
    """
    Get MCP servers configuration from PostgreSQL database (instant, no S3 lag).

    NEW APPROACH (Fast & Reliable):
    - Reads from PostgreSQL user_mcp_servers table
    - No S3 download required
    - Instant access, no lag
    - Frontend saves directly to PostgreSQL
    - Supports all three server types: stdio, sse, http

    Args:
        auth_token: Supabase JWT token (for unsecure flow)
        user_id: User ID directly (for secure/Zero-Trust flow, takes priority)

    Returns:
        Dictionary of MCP servers ready to pass to ClaudeAgentOptions
        Empty dict if no servers found (safe for mcp_servers.update())

    Example usage (unsecure flow):
        user_mcp_servers = await get_user_mcp_servers(auth_token=auth_token)

    Example usage (secure/Zero-Trust flow):
        user_mcp_servers = await get_user_mcp_servers(user_id=user_id)

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
    # Secure flow provides user_id directly (from Zero-Trust certificate)
    # Unsecure flow provides auth_token (JWT)
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
        config = {
            "mcpServers": mcp_servers,
            "metadata": {
                "version": "1.0.0",
                "updatedAt": datetime.now().isoformat(),
                "syncedFrom": "postgresql"
            }
        }
        
        # Save to local .mcp.json file
        save_config_to_file(user_id, config)
        
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
            # install_path is relative to workspace root (e.g., ".claude/plugins/marketplaces/anthropics-skills/document-skills/xlsx")
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


# ============================================================
# PLUGIN VERIFICATION (Git-based approach)
# ============================================================
# NOTE: Plugins are now cloned via git, not synced from bucket.
# Use unzip_installed_plugins() to verify plugins exist in workspace.


async def unzip_installed_plugins(user_id: str) -> Dict[str, Any]:
    """
    Verify installed plugins exist in workspace, auto-cloning marketplaces if missing.

    Git-based approach (v2):
    - Plugin files are already in workspace from git clone
    - If marketplace not cloned, automatically clone it from repository_url
    - Re-verify plugin after cloning

    Legacy ZIP support:
    - Falls back to ZIP extraction if marketplace has zip_path
    - For backwards compatibility with old installations

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
            import os
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
        from database_util import execute_query

        # Query user_allowed_tools table using raw SQL
        # Schema: id, user_id, tool_name, created_at
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
        from database_util import execute_query

        # Use UPSERT pattern - INSERT with ON CONFLICT DO NOTHING
        # This handles both new inserts and existing records in one query
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
        from database_util import execute_query

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

