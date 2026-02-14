"""
Skill Repository Management Routes (Option 1B - Separate Skill Tab).

Handles standalone skill repositories that don't require marketplace.json.
Users can add skill-only repos, browse all skills, and install individual skills.

Endpoints:
- POST /api/skills/add-repository - Clone skill repo and discover skills
- GET /api/skills/repositories - List user's skill repositories
- GET /api/skills/installed - List installed skills
- POST /api/skills/install - Install individual skill
- DELETE /api/skills/uninstall/{skill_id} - Uninstall skill
- POST /api/skills/update - Update repository (git fetch)
- DELETE /api/skills/repositories/{repo_name} - Delete repository
"""

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request, HTTPException

from workspace_service import get_user_workspace_path, extract_user_id_from_token
from database_util import (
    execute_query,
    ensure_user_exists,
    extract_user_info_from_token,
    resolve_user_id_from_token,
)
from git_utils import (
    build_github_url,
    clone_repository,
    fetch_and_reset,
    get_marketplace_dir,  # Reuse for skills
    is_git_repository,
    remove_repository,
)

# Import skill discovery functions from routes_marketplace
from routes_marketplace import (
    parse_yaml_frontmatter,
    sanitize_error_message,
    _is_valid_marketplace_name,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/skills", tags=["skills"])

_REPO_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")


# ============================================================
# SKILL DISCOVERY FUNCTIONS
# ============================================================

def discover_all_skills_in_repo(repo_dir: Path) -> list:
    """
    Discover all SKILL.md files recursively in repository.

    Supports flexible structures:
    - skill-name/SKILL.md
    - folder/skill-name/SKILL.md
    - deeply/nested/skill-name/SKILL.md

    Args:
        repo_dir: Root directory of cloned repository

    Returns:
        List of skill metadata: [{"name": "...", "description": "...", "path": "..."}]
    """
    skills = []

    if not repo_dir.exists():
        logger.warning(f"Repository directory not found: {repo_dir}")
        return skills

    # Find all SKILL.md files recursively
    for skill_md_path in repo_dir.rglob("SKILL.md"):
        # Skip hidden folders (.git, .github, etc.)
        if any(part.startswith('.') for part in skill_md_path.parts):
            continue

        # Parse frontmatter
        frontmatter = parse_yaml_frontmatter(skill_md_path)
        skill_folder = skill_md_path.parent.name

        # Relative path from repo root
        relative_path = skill_md_path.relative_to(repo_dir)

        skill_info = {
            "name": frontmatter.get("name", skill_folder) if frontmatter else skill_folder,
            "description": frontmatter.get("description", "") if frontmatter else "",
            "path": str(relative_path),  # e.g., "vnstock-analyzer/SKILL.md"
        }

        skills.append(skill_info)
        logger.info(f"Discovered skill: {skill_info['name']} at {relative_path}")

    logger.info(f"Discovered {len(skills)} skill(s) in {repo_dir.name}")
    return skills


def get_skill_repo_dir(workspace_path: Path, repo_name: str) -> Path:
    """Get skill repository directory path."""
    return workspace_path / ".claude" / "skills" / repo_name


def parse_github_url(url: str) -> Optional[dict]:
    """
    Parse GitHub URL to extract owner and repo.

    Supports formats:
    - https://github.com/owner/repo
    - https://github.com/owner/repo.git
    - git@github.com:owner/repo.git

    Returns:
        {"owner": "...", "repo": "..."} or None if invalid
    """
    patterns = [
        r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$",  # HTTPS or SSH
        r"github\.com/([^/]+)/([^/]+)",  # HTTPS with path
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return {
                "owner": match.group(1),
                "repo": match.group(2).replace(".git", "")
            }

    return None


# ============================================================
# ENDPOINTS
# ============================================================

@router.post("/add-repository")
async def add_skill_repository(request: Request):
    """
    Clone a skill repository and discover all SKILL.md files.

    Request body:
        {
            "repository_url": "https://github.com/numman-ali/openskills",
            "branch": "main",
            "credential_name": "github-token"  // Optional for private repos
        }

    Returns:
        {
            "success": bool,
            "repository": {...},
            "skills_count": int
        }
    """
    try:
        body = await request.json()
        auth_token = request.headers.get("authorization", "")
        repository_url = body.get("repository_url")
        branch = body.get("branch", "main")
        credential_name = body.get("credential_name")

        if not auth_token:
            return {"success": False, "error": "Missing authorization header"}

        if not repository_url:
            return {"success": False, "error": "Missing repository_url"}

        # Parse GitHub URL
        parsed = parse_github_url(repository_url)
        if not parsed:
            return {"success": False, "error": "Invalid GitHub URL"}

        owner = parsed["owner"]
        repo = parsed["repo"]
        repo_name = f"{owner}-{repo}"

        if not _is_valid_marketplace_name(repo_name):
            return {"success": False, "error": f"Invalid repository name: {repo_name}"}

        # Get user ID
        user_id = resolve_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Adding skill repository {repository_url}")

        # Check if repository already exists
        def check_exists():
            return execute_query(
                "SELECT id FROM skill_repositories WHERE user_id = %s AND name = %s",
                (user_id, repo_name),
                fetch="one"
            )

        existing = await asyncio.get_event_loop().run_in_executor(None, check_exists)
        if existing:
            return {
                "success": False,
                "error": f"Repository '{repo_name}' already exists"
            }

        # Build paths
        workspace_path = get_user_workspace_path(user_id)
        repo_dir = get_skill_repo_dir(workspace_path, repo_name)
        repo_url = build_github_url(owner, repo)

        # If target directory exists, remove it first
        # This handles cases like:
        # - Clone succeeded but DB insert failed
        # - Volume data loss requiring re-sync
        # - Manual cleanup needed
        if repo_dir.exists():
            import shutil
            logger.warning(f"Target directory exists, removing: {repo_dir}")
            shutil.rmtree(repo_dir)

        logger.info(f"Cloning {repo_url} -> {repo_dir}")

        # Clone repository
        clone_kwargs = dict(
            repo_url=repo_url,
            target_dir=repo_dir,
            branch=branch,
            depth=1,  # Shallow clone
            user_id=user_id,
        )
        if credential_name:
            clone_kwargs["credential_name"] = credential_name

        success, result = await clone_repository(**clone_kwargs)

        if not success:
            return {
                "success": False,
                "error": f"Failed to clone repository: {result}"
            }

        commit_sha = result
        logger.info(f"Repository cloned successfully (commit: {commit_sha[:8]})")

        # Discover skills
        discovered_skills = discover_all_skills_in_repo(repo_dir)

        if not discovered_skills:
            logger.warning(f"No SKILL.md files found in {repo_name}")

        # Save to database
        def save_to_db():
            execute_query(
                """
                INSERT INTO skill_repositories
                    (user_id, name, repository_url, branch, skills, git_commit_sha, credential_name, status, last_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    user_id,
                    repo_name,
                    repository_url,
                    branch,
                    json.dumps(discovered_skills),
                    commit_sha,
                    credential_name,
                    "active"
                ),
                fetch="none"
            )

            # Return inserted record
            return execute_query(
                "SELECT * FROM skill_repositories WHERE user_id = %s AND name = %s",
                (user_id, repo_name),
                fetch="one"
            )

        repo_record = await asyncio.get_event_loop().run_in_executor(None, save_to_db)

        logger.info(f"Skill repository added: {repo_name} ({len(discovered_skills)} skills)")

        return {
            "success": True,
            "message": f"Repository '{repo_name}' added successfully",
            "repository": {
                "id": repo_record["id"],
                "name": repo_record["name"],
                "repository_url": repo_record["repository_url"],
                "branch": repo_record["branch"],
                "skills": discovered_skills,
                "git_commit_sha": commit_sha,
                "status": repo_record["status"],
            },
            "skills_count": len(discovered_skills)
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "adding skill repository")
        }


@router.get("/repositories")
async def list_skill_repositories(request: Request):
    """
    List all skill repositories for the current user.

    Returns:
        {
            "success": bool,
            "repositories": [...]
        }
    """
    try:
        auth_token = request.headers.get("authorization", "")
        if not auth_token:
            return {"success": False, "error": "Missing authorization header"}

        user_id = resolve_user_id_from_token(auth_token)

        def get_repos():
            return execute_query(
                """
                SELECT id, name, repository_url, branch, skills, git_commit_sha, status, created_at, updated_at
                FROM skill_repositories
                WHERE user_id = %s AND status = 'active'
                ORDER BY created_at DESC
                """,
                (user_id,),
                fetch="all"
            )

        repos = await asyncio.get_event_loop().run_in_executor(None, get_repos)

        # Parse skills JSONB
        for repo in repos:
            if isinstance(repo.get("skills"), str):
                repo["skills"] = json.loads(repo["skills"])

        return {
            "success": True,
            "repositories": repos
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "listing skill repositories")
        }


@router.get("/installed")
async def list_installed_skills(request: Request):
    """
    List all installed skills for the current user.

    Query params:
        repository_name: Optional filter by repository

    Returns:
        {
            "success": bool,
            "skills": [...]
        }
    """
    try:
        auth_token = request.headers.get("authorization", "")
        if not auth_token:
            return {"success": False, "error": "Missing authorization header"}

        user_id = resolve_user_id_from_token(auth_token)
        repository_name = request.query_params.get("repository_name")

        def get_skills():
            if repository_name:
                return execute_query(
                    """
                    SELECT * FROM installed_skills
                    WHERE user_id = %s AND repository_name = %s AND status = 'active'
                    ORDER BY created_at DESC
                    """,
                    (user_id, repository_name),
                    fetch="all"
                )
            else:
                return execute_query(
                    """
                    SELECT * FROM installed_skills
                    WHERE user_id = %s AND status = 'active'
                    ORDER BY created_at DESC
                    """,
                    (user_id,),
                    fetch="all"
                )

        skills = await asyncio.get_event_loop().run_in_executor(None, get_skills)

        return {
            "success": True,
            "skills": skills
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "listing installed skills")
        }


@router.post("/install")
async def install_skill(request: Request):
    """
    Install an individual skill from a repository.

    Request body:
        {
            "skill_name": "vnstock-analyzer",
            "repository_name": "numman-ali-openskills",
            "skill_path": "vnstock-analyzer/SKILL.md",
            "version": "1.0.0"
        }

    Returns:
        {
            "success": bool,
            "skill": {...}
        }
    """
    try:
        body = await request.json()
        auth_token = request.headers.get("authorization", "")

        skill_name = body.get("skill_name")
        repository_name = body.get("repository_name")
        skill_path = body.get("skill_path")
        version = body.get("version", "1.0.0")

        if not auth_token:
            return {"success": False, "error": "Missing authorization header"}

        if not all([skill_name, repository_name, skill_path]):
            return {
                "success": False,
                "error": "Missing required fields: skill_name, repository_name, skill_path"
            }

        user_id = resolve_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Installing skill {skill_name} from {repository_name}")

        # Verify repository exists
        def check_repo():
            return execute_query(
                "SELECT * FROM skill_repositories WHERE user_id = %s AND name = %s AND status = 'active'",
                (user_id, repository_name),
                fetch="one"
            )

        repo = await asyncio.get_event_loop().run_in_executor(None, check_repo)

        if not repo:
            return {
                "success": False,
                "error": f"Repository '{repository_name}' not found. Please add it first."
            }

        # Verify skill exists in repository
        skills = json.loads(repo["skills"]) if isinstance(repo["skills"], str) else repo["skills"]
        skill_found = any(s["name"] == skill_name for s in skills)

        if not skill_found:
            return {
                "success": False,
                "error": f"Skill '{skill_name}' not found in repository '{repository_name}'"
            }

        # Check if already installed
        def check_installed():
            return execute_query(
                "SELECT id FROM installed_skills WHERE user_id = %s AND skill_name = %s AND repository_name = %s",
                (user_id, skill_name, repository_name),
                fetch="one"
            )

        existing = await asyncio.get_event_loop().run_in_executor(None, check_installed)

        if existing:
            return {
                "success": False,
                "error": f"Skill '{skill_name}' is already installed"
            }

        # Install skill (insert into database)
        def install():
            execute_query(
                """
                INSERT INTO installed_skills (user_id, skill_name, repository_name, skill_path, version, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (user_id, skill_name, repository_name, skill_path, version, "active"),
                fetch="none"
            )

            # Return installed skill
            return execute_query(
                "SELECT * FROM installed_skills WHERE user_id = %s AND skill_name = %s AND repository_name = %s",
                (user_id, skill_name, repository_name),
                fetch="one"
            )

        skill_record = await asyncio.get_event_loop().run_in_executor(None, install)

        logger.info(f"Skill installed: {skill_name}")

        return {
            "success": True,
            "message": f"Skill '{skill_name}' installed successfully",
            "skill": skill_record
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "installing skill")
        }


@router.delete("/uninstall/{skill_id}")
async def uninstall_skill(skill_id: str, request: Request):
    """
    Uninstall a skill.

    Path params:
        skill_id: UUID of installed skill

    Returns:
        {
            "success": bool,
            "message": str
        }
    """
    try:
        auth_token = request.headers.get("authorization", "")
        if not auth_token:
            return {"success": False, "error": "Missing authorization header"}

        user_id = resolve_user_id_from_token(auth_token)

        # Verify skill belongs to user
        def check_and_delete():
            skill = execute_query(
                "SELECT * FROM installed_skills WHERE id = %s AND user_id = %s",
                (skill_id, user_id),
                fetch="one"
            )

            if not skill:
                return None

            # Delete
            execute_query(
                "DELETE FROM installed_skills WHERE id = %s",
                (skill_id,),
                fetch="none"
            )

            return skill

        skill = await asyncio.get_event_loop().run_in_executor(None, check_and_delete)

        if not skill:
            return {
                "success": False,
                "error": "Skill not found or does not belong to you"
            }

        logger.info(f"Skill uninstalled: {skill['skill_name']}")

        return {
            "success": True,
            "message": f"Skill '{skill['skill_name']}' uninstalled successfully"
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "uninstalling skill")
        }


@router.post("/update")
async def update_skill_repository(request: Request):
    """
    Update a skill repository using git fetch.

    Request body:
        {
            "repository_name": "numman-ali-openskills"
        }

    Returns:
        {
            "success": bool,
            "had_changes": bool,
            "new_skills": [...]
        }
    """
    try:
        body = await request.json()
        auth_token = request.headers.get("authorization", "")
        repository_name = body.get("repository_name")

        if not auth_token:
            return {"success": False, "error": "Missing authorization header"}

        if not repository_name:
            return {"success": False, "error": "Missing repository_name"}

        user_id = resolve_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Updating skill repository {repository_name}")

        # Get repository
        def get_repo():
            return execute_query(
                "SELECT * FROM skill_repositories WHERE user_id = %s AND name = %s",
                (user_id, repository_name),
                fetch="one"
            )

        repo = await asyncio.get_event_loop().run_in_executor(None, get_repo)

        if not repo:
            return {
                "success": False,
                "error": f"Repository '{repository_name}' not found"
            }

        workspace_path = get_user_workspace_path(user_id)
        repo_dir = get_skill_repo_dir(workspace_path, repository_name)

        if not await is_git_repository(repo_dir):
            return {
                "success": False,
                "error": f"Repository '{repository_name}' is not a git repository"
            }

        # Fetch and reset
        branch = repo.get("branch", "main")
        credential_name = repo.get("credential_name")

        fetch_kwargs = dict(
            repo_dir=repo_dir,
            branch=branch,
            user_id=user_id,
        )
        if credential_name:
            fetch_kwargs["credential_name"] = credential_name

        success, result, had_changes = await fetch_and_reset(**fetch_kwargs)

        if not success:
            return {
                "success": False,
                "error": f"Failed to update: {result}"
            }

        new_commit_sha = result

        # Re-discover skills
        discovered_skills = discover_all_skills_in_repo(repo_dir)

        # Update database
        def update_db():
            execute_query(
                """
                UPDATE skill_repositories SET
                    skills = %s,
                    git_commit_sha = %s,
                    last_synced_at = NOW(),
                    updated_at = NOW()
                WHERE user_id = %s AND name = %s
                """,
                (json.dumps(discovered_skills), new_commit_sha, user_id, repository_name),
                fetch="none"
            )

        await asyncio.get_event_loop().run_in_executor(None, update_db)

        logger.info(f"Repository updated: {repository_name} ({len(discovered_skills)} skills)")

        return {
            "success": True,
            "message": f"Repository '{repository_name}' updated",
            "had_changes": had_changes,
            "old_commit_sha": repo.get("git_commit_sha"),
            "new_commit_sha": new_commit_sha,
            "skills_count": len(discovered_skills)
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "updating skill repository")
        }


