"""
Git utilities for marketplace management.

This module provides async-friendly git operations for cloning, updating,
and managing marketplace repositories.

Supports:
- Public repositories (no authentication)
- Private repositories (with Vault credentials)
- Automatic credential injection from HashiCorp Vault
"""

import asyncio
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional, Tuple, Dict
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger(__name__)


class GitError(Exception):
    """Custom exception for git operations."""
    pass


async def run_git_command(
    args: list[str],
    cwd: Optional[Path] = None,
    timeout: int = 300
) -> Tuple[bool, str, str]:
    """
    Run a git command asynchronously.

    Args:
        args: Git command arguments (without 'git' prefix)
        cwd: Working directory for the command
        timeout: Command timeout in seconds (default 5 minutes)

    Returns:
        Tuple of (success, stdout, stderr)
    """
    cmd = ["git"] + args
    # Sanitize command for logging to avoid leaking credentials in URLs
    safe_cmd = ' '.join(sanitize_git_url(a) if '://' in a else a for a in cmd)
    logger.info(f"🔧 Running: {safe_cmd} (cwd: {cwd})")

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"}  # Disable interactive prompts
        )

        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout
        )

        stdout_str = stdout.decode("utf-8", errors="replace").strip()
        stderr_str = stderr.decode("utf-8", errors="replace").strip()

        success = process.returncode == 0

        if success:
            logger.info(f"✅ Git command succeeded")
            if stdout_str:
                logger.debug(f"   stdout: {stdout_str[:200]}")
        else:
            logger.error(f"❌ Git command failed (code {process.returncode})")
            logger.error(f"   stderr: {stderr_str}")

        return success, stdout_str, stderr_str

    except asyncio.TimeoutError:
        logger.error(f"❌ Git command timed out after {timeout}s")
        return False, "", f"Command timed out after {timeout} seconds"
    except Exception as e:
        logger.error(f"❌ Git command error: {e}")
        return False, "", str(e)


from typing import Optional, Tuple, Callable, Any

async def execute_git_operation_with_fallback(
    repo_url: str,
    initial_branch: str,
    operation: Callable[[str], Any]
) -> Tuple[bool, str, Any]:
    """
    Execute a git operation with automatic default branch detection fallback.

    Args:
        repo_url: Repository URL
        initial_branch: Initial branch to try
        operation: Async callback taking (branch_name) -> (success, stdout, stderr)

    Returns:
        Tuple of (success, final_branch, result_from_operation)
    """
    # Attempt 1: Try with requested branch
    success, stdout, stderr = await operation(initial_branch)
    
    if success:
        return True, initial_branch, (success, stdout, stderr)

    logger.warning(f"⚠️ Git operation with branch '{initial_branch}' failed: {stderr}")

    # Attempt 2: Detect default branch and retry if different
    try:
        default_branch = await get_remote_default_branch(repo_url)
        
        if default_branch and default_branch != initial_branch:
            logger.info(f"🔄 Retrying with detected default branch: '{default_branch}'")
            success, stdout, stderr = await operation(default_branch)
            
            if success:
                return True, default_branch, (success, stdout, stderr)
    except Exception as e:
        logger.error(f"❌ Error during branch fallback: {e}")

    return False, initial_branch, (success, stdout, stderr)


