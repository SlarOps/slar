"""
Direct Skill Installation - Clone single skill folder from GitHub URL.

Supports URLs like:
- https://github.com/anthropics/skills/tree/main/skills/frontend-design
- https://github.com/owner/repo/tree/branch/path/to/skill

Only clones the specific folder, not the entire repository.
Uses git sparse-checkout for efficiency.

Endpoints:
- POST /api/skills/install-from-url - Install skill from GitHub URL (direct)
"""

import asyncio
import json
import logging
import re
import subprocess
from pathlib import Path
from typing import Optional, Tuple

from fastapi import APIRouter, Request

from workspace_service import get_user_workspace_path
from database_util import execute_query, resolve_user_id_from_token
from routes_marketplace import parse_yaml_frontmatter, sanitize_error_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/skills", tags=["skills-direct"])


def parse_github_skill_url(url: str) -> Optional[dict]:
    """
    Parse GitHub URL with path to extract components.

    Examples:
    - https://github.com/anthropics/skills/tree/main/skills/frontend-design
    - https://github.com/owner/repo/tree/branch/path/to/skill

    Returns:
        {
            "owner": "anthropics",
            "repo": "skills",
            "branch": "main",
            "path": "skills/frontend-design",
            "skill_name": "frontend-design"
        }
    """
    # Pattern: github.com/owner/repo/tree/branch/path/to/skill
    pattern = r'github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+)'
    match = re.search(pattern, url)

    if not match:
        return None

    owner = match.group(1)
    repo = match.group(2)
    branch = match.group(3)
    path = match.group(4).rstrip('/')

    # Extract skill name from path (last folder)
    skill_name = Path(path).name

    return {
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "path": path,
        "skill_name": skill_name
    }