@router.delete("/repositories/{repo_name}")
async def delete_skill_repository(repo_name: str, request: Request):
    """
    Delete a skill repository and all associated installed skills.

    Path params:
        repo_name: Repository name

    Returns:
        {
            "success": bool,
            "message": str
        }
    """
    try:
        auth_token = request.headers.get("authorization", "")
        if not auth_token:
            return {"success": False, "error": "Missing authorization header"}

        user_id = resolve_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Deleting skill repository {repo_name}")

        # Get repository
        def get_and_delete():
            repo = execute_query(
                "SELECT * FROM skill_repositories WHERE user_id = %s AND name = %s",
                (user_id, repo_name),
                fetch="one"
            )

            if not repo:
                return None, 0

            # Delete installed skills first
            skills_deleted = execute_query(
                "DELETE FROM installed_skills WHERE user_id = %s AND repository_name = %s RETURNING id",
                (user_id, repo_name),
                fetch="all"
            )

            # Delete repository
            execute_query(
                "DELETE FROM skill_repositories WHERE id = %s",
                (repo["id"],),
                fetch="none"
            )

            return repo, len(skills_deleted)

        repo, skills_count = await asyncio.get_event_loop().run_in_executor(None, get_and_delete)

        if not repo:
            return {
                "success": False,
                "error": f"Repository '{repo_name}' not found"
            }

        # Remove git directory
        workspace_path = get_user_workspace_path(user_id)
        repo_dir = get_skill_repo_dir(workspace_path, repo_name)

        if await remove_repository(repo_dir):
            logger.info(f"Removed git repository: {repo_dir}")

        logger.info(f"Repository deleted: {repo_name} ({skills_count} skills uninstalled)")

        return {
            "success": True,
            "message": f"Repository '{repo_name}' deleted ({skills_count} skills uninstalled)"
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "deleting skill repository")
        }
