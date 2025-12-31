"""
Marketplace and plugins routes for AI Agent API.

Handles:
- POST /api/marketplace/install-plugin - Install plugin from marketplace
- POST /api/plugins/install - Install plugin (legacy)
- POST /api/marketplace/fetch-metadata - Fetch marketplace metadata from GitHub
- POST /api/marketplace/clone - Clone marketplace repository (git clone)
- POST /api/marketplace/update - Update marketplace repository (git fetch)
- DELETE /api/marketplace/{marketplace_name} - Delete marketplace

Git-based approach (v2):
- Clone repository once, fetch to update
- No ZIP files, no S3 storage for marketplace files
- Faster updates (incremental via git)
"""

import asyncio
import base64
import json
import logging
import re
import shutil
from asyncio import Lock
from datetime import datetime

import httpx
from fastapi import APIRouter, Request

from supabase_storage import (
    extract_user_id_from_token,
    get_supabase_client,
    get_user_workspace_path,
)
from database_util import execute_query, ensure_user_exists, extract_user_info_from_token
from git_utils import (
    build_github_url,
    clone_repository,
    fetch_and_reset,
    get_current_commit,
    get_marketplace_dir,
    is_git_repository,
    remove_repository,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["marketplace"])

# Per-user locks to prevent race conditions when installing plugins
user_plugin_locks = {}

_MARKETPLACE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")