async def clone_repository(
    repo_url: str,
    target_dir: Path,
    branch: str = "main",
    depth: int = 1,
    user_id: Optional[str] = None,
    credential_name: str = "default_github_pat"
) -> Tuple[bool, str]:
    """
    Clone a git repository (shallow clone by default).
    
    Supports both public and private repositories:
    - Public repos: Works without credentials
    - Private repos: Automatically fetches credentials from Vault if user_id provided

    Args:
        repo_url: GitHub repository URL (HTTPS)
        target_dir: Local directory to clone into
        branch: Branch to clone (default: main)
        depth: Clone depth (default: 1 for shallow clone)
        user_id: Optional user ID for Vault credential lookup
        credential_name: Name of git credential in Vault (default: 'default_github_pat')

    Returns:
        Tuple of (success, error_message or commit_sha)
    """
    # Try to inject credentials from Vault if user_id provided
    if user_id:
        repo_url = await _inject_vault_credentials(repo_url, user_id, credential_name)
    # Ensure parent directory exists
    target_dir.parent.mkdir(parents=True, exist_ok=True)

    # Remove existing directory if it exists
    if target_dir.exists():
        logger.warning(f"⚠️ Removing existing directory: {target_dir}")
        shutil.rmtree(target_dir)

    # Define operation callback
    async def _try_clone(b: str) -> Tuple[bool, str, str]:
        cmd_args = [
            "clone",
            "--depth", str(depth),
            "--branch", b,
            "--single-branch",
            repo_url,
            str(target_dir)
        ]
        return await run_git_command(cmd_args)

    # Execute with fallback
    success, used_branch, result = await execute_git_operation_with_fallback(
        repo_url, branch, _try_clone
    )
    
    _, _, stderr = result

    if not success:
        return False, f"Clone failed: {stderr}"

    # Get current commit SHA
    commit_sha = await get_current_commit(target_dir)

    logger.info(f"✅ Cloned {repo_url} @ {used_branch} -> {target_dir} (commit: {commit_sha[:8] if commit_sha else 'unknown'})")

    return True, commit_sha or "unknown"


async def get_remote_default_branch(repo_url: str) -> Optional[str]:
    """
    Detect the default branch of a remote repository.
    
    Args:
        repo_url: Repository URL
        
    Returns:
        Default branch name (e.g. 'main', 'master') or None if detection fails
    """
    # Use git ls-remote --symref to get HEAD reference
    success, stdout, _ = await run_git_command(
        ["ls-remote", "--symref", repo_url, "HEAD"]
    )
    
    if success and stdout:
        # Output format example:
        # ref: refs/heads/main	HEAD
        # 5f... HEAD
        for line in stdout.splitlines():
            if line.startswith("ref: refs/heads/"):
                # Extract branch name
                parts = line.split("\t")
                if parts:
                    ref_part = parts[0]
                    return ref_part.replace("ref: refs/heads/", "").strip()
    
    return None


async def fetch_and_reset(
    repo_dir: Path,
    branch: str = "main",
    user_id: Optional[str] = None,
    credential_name: str = "default_github_pat"
) -> Tuple[bool, str, bool]:
    """
    Fetch latest changes and reset to remote branch.

    This is the update strategy: fetch + hard reset.
    Ensures local matches remote exactly (no merge conflicts).
    
    Supports both public and private repositories with Vault credential injection.

    Args:
        repo_dir: Local repository directory
        branch: Branch to update (default: main)
        user_id: Optional user ID for Vault credential lookup
        credential_name: Name of git credential in Vault

    Returns:
        Tuple of (success, new_commit_sha or error, had_changes)
    """
    if not repo_dir.exists():
        return False, "Repository directory does not exist", False

    # Get current commit before fetch
    old_commit = await get_current_commit(repo_dir)

    # Get remote URL for fallback
    success_url, remote_url, _ = await run_git_command(
        ["remote", "get-url", "origin"],
        cwd=repo_dir
    )
    
    if not success_url or not remote_url:
        return False, "Could not determine remote URL", False
    
    # Try to inject credentials from Vault if user_id provided
    original_remote_url = remote_url.strip()
    credentials_injected = False
    if user_id:
        authenticated_url = await _inject_vault_credentials(
            original_remote_url, user_id, credential_name
        )

        # Temporarily update remote URL if credentials were injected
        if authenticated_url != original_remote_url:
            await run_git_command(
                ["remote", "set-url", "origin", authenticated_url],
                cwd=repo_dir
            )
            credentials_injected = True
            logger.debug("Temporarily updated remote URL with Vault credentials")

    try:
        # Define operation callback
        async def _try_fetch(b: str) -> Tuple[bool, str, str]:
            return await run_git_command(
                ["fetch", "origin", b],
                cwd=repo_dir
            )

        # Execute with fallback
        success, used_branch, result = await execute_git_operation_with_fallback(
            remote_url.strip(), branch, _try_fetch
        )

        _, _, stderr = result

        if not success:
            return False, f"Fetch failed: {stderr}", False

        # Hard reset to origin/branch
        success, _, stderr = await run_git_command(
            ["reset", "--hard", f"origin/{used_branch}"],
            cwd=repo_dir
        )

        if not success:
            return False, f"Reset failed: {stderr}", False

        # Get new commit
        new_commit = await get_current_commit(repo_dir)
        had_changes = old_commit != new_commit

        if had_changes:
            logger.info(f"📦 Updated: {old_commit[:8] if old_commit else '?'} -> {new_commit[:8] if new_commit else '?'} (branch: {used_branch})")
        else:
            logger.info(f"✅ Already up to date: {new_commit[:8] if new_commit else '?'} (branch: {used_branch})")

        return True, new_commit or "unknown", had_changes

    finally:
        # Always restore original remote URL to avoid persisting
        # credentials in .git/config
        if credentials_injected:
            await run_git_command(
                ["remote", "set-url", "origin", original_remote_url],
                cwd=repo_dir
            )
            logger.debug("Restored original remote URL (credentials removed from .git/config)")


