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
SKILLS_DIR = "skills"
CLAUDE_SKILLS_DIR = ".claude/skills"

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
    Get MCP servers configuration from user's local workspace.

    NOTE: This function now reads from local .mcp.json file that was
    already synced by sync_all_from_bucket(). No need to download again.

    Flow:
    1. Frontend calls /api/sync-bucket (syncs .mcp.json to workspace)
    2. WebSocket connects
    3. This function reads .mcp.json from local workspace
    4. Returns MCP servers for agent initialization

    Args:
        auth_token: Supabase JWT token

    Returns:
        Dictionary of MCP servers ready to pass to ClaudeAgentOptions
        Empty dict if file not found (safe for mcp_servers.update())

    Example usage:
        user_mcp_servers = await get_user_mcp_servers(auth_token)
        options = ClaudeAgentOptions(
            mcp_servers={"incident_tools": incident_tools, **user_mcp_servers},
            ...
        )
    """
    # Extract user ID from token
    user_id = extract_user_id_from_token(auth_token)

    if not user_id:
        logger.warning("Could not extract user_id from auth token")
        return {}

    # Get workspace path
    workspace = get_user_workspace_path(user_id)
    mcp_file = Path(workspace) / ".mcp.json"

    # Check if file exists (already synced by sync_all_from_bucket)
    if not mcp_file.exists():
        logger.debug(f"ℹ️  No .mcp.json found in workspace: {workspace}")
        return {}

    try:
        # Read and parse local file
        with open(mcp_file, 'r', encoding='utf-8') as f:
            config = json.load(f)

        # Parse and return MCP servers
        mcp_servers = parse_mcp_servers(config)
        logger.debug(f"✅ Loaded {len(mcp_servers)} MCP servers from: {mcp_file}")
        return mcp_servers

    except Exception as e:
        logger.error(f"❌ Failed to read .mcp.json from {mcp_file}: {e}")
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


# ============================================================
# SKILL STORAGE FUNCTIONS
# ============================================================


async def list_skill_files(user_id: str) -> List[Dict[str, Any]]:
    """
    List all skill files in user's Supabase Storage bucket.

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
        logger.info(f"📋 Listing skill files for user: {user_id}")

        # Create Supabase client
        supabase = get_supabase_client()

        # List files in skills/ directory
        response = supabase.storage.from_(user_id).list(SKILLS_DIR, {
            "limit": 100,
            "offset": 0,
            "sortBy": {"column": "created_at", "order": "desc"}
        })

        if not response:
            logger.info(f"⚠️  No skills directory found for user: {user_id}")
            return []

        # Filter only .skill and .zip files
        skill_files = [
            file for file in response
            if file.get("name", "").endswith((".skill", ".zip"))
        ]

        logger.info(f"✅ Found {len(skill_files)} skill files for user: {user_id}")
        return skill_files

    except Exception as e:
        logger.error(f"❌ Failed to list skill files for user {user_id}: {e}")
        return []


async def download_skill_file(user_id: str, skill_filename: str) -> Optional[bytes]:
    """
    Download a single skill file from user's Supabase Storage bucket.

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
        logger.info(f"📥 Downloading skill file: {skill_filename} for user: {user_id}")

        # Create Supabase client
        supabase = get_supabase_client()

        # Download file from skills/ directory
        skill_path = f"{SKILLS_DIR}/{skill_filename}"
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
    Sync all skill files from Supabase Storage to user's workspace.

    This is the main function to sync skills. It handles:
    1. Extract user_id from auth token
    2. List all skill files in Supabase Storage
    3. Download each skill file
    4. Extract/copy to .claude/skills directory

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


async def get_bucket_files_metadata(user_id: str) -> List[Dict[str, Any]]:
    """
    Get metadata of all files in user's bucket (MCP config + skills).

    Args:
        user_id: User's UUID

    Returns:
        List of file metadata with name, size, updated_at

    Example:
        [
            {"name": ".mcp.json", "size": 1024, "updated_at": "2025-11-03..."},
            {"name": "skills/my-skill.skill", "size": 2048, "updated_at": "..."}
        ]
    """
    if not user_id:
        return []

    try:
        supabase = get_supabase_client()

        # Get all files in bucket root
        all_files = []

        # Get MCP config file
        try:
            root_files = supabase.storage.from_(user_id).list("", {"limit": 100})
            if root_files:
                all_files.extend(root_files)
        except Exception as e:
            logger.debug(f"No root files: {e}")

        # Get skill files
        try:
            skill_files = supabase.storage.from_(user_id).list(SKILLS_DIR, {"limit": 100})
            if skill_files:
                # Add skills/ prefix to names
                for f in skill_files:
                    f["name"] = f"{SKILLS_DIR}/{f['name']}"
                all_files.extend(skill_files)
        except Exception as e:
            logger.debug(f"No skill files: {e}")

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


async def sync_all_from_bucket(auth_token: str) -> Dict[str, Any]:
    """
    Sync all files (MCP config + skills) from bucket to local workspace.

    This is the main function to call on WebSocket connect.
    It checks if sync is needed and downloads everything if needed.

    Args:
        auth_token: Supabase JWT token

    Returns:
        Dictionary with sync results:
        {
            "success": True,
            "skipped": False,
            "mcp_synced": True,
            "skills_synced": 3,
            "message": "Synced successfully"
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
        logger.info(f"⏭️  Skipping sync, bucket unchanged for user: {user_id}")
        return {
            "success": True,
            "skipped": True,
            "message": "Bucket unchanged, skipped sync"
        }

    logger.info(f"🔄 Starting full sync for user: {user_id}")

    # Get bucket hash before sync
    bucket_hash = await get_bucket_hash(user_id)

    # Sync MCP config
    mcp_synced = False
    try:
        config = await download_mcp_config(user_id)
        if config:
            mcp_synced = True
            logger.info(f"✅ MCP config synced")
    except Exception as e:
        logger.warning(f"⚠️  MCP config sync failed: {e}")

    # Sync skills
    skills_result = await sync_user_skills(auth_token)
    skills_synced = skills_result.get("synced_count", 0)

    # Calculate new local hash
    local_hash = await get_local_workspace_hash(user_id)

    # Save sync state
    save_sync_state(user_id, bucket_hash, local_hash)

    logger.info(
        f"🏁 Full sync completed for user {user_id}: "
        f"MCP={'✅' if mcp_synced else '❌'}, Skills={skills_synced}"
    )

    return {
        "success": True,
        "skipped": False,
        "mcp_synced": mcp_synced,
        "skills_synced": skills_synced,
        "message": f"Synced successfully: MCP + {skills_synced} skills"
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
                    "mcp_synced": sync_result.get("mcp_synced"),
                    "skills_synced": sync_result.get("skills_synced")
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