def _is_valid_marketplace_name(name: str) -> bool:
    """
    Validate a marketplace name to prevent path traversal and invalid characters.

    Allows only letters, digits, underscore, dash, and dot, and disallows
    path separators or empty strings.
    """
    if not name:
        return False
    return bool(_MARKETPLACE_NAME_PATTERN.fullmatch(name))


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """Sanitize error messages to prevent information disclosure."""
    logger.error(f"Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)
    return f"An error occurred {context}. Please try again."


@router.post("/marketplace/install-plugin")
async def install_plugin_from_marketplace(request: Request):
    """
    Mark a plugin as installed from a git-cloned marketplace.

    In the git-based approach, plugin files are already in the workspace
    from the initial git clone. This endpoint only records the installation
    in PostgreSQL so load_user_plugins() knows which plugins to load.

    Request body:
        {
            "auth_token": "Bearer ...",
            "marketplace_name": "anthropic-agent-skills",
            "plugin_name": "internal-comms",
            "version": "1.0.0"
        }

    Returns:
        {
            "success": bool,
            "message": str,
            "plugin": {...}
        }
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        marketplace_name = body.get("marketplace_name")
        plugin_name = body.get("plugin_name")
        version = body.get("version", "1.0.0")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not all([marketplace_name, plugin_name]):
            return {
                "success": False,
                "error": "Missing required fields: marketplace_name, plugin_name",
            }

        if not _is_valid_marketplace_name(marketplace_name):
            return {
                "success": False,
                "error": f"Invalid marketplace name: {marketplace_name}",
            }

        user_id = extract_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Installing plugin {plugin_name} from {marketplace_name}")

        # Ensure user exists in users table (required for foreign key)
        user_info = extract_user_info_from_token(auth_token)
        ensure_user_exists(
            user_id,
            email=user_info.get("email") if user_info else None,
            name=user_info.get("name") if user_info else None
        )

        # Get marketplace metadata from PostgreSQL
        def get_marketplace_metadata_sync():
            try:
                result = execute_query(
                    "SELECT * FROM marketplaces WHERE user_id = %s AND name = %s",
                    (user_id, marketplace_name),
                    fetch="one"
                )
                return result
            except Exception as e:
                logger.error(f"Failed to fetch marketplace from PostgreSQL: {e}")
            return None

        marketplace_record = await asyncio.get_event_loop().run_in_executor(
            None, get_marketplace_metadata_sync
        )

        if not marketplace_record:
            return {
                "success": False,
                "error": f"Marketplace '{marketplace_name}' not found. Please clone it first.",
            }

        # Verify git repository exists
        workspace_path = get_user_workspace_path(user_id)
        marketplace_dir = get_marketplace_dir(workspace_path, marketplace_name)

        if not await is_git_repository(marketplace_dir):
            return {
                "success": False,
                "error": f"Marketplace '{marketplace_name}' not cloned. Please clone it first.",
            }

        # Calculate install path from marketplace metadata
        install_path = f".claude/plugins/marketplaces/{marketplace_name}/{plugin_name}"

        if marketplace_record.get("plugins"):
            for plugin_def in marketplace_record["plugins"]:
                if plugin_def.get("name") == plugin_name:
                    source_path = plugin_def.get("source", "./")
                    logger.info(f"Found plugin '{plugin_name}' with source: {source_path}")

                    source_path_clean = source_path.replace("./", "")

                    if source_path_clean:
                        install_path = f".claude/plugins/marketplaces/{marketplace_name}/{source_path_clean}"
                    else:
                        install_path = f".claude/plugins/marketplaces/{marketplace_name}"

                    logger.info(f"Calculated install path: {install_path}")
                    break
            else:
                logger.warning(f"Plugin '{plugin_name}' not found in marketplace metadata")

        # Verify plugin directory exists in git repo
        plugin_full_path = workspace_path / install_path
        if not plugin_full_path.exists():
            logger.warning(f"Plugin directory not found: {plugin_full_path}")
            # Don't fail - plugin might use different structure

        # Record installation in PostgreSQL
        def add_to_db_sync():
            # Get current git commit for version tracking
            commit_sha = marketplace_record.get("git_commit_sha", "unknown")

            plugin_record = {
                "user_id": user_id,
                "plugin_name": plugin_name,
                "marketplace_name": marketplace_name,
                "version": version,
                "install_path": install_path,
                "status": "active",
                "is_local": False,
                "git_commit_sha": commit_sha,
            }

            execute_query(
                """
                INSERT INTO installed_plugins (user_id, plugin_name, marketplace_name, version, install_path, status, is_local)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, plugin_name, marketplace_name) DO UPDATE SET
                    version = EXCLUDED.version,
                    install_path = EXCLUDED.install_path,
                    status = EXCLUDED.status,
                    is_local = EXCLUDED.is_local,
                    updated_at = NOW()
                """,
                (user_id, plugin_name, marketplace_name, version, install_path, "active", False),
                fetch="none"
            )

            return plugin_record

        plugin_record = await asyncio.get_event_loop().run_in_executor(
            None, add_to_db_sync
        )
        logger.info("Plugin marked as installed in PostgreSQL")

        return {
            "success": True,
            "message": f"Plugin '{plugin_name}' installed successfully",
            "plugin": plugin_record,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "installing plugin from marketplace")
        }


@router.post("/plugins/install")
async def install_plugin(request: Request):
    """
    Install a plugin to user's installed_plugins.json.

    Uses per-user lock to serialize access and prevent race conditions.

    Request body:
        {
            "auth_token": "Bearer ...",
            "plugin": {
                "name": "skill-name",
                "marketplaceName": "anthropic-agent-skills",
                "version": "1.0.0",
                "installPath": "...",
                "isLocal": false
            }
        }

    Returns:
        {"success": bool, "message": str, "pluginKey": str}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        plugin = body.get("plugin", {})

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not plugin or not plugin.get("name") or not plugin.get("marketplaceName"):
            return {
                "success": False,
                "error": "Missing required plugin fields: name, marketplaceName",
            }

        if not _is_valid_marketplace_name(plugin.get("marketplaceName")):
            return {
                "success": False,
                "error": f"Invalid marketplace name: {plugin.get('marketplaceName')}",
            }

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        if user_id not in user_plugin_locks:
            user_plugin_locks[user_id] = Lock()

        user_lock = user_plugin_locks[user_id]

        logger.info(f"Acquiring lock for user {user_id} to install plugin: {plugin['name']}")

        async with user_lock:
            logger.info(f"Lock acquired for user {user_id}")

            supabase = get_supabase_client()
            plugins_json_path = ".claude/plugins/installed_plugins.json"

            try:
                response = supabase.storage.from_(user_id).download(plugins_json_path)
                current_data = json.loads(response)
                plugins = current_data.get("plugins", {})
            except Exception as e:
                logger.info(f"No installed_plugins.json found, creating new: {e}")
                plugins = {}

            plugin_key = f"{plugin['name']}@{plugin['marketplaceName']}"
            now = datetime.utcnow().isoformat() + "Z"

            if plugin_key in plugins:
                logger.info(f"Updating existing plugin: {plugin_key}")
                plugins[plugin_key] = {
                    **plugins[plugin_key],
                    "version": plugin.get("version", plugins[plugin_key].get("version", "unknown")),
                    "lastUpdated": now,
                    "installPath": plugin.get("installPath", plugins[plugin_key].get("installPath", "")),
                    "gitCommitSha": plugin.get("gitCommitSha", plugins[plugin_key].get("gitCommitSha")),
                    "isLocal": plugin.get("isLocal", plugins[plugin_key].get("isLocal", False)),
                }
            else:
                logger.info(f"Adding new plugin: {plugin_key}")
                plugins[plugin_key] = {
                    "version": plugin.get("version", "unknown"),
                    "installedAt": now,
                    "lastUpdated": now,
                    "installPath": plugin.get(
                        "installPath",
                        f".claude/plugins/marketplaces/{plugin['marketplaceName']}/{plugin['name']}",
                    ),
                    "isLocal": plugin.get("isLocal", False),
                }

                if plugin.get("gitCommitSha"):
                    plugins[plugin_key]["gitCommitSha"] = plugin["gitCommitSha"]

            updated_data = {"version": 1, "plugins": plugins}
            json_blob = json.dumps(updated_data, indent=2).encode("utf-8")

            supabase.storage.from_(user_id).upload(
                path=plugins_json_path,
                file=json_blob,
                file_options={"content-type": "application/json", "upsert": "true"},
            )

            logger.info(f"Plugin installed successfully: {plugin_key}")

        logger.info(f"Lock released for user {user_id}")

        logger.info(f"Unzipping plugin to local workspace for user {user_id}...")
        unzip_result = await unzip_installed_plugins(user_id)

        if unzip_result["success"]:
            logger.info(f"Plugin unzipped to local: {unzip_result['message']}")
        else:
            logger.warning(f"Failed to unzip plugin: {unzip_result['message']}")

        return {
            "success": True,
            "message": f"Plugin {plugin['name']} installed successfully",
            "pluginKey": plugin_key,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "installing plugin")
        }