async def get_current_commit(repo_dir: Path) -> Optional[str]:
    """
    Get the current commit SHA of a repository.

    Args:
        repo_dir: Local repository directory

    Returns:
        Commit SHA or None if failed
    """
    success, stdout, _ = await run_git_command(
        ["rev-parse", "HEAD"],
        cwd=repo_dir
    )

    return stdout if success else None


async def get_remote_commit(
    repo_url: str,
    branch: str = "main"
) -> Optional[str]:
    """
    Get the latest commit SHA from remote without cloning.

    Args:
        repo_url: GitHub repository URL
        branch: Branch to check

    Returns:
        Commit SHA or None if failed
    """
    success, stdout, _ = await run_git_command(
        ["ls-remote", repo_url, f"refs/heads/{branch}"]
    )

    if success and stdout:
        # Output format: "<sha>\trefs/heads/<branch>"
        parts = stdout.split()
        if parts:
            return parts[0]

    return None


async def is_git_repository(path: Path) -> bool:
    """
    Check if a directory is a valid git repository.

    Args:
        path: Directory to check

    Returns:
        True if valid git repository
    """
    git_dir = path / ".git"
    if not git_dir.exists():
        return False

    success, _, _ = await run_git_command(
        ["rev-parse", "--git-dir"],
        cwd=path
    )

    return success


async def ensure_repository(
    repo_url: str,
    target_dir: Path,
    branch: str = "main",
    user_id: Optional[str] = None,
    credential_name: str = "default_github_pat"
) -> Tuple[bool, str, bool]:
    """
    Ensure repository exists and is up to date.

    Clone if not exists, fetch+reset if exists.
    Supports private repositories with Vault credential injection.

    Args:
        repo_url: GitHub repository URL
        target_dir: Local directory
        branch: Branch to use
        user_id: Optional user ID for Vault credential lookup
        credential_name: Name of git credential in Vault

    Returns:
        Tuple of (success, commit_sha or error, was_cloned)
    """
    if await is_git_repository(target_dir):
        # Repository exists, update it
        success, result, _ = await fetch_and_reset(
            target_dir, branch, user_id=user_id, credential_name=credential_name
        )
        return success, result, False
    else:
        # Clone new repository
        success, result = await clone_repository(
            repo_url, target_dir, branch, user_id=user_id, credential_name=credential_name
        )
        return success, result, True


async def remove_repository(repo_dir: Path) -> bool:
    """
    Remove a repository directory.

    Args:
        repo_dir: Repository directory to remove

    Returns:
        True if removed successfully
    """
    if not repo_dir.exists():
        logger.warning(f"⚠️ Repository does not exist: {repo_dir}")
        return True

    try:
        shutil.rmtree(repo_dir)
        logger.info(f"🗑️ Removed repository: {repo_dir}")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to remove repository: {e}")
        return False


def build_github_url(owner: str, repo: str) -> str:
    """
    Build GitHub HTTPS URL from owner and repo.

    Args:
        owner: Repository owner (e.g., "anthropics")
        repo: Repository name (e.g., "skills")

    Returns:
        GitHub HTTPS URL
    """
    return f"https://github.com/{owner}/{repo}.git"


