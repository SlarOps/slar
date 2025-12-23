"""
Marketplace and plugins routes for AI Agent API.

Handles:
- POST /api/marketplace/install-plugin - Install plugin from marketplace
- POST /api/plugins/install - Install plugin (legacy)
- POST /api/marketplace/fetch-metadata - Fetch marketplace metadata from GitHub
- POST /api/marketplace/download-repo-zip - Download marketplace ZIP
- DELETE /api/marketplace/{marketplace_name} - Delete marketplace
"""

import asyncio
import base64
import io
import json
import logging
import os
import shutil
import zipfile
from asyncio import Lock
from datetime import datetime

import httpx
from fastapi import APIRouter, Request

from supabase_storage import (
    extract_user_id_from_token,
    get_supabase_client,
    get_user_workspace_path,
    sync_marketplace_zip_to_local,
    unzip_installed_plugins,
)
from database_util import execute_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["marketplace"])

# Per-user locks to prevent race conditions when installing plugins
user_plugin_locks = {}


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """Sanitize error messages to prevent information disclosure."""
    logger.error(f"Error {context}: {type(error).__name__}: {str(error)}", exc_info=True)
    return f"An error occurred {context}. Please try again."


@router.post("/marketplace/install-plugin")
async def install_plugin_from_marketplace(request: Request):
    """
    Mark a plugin as installed (files already in S3 from marketplace ZIP).

    This endpoint ONLY updates the database to mark a plugin as installed.
    The actual plugin files are already in S3 (uploaded when marketplace was added).
    When user opens AI agent, sync_bucket will unzip only installed plugins.

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

        user_id = extract_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Installing plugin {plugin_name} from {marketplace_name}")

        # Get plugin source path from PostgreSQL marketplace metadata
        install_path = f".claude/plugins/marketplaces/{marketplace_name}/{plugin_name}"

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
                "error": f"Marketplace '{marketplace_name}' not found in database",
            }

        if not marketplace_record.get("zip_path"):
            logger.warning(f"No ZIP file for marketplace '{marketplace_name}'")
            return {
                "success": False,
                "error": "Marketplace ZIP not found. Please re-add the marketplace.",
            }

        if marketplace_record and marketplace_record.get("plugins"):
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
        else:
            logger.warning(f"No marketplace metadata found for '{marketplace_name}'")

        def add_to_db_sync():
            plugin_record = {
                "user_id": user_id,
                "plugin_name": plugin_name,
                "marketplace_name": marketplace_name,
                "version": version,
                "install_path": install_path,
                "status": "active",
                "is_local": False,
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

        logger.info(f"Unzipping plugin to local workspace for user {user_id}...")
        unzip_result = await unzip_installed_plugins(user_id)

        if unzip_result["success"]:
            logger.info(f"Plugin unzipped to local: {unzip_result['message']}")
        else:
            logger.warning(f"Failed to unzip plugin: {unzip_result['message']}")

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

        try:
            user_id = extract_user_id_from_token(auth_token)
            logger.info(f"User {user_id}: Fetching metadata for {owner}/{repo}@{branch}")
        except Exception as e:
            return {"success": False, "error": f"Invalid auth token: {str(e)}"}

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
                "zip_path": None,
                "zip_size": 0,
                "status": "active",
            }

            execute_query(
                """
                INSERT INTO marketplaces (user_id, name, repository_url, branch, display_name, description, version, plugins, zip_path, zip_size, status, last_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (user_id, name) DO UPDATE SET
                    repository_url = EXCLUDED.repository_url,
                    branch = EXCLUDED.branch,
                    display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    version = EXCLUDED.version,
                    plugins = EXCLUDED.plugins,
                    zip_path = EXCLUDED.zip_path,
                    zip_size = EXCLUDED.zip_size,
                    status = EXCLUDED.status,
                    last_synced_at = NOW(),
                    updated_at = NOW()
                """,
                (
                    user_id, marketplace_name, repository_url, branch,
                    marketplace_record["display_name"], marketplace_record["description"],
                    marketplace_record["version"], json.dumps(marketplace_record["plugins"]),
                    None, 0, "active"
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


@router.post("/marketplace/download-repo-zip")
async def download_repo_zip(request: Request):
    """
    Download GitHub repository and save metadata to PostgreSQL + ZIP to S3.

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
        marketplace_name = body.get("marketplace_name") or repo

        if not auth_token:
            return {"success": False, "error": "Missing auth_token"}

        if not owner or not repo:
            return {"success": False, "error": "Missing required fields: owner, repo"}

        try:
            user_id = extract_user_id_from_token(auth_token)
            logger.info(f"User {user_id}: Downloading {owner}/{repo}@{branch}")
        except Exception as e:
            return {"success": False, "error": f"Invalid auth token: {str(e)}"}

        zip_url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip"
        repository_url = f"https://github.com/{owner}/{repo}"

        logger.info(f"Downloading from {zip_url}...")
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(zip_url, follow_redirects=True)

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Failed to download ZIP: HTTP {response.status_code}",
                }

            zip_data = response.content

        zip_size = len(zip_data)
        logger.info(f"Downloaded {zip_size} bytes ({zip_size / 1024 / 1024:.2f} MB)")

        marketplace_metadata = None
        try:
            with zipfile.ZipFile(io.BytesIO(zip_data)) as zip_ref:
                marketplace_json_path = None
                for file_info in zip_ref.filelist:
                    if file_info.filename.endswith(".claude-plugin/marketplace.json"):
                        marketplace_json_path = file_info.filename
                        break

                if marketplace_json_path:
                    marketplace_json_content = zip_ref.read(marketplace_json_path)
                    marketplace_metadata = json.loads(marketplace_json_content)
                    logger.info("Parsed marketplace.json from ZIP")
                else:
                    logger.warning("No marketplace.json found in ZIP")
                    marketplace_metadata = {
                        "name": marketplace_name,
                        "version": "unknown",
                        "plugins": [],
                    }
        except Exception as e:
            logger.error(f"Failed to parse marketplace.json from ZIP: {e}")
            marketplace_metadata = {
                "name": marketplace_name,
                "version": "unknown",
                "plugins": [],
            }

        supabase = get_supabase_client()
        storage_path = f".claude/plugins/marketplaces/{marketplace_name}/{repo}-{branch}.zip"

        logger.info(f"Uploading ZIP to storage: {storage_path}")

        def upload_zip_sync():
            supabase.storage.from_(user_id).upload(
                path=storage_path,
                file=zip_data,
                file_options={"content-type": "application/zip", "upsert": "true"},
            )

        await asyncio.get_event_loop().run_in_executor(None, upload_zip_sync)
        logger.info("ZIP uploaded to storage")

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
                "zip_path": storage_path,
                "zip_size": zip_size,
                "status": "active",
            }

            execute_query(
                """
                INSERT INTO marketplaces (user_id, name, repository_url, branch, display_name, description, version, plugins, zip_path, zip_size, status, last_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (user_id, name) DO UPDATE SET
                    repository_url = EXCLUDED.repository_url,
                    branch = EXCLUDED.branch,
                    display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    version = EXCLUDED.version,
                    plugins = EXCLUDED.plugins,
                    zip_path = EXCLUDED.zip_path,
                    zip_size = EXCLUDED.zip_size,
                    status = EXCLUDED.status,
                    last_synced_at = NOW(),
                    updated_at = NOW()
                """,
                (
                    user_id, marketplace_name, repository_url, branch,
                    marketplace_record["display_name"], marketplace_record["description"],
                    marketplace_record["version"], json.dumps(marketplace_record["plugins"]),
                    storage_path, zip_size, "active"
                ),
                fetch="none"
            )

            return marketplace_record

        db_record = await asyncio.get_event_loop().run_in_executor(
            None, save_to_db_sync
        )
        logger.info("Marketplace metadata saved to PostgreSQL")

        logger.info(f"Downloading marketplace ZIP to local workspace...")
        sync_result = await sync_marketplace_zip_to_local(user_id, marketplace_name, storage_path)

        if sync_result["success"]:
            logger.info(f"Marketplace ZIP synced to local: {sync_result['message']}")
        else:
            logger.warning(f"Failed to sync marketplace ZIP: {sync_result['message']}")

        return {
            "success": True,
            "message": f"Marketplace '{marketplace_name}' downloaded and saved to database",
            "marketplace": db_record,
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "downloading repository")
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
            marketplace_id=marketplace["id"],
            zip_path=marketplace.get("zip_path")
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
    user_id: str, marketplace_name: str, marketplace_id: str, zip_path: str = None
):
    """
    Cleanup marketplace files and metadata.

    This function cleans up:
    1. User workspace directories
    2. S3 storage (ZIP files)
    3. Installed plugins (cascade delete)
    4. Marketplace metadata (PostgreSQL)
    """
    logger.info(f"Starting cleanup for marketplace '{marketplace_name}' (user: {user_id})")

    try:
        supabase = get_supabase_client()
        cleaned_items = []

        # Step 1: Cleanup workspace directory
        try:
            workspace_path = get_user_workspace_path(user_id)
            marketplace_dir = workspace_path / ".claude" / "plugins" / "marketplaces" / marketplace_name

            if marketplace_dir.exists():
                shutil.rmtree(marketplace_dir)
                cleaned_items.append(f"workspace:{marketplace_dir}")
                logger.info(f"Deleted workspace directory: {marketplace_dir}")
            else:
                logger.info(f"Workspace directory not found: {marketplace_dir}")
        except Exception as e:
            logger.warning(f"Failed to cleanup workspace: {e}")

        # Step 2: Cleanup S3 storage
        try:
            marketplace_folder = f".claude/plugins/marketplaces/{marketplace_name}"
            file_list = supabase.storage.from_(user_id).list(marketplace_folder)

            if file_list:
                files_to_delete = [f"{marketplace_folder}/{file['name']}" for file in file_list]
                supabase.storage.from_(user_id).remove(files_to_delete)
                cleaned_items.append(f"s3:{marketplace_folder} ({len(files_to_delete)} files)")
                logger.info(f"Deleted {len(files_to_delete)} files from S3: {marketplace_folder}")
            else:
                logger.info(f"No files found in S3: {marketplace_folder}")
        except Exception as e:
            logger.warning(f"Failed to delete files from S3: {e}")

        # Step 3: Delete installed plugins
        try:
            execute_query(
                "DELETE FROM installed_plugins WHERE user_id = %s AND marketplace_name = %s",
                (user_id, marketplace_name),
                fetch="none"
            )
            cleaned_items.append(f"plugins:deleted")
            logger.info("Deleted installed plugins for marketplace")
        except Exception as e:
            logger.warning(f"Failed to delete installed plugins: {e}")

        # Step 4: Delete marketplace record
        try:
            execute_query(
                "DELETE FROM marketplaces WHERE id = %s",
                (marketplace_id,),
                fetch="none"
            )
            cleaned_items.append(f"metadata:marketplace")
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
            "cleaned_items": cleaned_items if 'cleaned_items' in locals() else [],
        }