async def clone_skill_folder(
    repo_url: str,
    target_dir: Path,
    branch: str,
    skill_path: str,
    user_id: str = None,
    credential_name: str = None
) -> Tuple[bool, str]:
    """
    Clone only a specific folder from a Git repository using sparse-checkout.

    Args:
        repo_url: Full GitHub repository URL (e.g., https://github.com/anthropics/skills)
        target_dir: Where to clone (e.g., .claude/skills/frontend-design)
        branch: Branch name
        skill_path: Path to skill folder in repo (e.g., skills/frontend-design)
        user_id: User ID for credential lookup
        credential_name: Optional credential name

    Returns:
        (success: bool, commit_sha_or_error: str)
    """
    try:
        # Resolve target_dir and validate skill_path to prevent traversal attacks
        target_dir = target_dir.resolve()
        # Validate skill_path: must be a relative, non-traversing path
        if not re.match(r"^[A-Za-z0-9._-][A-Za-z0-9._/-]*$", skill_path or ""):
            return False, "Invalid skill path"
        skill_folder_resolved = (target_dir / skill_path).resolve()
        if not skill_folder_resolved.is_relative_to(target_dir):
            return False, "Invalid skill path: directory traversal detected"

        # If target directory exists, remove it first
        # This handles cases like:
        # - Clone succeeded but DB insert failed
        # - Volume data loss requiring re-sync
        # - Manual cleanup needed
        if target_dir.exists():
            import shutil
            logger.warning(f"Target directory exists, removing: {target_dir}")
            shutil.rmtree(target_dir)

        target_dir.mkdir(parents=True, exist_ok=True)

        # Inject Vault credentials if available
        clone_url = repo_url
        if user_id and credential_name:
            # Use the same credential injection pattern as git_utils
            from git_utils import _inject_vault_credentials
            clone_url = await _inject_vault_credentials(repo_url, user_id, credential_name)
            if clone_url != repo_url:
                logger.info(f"Using credential: {credential_name}")

        # Step 1: Initialize git repository
        subprocess.run(
            ["git", "init"],
            cwd=target_dir,
            check=True,
            capture_output=True,
            text=True
        )

        # Step 2: Add remote
        subprocess.run(
            ["git", "remote", "add", "origin", clone_url],
            cwd=target_dir,
            check=True,
            capture_output=True,
            text=True
        )

        # Step 3: Enable sparse-checkout
        subprocess.run(
            ["git", "config", "core.sparseCheckout", "true"],
            cwd=target_dir,
            check=True,
            capture_output=True,
            text=True
        )

        # Step 4: Configure sparse-checkout to only include the skill folder
        sparse_checkout_file = target_dir / ".git" / "info" / "sparse-checkout"
        sparse_checkout_file.parent.mkdir(parents=True, exist_ok=True)
        sparse_checkout_file.write_text(f"{skill_path}\n")

        # Step 5: Fetch with depth=1 (shallow clone)
        subprocess.run(
            ["git", "fetch", "--depth=1", "origin", branch],
            cwd=target_dir,
            check=True,
            capture_output=True,
            text=True,
            timeout=300
        )

        # Step 6: Checkout the branch
        subprocess.run(
            ["git", "checkout", branch],
            cwd=target_dir,
            check=True,
            capture_output=True,
            text=True
        )

        # Step 7: Get commit SHA
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=target_dir,
            check=True,
            capture_output=True,
            text=True
        )
        commit_sha = result.stdout.strip()

        # Step 8: Move skill folder contents to root of target_dir
        # After sparse checkout: target_dir/skills/frontend-design/SKILL.md
        # We want: target_dir/SKILL.md
        # skill_folder_resolved was already computed and validated above
        skill_folder_in_checkout = skill_folder_resolved

        if skill_folder_in_checkout.exists() and skill_folder_in_checkout != target_dir:
            import shutil

            # Create temp directory for moving
            temp_dir = target_dir.parent / f"{target_dir.name}_temp"

            # Move git folder to temp
            git_dir = target_dir / ".git"
            temp_git = temp_dir / ".git"
            temp_dir.mkdir(exist_ok=True)
            if git_dir.exists():
                shutil.move(str(git_dir), str(temp_git))

            # Move skill contents to temp
            for item in skill_folder_in_checkout.iterdir():
                shutil.move(str(item), str(temp_dir / item.name))

            # Remove old structure
            shutil.rmtree(target_dir)

            # Rename temp to target
            temp_dir.rename(target_dir)

            logger.info(f"Restructured: moved {skill_path} contents to root")

        logger.info(f"Sparse checkout completed: {skill_path} → {target_dir}")
        return True, commit_sha

    except subprocess.CalledProcessError as e:
        error_msg = f"Git command failed: {e.stderr if e.stderr else str(e)}"
        logger.error(error_msg)

        # Cleanup on failure
        if target_dir.exists():
            import shutil
            shutil.rmtree(target_dir, ignore_errors=True)

        return False, error_msg

    except Exception as e:
        logger.error(f"Clone failed: {e}", exc_info=True)

        # Cleanup on failure
        if target_dir.exists():
            import shutil
            shutil.rmtree(target_dir, ignore_errors=True)

        return False, str(e)