def get_marketplace_dir(workspace_path: Path, marketplace_name: str) -> Path:
    """
    Get the directory path for a marketplace with robust path validation.

    Args:
        workspace_path: User's workspace path
        marketplace_name: Name of the marketplace

    Returns:
        Path to marketplace directory (validated and resolved)

    Raises:
        GitError: If the marketplace name attempts directory traversal
    """
    if not marketplace_name or not re.fullmatch(r"^[A-Za-z0-9_.-]+$", marketplace_name):
        logger.error(f"🚨 Invalid marketplace name detected: {marketplace_name}")
        raise GitError(f"Invalid marketplace name: {marketplace_name}")

    # Define and resolve the base directory for all marketplaces
    marketplaces_root = (workspace_path / ".claude" / "plugins" / "marketplaces").resolve()
    
    # Compute and resolve the candidate directory
    # Note: resolve() handles '..' and symlinks
    candidate_dir = (marketplaces_root / marketplace_name).resolve()
    
    # Robust check to satisfy both runtime security and static analysis (CodeQL)
    if not candidate_dir.is_relative_to(marketplaces_root) or candidate_dir == marketplaces_root:
        logger.error(f"🚨 Path traversal attempt detected: {marketplace_name}")
        raise GitError(f"Invalid marketplace name: {marketplace_name}")
        
    return candidate_dir


async def _inject_vault_credentials(
    repo_url: str,
    user_id: str,
    credential_name: str = "default_github_pat"
) -> str:
    """
    Inject Vault credentials into git URL if available.
    
    Transforms:
        https://github.com/owner/repo.git
    To:
        https://username:token@github.com/owner/repo.git
    
    Args:
        repo_url: Original HTTPS git URL
        user_id: User ID for Vault lookup
        credential_name: Credential name in Vault
    
    Returns:
        URL with credentials injected, or original URL if credentials not found
    """
    try:
        import json as _json
        from vault_client import get_credential, get_git_credential

        username = None
        token = None

        # Try generic credentials path first (new UI stores here)
        generic_cred = get_credential(user_id, "generic_api_key", credential_name)
        if generic_cred and generic_cred.get("data"):
            raw_value = generic_cred["data"].get("value", "")
            # Try parse as JSON for structured credentials
            try:
                parsed = _json.loads(raw_value)
                if isinstance(parsed, dict):
                    username = parsed.get("username", "")
                    token = parsed.get("token") or parsed.get("password") or parsed.get("pat", "")
            except (_json.JSONDecodeError, TypeError):
                # Plain text — treat as token (works for GitHub PAT with x-access-token)
                token = raw_value.strip()
                username = "x-access-token"

        # Fallback to legacy git/ path
        if not token:
            legacy_cred = get_git_credential(user_id, credential_name)
            if legacy_cred:
                username = legacy_cred.get("username")
                token = legacy_cred.get("token")

        if not token:
            logger.debug("No git credentials found in Vault, using URL as-is")
            return repo_url

        # Inject credentials into URL using urllib.parse (safe from regex injection)
        url_parts = urlparse(repo_url)
        if url_parts.scheme == "https":
            authenticated_url = urlunparse(url_parts._replace(
                netloc=f"{username}:{token}@{url_parts.hostname}" + (f":{url_parts.port}" if url_parts.port else "")
            ))
            logger.info("✅ Injected Vault credentials into git URL")
            logger.debug(f"   Authenticated URL: {sanitize_git_url(authenticated_url)}")
            return authenticated_url

        return repo_url
    
    except ImportError:
        logger.debug("Vault client not available, skipping credential injection")
        return repo_url
    except Exception as e:
        logger.error(f"❌ Failed to inject Vault credentials: {e}")
        return repo_url


def sanitize_git_url(url: str) -> str:
    """
    Sanitize git URL for logging (remove credentials).
    
    Args:
        url: Git URL potentially with credentials
    
    Returns:
        URL with credentials replaced by ***
    """
    return re.sub(r"://[^@]+@", "://***@", url)