@router.post("/marketplace/fetch-metadata")
async def fetch_marketplace_metadata(request: Request):
    """
    Fetch marketplace metadata from GitHub API (lightweight, fast!).

    Request body:
        {
            "auth_token": "Bearer ...",
            "owner": "anthropics",
            "repo": "skills",
            "branch": "main",
            "marketplace_name": "anthropic-agent-skills"
        }

    Returns:
        {"success": bool, "message": str, "marketplace": {...}}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        owner = body.get("owner")
        repo = body.get("repo")
        branch = body.get("branch", "main")
        marketplace_name = body.get("marketplace_name") or f"{owner}-{repo}"

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not owner or not repo:
            return {"success": False, "error": "Missing required fields: owner, repo"}

        if marketplace_name and not _is_valid_marketplace_name(marketplace_name):
            return {
                "success": False,
                "error": f"Invalid marketplace name: {marketplace_name}",
            }

        try:
            user_id = extract_user_id_from_token(auth_token)
            logger.info(f"User {user_id}: Fetching metadata for {owner}/{repo}@{branch}")
        except Exception as e:
            return {"success": False, "error": f"Invalid auth token: {str(e)}"}

        # Ensure user exists in users table (required for foreign key)
        user_info = extract_user_info_from_token(auth_token)
        ensure_user_exists(
            user_id,
            email=user_info.get("email") if user_info else None,
            name=user_info.get("name") if user_info else None
        )

        marketplace_json_url = f"https://api.github.com/repos/{owner}/{repo}/contents/.claude-plugin/marketplace.json?ref={branch}"
        repository_url = f"https://github.com/{owner}/{repo}"

        logger.info(f"Fetching marketplace.json from GitHub API: {marketplace_json_url}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                marketplace_json_url,
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "SLAR-Marketplace-Client",
                },
            )

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Failed to fetch marketplace.json: HTTP {response.status_code}",
                }

            github_response = response.json()
            marketplace_json_content = base64.b64decode(
                github_response["content"]
            ).decode("utf-8")
            marketplace_metadata = json.loads(marketplace_json_content)

        logger.info(f"Fetched marketplace.json ({len(marketplace_json_content)} bytes)")
        logger.info(f"   Marketplace: {marketplace_metadata.get('name')}")
        logger.info(f"   Plugins: {len(marketplace_metadata.get('plugins', []))}")

        logger.info("Saving marketplace metadata to PostgreSQL...")

        def save_to_db_sync():
            marketplace_record = {
                "user_id": user_id,
                "name": marketplace_name,
                "repository_url": repository_url,
                "branch": branch,
                "display_name": marketplace_metadata.get("name", marketplace_name),
                "description": marketplace_metadata.get("description"),
                "version": marketplace_metadata.get("version", "1.0.0"),
                "plugins": marketplace_metadata.get("plugins", []),
                "status": "active",
            }

            execute_query(
                """
                INSERT INTO marketplaces (user_id, name, repository_url, branch, display_name, description, version, plugins, status, last_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (user_id, name) DO UPDATE SET
                    repository_url = EXCLUDED.repository_url,
                    branch = EXCLUDED.branch,
                    display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    version = EXCLUDED.version,
                    plugins = EXCLUDED.plugins,
                    status = EXCLUDED.status,
                    last_synced_at = NOW(),
                    updated_at = NOW()
                """,
                (
                    user_id, marketplace_name, repository_url, branch,
                    marketplace_record["display_name"], marketplace_record["description"],
                    marketplace_record["version"], json.dumps(marketplace_record["plugins"]),
                    "active"
                ),
                fetch="none"
            )

            return marketplace_record

        db_record = await asyncio.get_event_loop().run_in_executor(
            None, save_to_db_sync
        )
        logger.info("Marketplace metadata saved to PostgreSQL")

        return {
            "success": True,
            "message": f"Marketplace '{marketplace_name}' metadata fetched successfully",
            "marketplace": db_record,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "fetching marketplace metadata")
        }


@router.post("/marketplace/clone")
async def clone_marketplace(request: Request):
    """
    Clone a GitHub repository as a marketplace using git clone.

    This replaces the old ZIP-based download approach with git clone.
    Benefits:
    - Incremental updates via git fetch (much faster)
    - No need to store ZIP files in S3
    - Native git tooling for versioning

    Request body:
        {
            "auth_token": "Bearer ...",
            "owner": "anthropics",
            "repo": "skills",
            "branch": "main",
            "marketplace_name": "anthropic-agent-skills"
        }

    Returns:
        {"success": bool, "message": str, "marketplace": {...}}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        owner = body.get("owner")
        repo = body.get("repo")
        branch = body.get("branch", "main")
        marketplace_name = body.get("marketplace_name") or f"{owner}-{repo}"

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not owner or not repo:
            return {"success": False, "error": "Missing required fields: owner, repo"}

        if marketplace_name and not _is_valid_marketplace_name(marketplace_name):
            return {
                "success": False,
                "error": f"Invalid marketplace name: {marketplace_name}",
            }

        try:
            user_id = extract_user_id_from_token(auth_token)
            logger.info(f"User {user_id}: Cloning {owner}/{repo}@{branch}")
        except Exception as e:
            return {"success": False, "error": f"Invalid auth token: {str(e)}"}

        # Ensure user exists in users table (required for foreign key)
        user_info = extract_user_info_from_token(auth_token)
        if not ensure_user_exists(
            user_id,
            email=user_info.get("email") if user_info else None,
            name=user_info.get("name") if user_info else None
        ):
            logger.warning(f"Failed to ensure user exists: {user_id}")
            # Continue anyway - the user might already exist

        # Build paths
        workspace_path = get_user_workspace_path(user_id)
        marketplace_dir = get_marketplace_dir(workspace_path, marketplace_name)
        repo_url = build_github_url(owner, repo)
        repository_url = f"https://github.com/{owner}/{repo}"

        logger.info(f"Cloning {repo_url} -> {marketplace_dir}")

        # Clone the repository
        success, result = await clone_repository(
            repo_url=repo_url,
            target_dir=marketplace_dir,
            branch=branch,
            depth=1  # Shallow clone for efficiency
        )

        if not success:
            return {
                "success": False,
                "error": f"Failed to clone repository: {result}",
            }

        commit_sha = result
        logger.info(f"Repository cloned successfully (commit: {commit_sha[:8]})")

        # Read marketplace.json from cloned repo
        marketplace_json_path = marketplace_dir / ".claude-plugin" / "marketplace.json"
        marketplace_metadata = None

        if marketplace_json_path.exists():
            try:
                marketplace_metadata = json.loads(marketplace_json_path.read_text())
                logger.info(f"Parsed marketplace.json: {marketplace_metadata.get('name')}")
            except Exception as e:
                logger.warning(f"Failed to parse marketplace.json: {e}")

        if not marketplace_metadata:
            marketplace_metadata = {
                "name": marketplace_name,
                "version": "unknown",
                "plugins": [],
            }

        # Save to PostgreSQL
        logger.info("Saving marketplace metadata to PostgreSQL...")

        def save_to_db_sync():
            marketplace_record = {
                "user_id": user_id,
                "name": marketplace_name,
                "repository_url": repository_url,
                "branch": branch,
                "display_name": marketplace_metadata.get("name", marketplace_name),
                "description": marketplace_metadata.get("description"),
                "version": marketplace_metadata.get("version", "unknown"),
                "plugins": marketplace_metadata.get("plugins", []),
                "git_commit_sha": commit_sha,
                "status": "active",
            }

            execute_query(
                """
                INSERT INTO marketplaces (user_id, name, repository_url, branch, display_name, description, version, plugins, git_commit_sha, status, last_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (user_id, name) DO UPDATE SET
                    repository_url = EXCLUDED.repository_url,
                    branch = EXCLUDED.branch,
                    display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    version = EXCLUDED.version,
                    plugins = EXCLUDED.plugins,
                    git_commit_sha = EXCLUDED.git_commit_sha,
                    status = EXCLUDED.status,
                    last_synced_at = NOW(),
                    updated_at = NOW()
                """,
                (
                    user_id, marketplace_name, repository_url, branch,
                    marketplace_record["display_name"], marketplace_record["description"],
                    marketplace_record["version"], json.dumps(marketplace_record["plugins"]),
                    commit_sha, "active"
                ),
                fetch="none"
            )

            return marketplace_record

        db_record = await asyncio.get_event_loop().run_in_executor(
            None, save_to_db_sync
        )
        logger.info("Marketplace metadata saved to PostgreSQL")

        return {
            "success": True,
            "message": f"Marketplace '{marketplace_name}' cloned successfully",
            "marketplace": db_record,
            "commit_sha": commit_sha,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "cloning repository")
        }