@router.post("/install-from-url")
async def install_skill_from_url(request: Request):
    """
    Install a single skill directly from GitHub URL.

    This clones ONLY the skill folder, not the entire repository.
    Perfect for URLs like: https://github.com/anthropics/skills/tree/main/skills/frontend-design

    Request body:
        {
            "skill_url": "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
            "credential_name": "github-token"  // Optional for private repos
        }

    Returns:
        {
            "success": bool,
            "skill": {
                "name": "frontend-design",
                "description": "...",
                "path": ".claude/skills/frontend-design"
            }
        }
    """
    try:
        body = await request.json()
        auth_token = request.headers.get("authorization", "")
        skill_url = body.get("skill_url")
        credential_name = body.get("credential_name")

        if not auth_token:
            return {"success": False, "error": "Missing authorization header"}

        if not skill_url:
            return {"success": False, "error": "Missing skill_url"}

        # Parse GitHub URL
        parsed = parse_github_skill_url(skill_url)
        if not parsed:
            return {
                "success": False,
                "error": "Invalid GitHub skill URL. Expected format: https://github.com/owner/repo/tree/branch/path/to/skill"
            }

        owner = parsed["owner"]
        repo = parsed["repo"]
        branch = parsed["branch"]
        skill_path = parsed["path"]
        skill_name = parsed["skill_name"]

        user_id = resolve_user_id_from_token(auth_token)
        logger.info(f"User {user_id}: Installing skill from URL: {skill_url}")

        # Check if skill already installed
        def check_exists():
            return execute_query(
                "SELECT id FROM installed_skills WHERE user_id = %s AND skill_name = %s AND repository_name = %s",
                (user_id, skill_name, f"{owner}-{repo}"),
                fetch="one"
            )

        existing = await asyncio.get_event_loop().run_in_executor(None, check_exists)
        if existing:
            return {
                "success": False,
                "error": f"Skill '{skill_name}' is already installed"
            }

        # Build paths — validate skill_name to prevent path traversal
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", skill_name or ""):
            return {"success": False, "error": "Invalid skill name"}
        workspace_path = get_user_workspace_path(user_id)
        skills_root = (workspace_path / ".claude" / "skills").resolve()
        skill_dir = (skills_root / skill_name).resolve()
        if not skill_dir.is_relative_to(skills_root):
            return {"success": False, "error": "Invalid skill name"}
        repo_url = f"https://github.com/{owner}/{repo}"

        logger.info(f"Cloning skill folder: {skill_path} → {skill_dir}")

        # Clone only the skill folder using sparse-checkout
        success, result = await clone_skill_folder(
            repo_url=repo_url,
            target_dir=skill_dir,
            branch=branch,
            skill_path=skill_path,
            user_id=user_id,
            credential_name=credential_name
        )

        if not success:
            logger.error(f"Failed to clone skill '{skill_name}': {result}")
            return {
                "success": False,
                "error": "Failed to clone skill. Check server logs for details."
            }

        commit_sha = result
        logger.info(f"Skill cloned successfully (commit: {commit_sha[:8]})")

        # Find and parse SKILL.md (should be at root after restructuring)
        skill_md_path = skill_dir / "SKILL.md"

        if not skill_md_path.exists():
            # Fallback: search for SKILL.md in subdirectories
            skill_md_files = list(skill_dir.rglob("SKILL.md"))
            if skill_md_files:
                skill_md_path = skill_md_files[0]
            else:
                logger.warning(f"SKILL.md not found in {skill_dir}")

        skill_metadata = {
            "name": skill_name,
            "description": "",
            "path": "SKILL.md"  # Always at root after restructuring
        }

        if skill_md_path.exists():
            frontmatter = parse_yaml_frontmatter(skill_md_path)
            if frontmatter:
                skill_metadata["name"] = frontmatter.get("name", skill_name)
                skill_metadata["description"] = frontmatter.get("description", "")
            skill_metadata["path"] = str(skill_md_path.relative_to(skill_dir))

        # Save to database
        def save_to_db():
            # Insert into installed_skills
            execute_query(
                """
                INSERT INTO installed_skills (user_id, skill_name, repository_name, skill_path, version, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    user_id,
                    skill_metadata["name"],
                    f"{owner}-{repo}",  # Repository reference
                    skill_metadata["path"],
                    commit_sha[:8],  # Use commit as version
                    "active"
                ),
                fetch="none"
            )

            # Return inserted record
            return execute_query(
                "SELECT * FROM installed_skills WHERE user_id = %s AND skill_name = %s AND repository_name = %s",
                (user_id, skill_metadata["name"], f"{owner}-{repo}"),
                fetch="one"
            )

        skill_record = await asyncio.get_event_loop().run_in_executor(None, save_to_db)

        logger.info(f"Skill installed from URL: {skill_metadata['name']}")

        return {
            "success": True,
            "message": f"Skill '{skill_metadata['name']}' installed successfully",
            "skill": {
                "id": skill_record["id"],
                "name": skill_metadata["name"],
                "description": skill_metadata["description"],
                "path": str(skill_dir.relative_to(workspace_path)),
                "repository": f"{owner}/{repo}",
                "source_url": skill_url,
                "installed_at": skill_record["created_at"]
            }
        }

    except Exception as e:
        return {
            "success": False,
            "error": sanitize_error_message(e, "installing skill from URL")
        }