@router.post("/marketplace/update")
async def update_marketplace(request: Request):
    """
    Update a marketplace repository using git fetch + reset.

    This performs an incremental update - only downloads changed files.
    Much faster than re-downloading the entire ZIP.

    Request body:
        {
            "auth_token": "Bearer ...",
            "marketplace_name": "anthropic-agent-skills"
        }

    Returns:
        {"success": bool, "message": str, "had_changes": bool, "commit_sha": str}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")
        marketplace_name = body.get("marketplace_name")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not marketplace_name:
            return {"success": False, "error": "Missing required field: marketplace_name"}

        if not _is_valid_marketplace_name(marketplace_name):
            return {
                "success": False,
                "error": f"Invalid marketplace name: {marketplace_name}",
            }

        user_id = extract_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Updating marketplace '{marketplace_name}'")

        # Get marketplace metadata from PostgreSQL
        def get_marketplace_sync():
            return execute_query(
                "SELECT * FROM marketplaces WHERE user_id = %s AND name = %s",
                (user_id, marketplace_name),
                fetch="one"
            )

        marketplace = await asyncio.get_event_loop().run_in_executor(
            None, get_marketplace_sync
        )

        if not marketplace:
            return {
                "success": False,
                "error": f"Marketplace '{marketplace_name}' not found",
            }

        branch = marketplace.get("branch", "main")
        workspace_path = get_user_workspace_path(user_id)
        marketplace_dir = get_marketplace_dir(workspace_path, marketplace_name)

        # Verify it's a git repository
        if not await is_git_repository(marketplace_dir):
            return {
                "success": False,
                "error": f"Marketplace '{marketplace_name}' is not a git repository. Please re-clone it.",
            }

        # Fetch and reset
        logger.info(f"Fetching updates for {marketplace_name}...")
        success, result, had_changes = await fetch_and_reset(marketplace_dir, branch)

        if not success:
            return {
                "success": False,
                "error": f"Failed to update: {result}",
            }

        new_commit_sha = result
        old_commit_sha = marketplace.get("git_commit_sha", "unknown")

        # Re-read marketplace.json if changed
        marketplace_json_path = marketplace_dir / ".claude-plugin" / "marketplace.json"
        marketplace_metadata = None

        if had_changes and marketplace_json_path.exists():
            try:
                marketplace_metadata = json.loads(marketplace_json_path.read_text())
                logger.info(f"Updated marketplace.json: {marketplace_metadata.get('name')}")
            except Exception as e:
                logger.warning(f"Failed to parse marketplace.json: {e}")

        # Update PostgreSQL
        def update_db_sync():
            if marketplace_metadata:
                execute_query(
                    """
                    UPDATE marketplaces SET
                        display_name = %s,
                        description = %s,
                        version = %s,
                        plugins = %s,
                        git_commit_sha = %s,
                        last_synced_at = NOW(),
                        updated_at = NOW()
                    WHERE user_id = %s AND name = %s
                    """,
                    (
                        marketplace_metadata.get("name", marketplace_name),
                        marketplace_metadata.get("description"),
                        marketplace_metadata.get("version", "unknown"),
                        json.dumps(marketplace_metadata.get("plugins", [])),
                        new_commit_sha,
                        user_id, marketplace_name
                    ),
                    fetch="none"
                )
            else:
                execute_query(
                    """
                    UPDATE marketplaces SET
                        git_commit_sha = %s,
                        last_synced_at = NOW(),
                        updated_at = NOW()
                    WHERE user_id = %s AND name = %s
                    """,
                    (new_commit_sha, user_id, marketplace_name),
                    fetch="none"
                )

        await asyncio.get_event_loop().run_in_executor(None, update_db_sync)

        if had_changes:
            logger.info(f"Marketplace updated: {old_commit_sha[:8]} -> {new_commit_sha[:8]}")
        else:
            logger.info(f"Marketplace already up to date: {new_commit_sha[:8]}")

        return {
            "success": True,
            "message": f"Marketplace '{marketplace_name}' updated" if had_changes else f"Marketplace '{marketplace_name}' already up to date",
            "had_changes": had_changes,
            "old_commit_sha": old_commit_sha,
            "new_commit_sha": new_commit_sha,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "updating marketplace")
        }


@router.post("/marketplace/update-all")
async def update_all_marketplaces(request: Request):
    """
    Update all user's marketplaces using git fetch.

    Request body:
        {
            "auth_token": "Bearer ..."
        }

    Returns:
        {"success": bool, "results": [...]}
    """
    try:
        body = await request.json()
        auth_token = body.get("auth_token") or request.headers.get("authorization", "")

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Updating all marketplaces")

        # Get all marketplaces
        def get_all_marketplaces_sync():
            return execute_query(
                "SELECT name, branch FROM marketplaces WHERE user_id = %s AND status = 'active'",
                (user_id,),
                fetch="all"
            )

        marketplaces = await asyncio.get_event_loop().run_in_executor(
            None, get_all_marketplaces_sync
        )

        if not marketplaces:
            return {
                "success": True,
                "message": "No marketplaces to update",
                "results": [],
            }

        workspace_path = get_user_workspace_path(user_id)
        results = []

        for mp in marketplaces:
            mp_name = mp["name"]
            mp_branch = mp.get("branch", "main")
            mp_dir = get_marketplace_dir(workspace_path, mp_name)

            if not await is_git_repository(mp_dir):
                results.append({
                    "marketplace": mp_name,
                    "success": False,
                    "error": "Not a git repository",
                })
                continue

            success, result, had_changes = await fetch_and_reset(mp_dir, mp_branch)

            if success:
                # Update commit SHA in DB
                def update_commit_sync():
                    execute_query(
                        """
                        UPDATE marketplaces SET
                            git_commit_sha = %s,
                            last_synced_at = NOW()
                        WHERE user_id = %s AND name = %s
                        """,
                        (result, user_id, mp_name),
                        fetch="none"
                    )

                await asyncio.get_event_loop().run_in_executor(None, update_commit_sync)

                results.append({
                    "marketplace": mp_name,
                    "success": True,
                    "had_changes": had_changes,
                    "commit_sha": result,
                })
            else:
                results.append({
                    "marketplace": mp_name,
                    "success": False,
                    "error": result,
                })

        updated_count = sum(1 for r in results if r.get("success") and r.get("had_changes"))
        logger.info(f"Updated {updated_count}/{len(marketplaces)} marketplaces")

        return {
            "success": True,
            "message": f"Updated {updated_count} marketplaces",
            "results": results,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "updating all marketplaces")
        }


@router.delete("/marketplace/{marketplace_name}")
async def delete_marketplace(marketplace_name: str, request: Request):
    """
    Delete marketplace and all associated files.

    Path params:
        marketplace_name: Name of marketplace to delete

    Query params:
        auth_token: Bearer token

    Returns:
        {"success": bool, "message": str, "cleaned_items": list}
    """
    try:
        auth_token = request.query_params.get("auth_token") or request.headers.get(
            "authorization", ""
        )

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        user_id = extract_user_id_from_token(auth_token)
        if not user_id:
            return {"success": False, "error": "Invalid auth token"}

        if not _is_valid_marketplace_name(marketplace_name):
            return {
                "success": False,
                "error": f"Invalid marketplace name: {marketplace_name}",
            }

        logger.info(f"User {user_id}: Deleting marketplace '{marketplace_name}'")

        marketplace = execute_query(
            "SELECT * FROM marketplaces WHERE user_id = %s AND name = %s",
            (user_id, marketplace_name),
            fetch="one"
        )

        if not marketplace:
            return {"success": False, "error": "Marketplace not found"}

        cleanup_result = await cleanup_marketplace_task(
            user_id=user_id,
            marketplace_name=marketplace_name,
            marketplace_id=marketplace["id"]
        )

        if cleanup_result["success"]:
            logger.info(f"Marketplace '{marketplace_name}' deleted successfully")
            return {
                "success": True,
                "message": f"Marketplace '{marketplace_name}' deleted successfully",
                "cleaned_items": cleanup_result.get("cleaned_items", [])
            }
        else:
            logger.error(f"Failed to delete marketplace: {cleanup_result.get('message')}")
            return {
                "success": False,
                "error": cleanup_result.get("message", "Failed to delete marketplace")
            }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "deleting marketplace"),
        }


async def cleanup_marketplace_task(
    user_id: str, marketplace_name: str, marketplace_id: str
):
    """
    Cleanup marketplace files and metadata.

    Git-based cleanup:
    1. Remove git repository directory from workspace
    2. Delete installed plugins from PostgreSQL
    3. Delete marketplace metadata from PostgreSQL
    """
    logger.info(f"Starting cleanup for marketplace '{marketplace_name}' (user: {user_id})")

    cleaned_items = []

    try:
        # Step 1: Remove git repository from workspace
        workspace_path = get_user_workspace_path(user_id)
        marketplace_dir = get_marketplace_dir(workspace_path, marketplace_name)

        if await remove_repository(marketplace_dir):
            cleaned_items.append(f"git_repo:{marketplace_dir}")
            logger.info(f"Removed git repository: {marketplace_dir}")
        else:
            logger.warning(f"Git repository not found or failed to remove: {marketplace_dir}")

        # Step 2: Delete installed plugins from PostgreSQL
        try:
            execute_query(
                "DELETE FROM installed_plugins WHERE user_id = %s AND marketplace_name = %s",
                (user_id, marketplace_name),
                fetch="none"
            )
            cleaned_items.append("plugins:deleted")
            logger.info("Deleted installed plugins for marketplace")
        except Exception as e:
            logger.warning(f"Failed to delete installed plugins: {e}")

        # Step 3: Delete marketplace record from PostgreSQL
        try:
            execute_query(
                "DELETE FROM marketplaces WHERE id = %s",
                (marketplace_id,),
                fetch="none"
            )
            cleaned_items.append("metadata:marketplace")
            logger.info("Deleted marketplace metadata from PostgreSQL")
        except Exception as e:
            logger.error(f"Failed to delete marketplace metadata: {e}")
            raise

        logger.info(f"Marketplace cleanup completed: {marketplace_name} ({len(cleaned_items)} items)")

        return {
            "success": True,
            "message": f"Marketplace '{marketplace_name}' cleaned up successfully",
            "cleaned_items": cleaned_items,
        }

    except Exception as e:
        logger.error(f"Marketplace cleanup failed: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"Cleanup failed: {sanitize_error_message(e, 'cleaning up marketplace')}",
            "cleaned_items": cleaned_items,
        }
