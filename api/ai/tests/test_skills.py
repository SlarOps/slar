"""
Unit tests for Skill Management API (Option 1B - Separate Skill Tab).

Tests cover:
1. Add skill repository (clone and discover skills)
2. Install individual skill
3. List skill repositories
4. List installed skills
5. Uninstall skill
6. Skill discovery in repositories

Test Strategy:
- Use pytest with async support
- Mock git operations (clone, fetch)
- Mock database operations
- Mock file system operations
- Verify skill discovery logic
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch, mock_open
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.test_data import (
    USER_ORG_ADMIN_ID,
    PROJECT_WEB_ID,
)


# ============================================================
# Test Data
# ============================================================

SKILL_REPO_URL = "https://github.com/numman-ali/openskills"
SKILL_REPO_OWNER = "numman-ali"
SKILL_REPO_NAME = "openskills"
SKILL_REPO_BRANCH = "main"
SKILL_COMMIT_SHA = "abc123def456"

# Mock SKILL.md content with YAML frontmatter
MOCK_SKILL_MD_CONTENT = """---
name: vnstock-analyzer
description: Analyze Vietnamese stocks using vnstock library
version: 1.0.0
---

# VNStock Analyzer

This skill analyzes Vietnamese stocks.
"""

# Mock discovered skills
MOCK_DISCOVERED_SKILLS = [
    {
        "name": "vnstock-analyzer",
        "description": "Analyze Vietnamese stocks using vnstock library",
        "path": "vnstock-analyzer/SKILL.md"
    },
    {
        "name": "crypto-tracker",
        "description": "Track cryptocurrency prices",
        "path": "crypto-tracker/SKILL.md"
    }
]

# Mock skill repository record (DB)
MOCK_SKILL_REPO_RECORD = {
    "id": "repo-uuid-123",
    "user_id": USER_ORG_ADMIN_ID,
    "name": SKILL_REPO_NAME,
    "repository_url": SKILL_REPO_URL,
    "branch": SKILL_REPO_BRANCH,
    "skills": MOCK_DISCOVERED_SKILLS,
    "git_commit_sha": SKILL_COMMIT_SHA,
    "status": "active",
}

# Mock installed skill record (DB)
MOCK_INSTALLED_SKILL_RECORD = {
    "id": "skill-install-uuid-123",
    "user_id": USER_ORG_ADMIN_ID,
    "skill_name": "vnstock-analyzer",
    "repository_name": SKILL_REPO_NAME,
    "skill_path": "vnstock-analyzer/SKILL.md",
    "version": "1.0.0",
    "status": "active",
}


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def app():
    """Create FastAPI app with skill routes."""
    app = FastAPI()
    # Will import routes_skills when implemented
    # from routes_skills import router
    # app.include_router(router)
    return app


@pytest.fixture
def mock_user_context():
    """Mock authenticated user context."""
    return {"user_id": USER_ORG_ADMIN_ID}


@pytest.fixture
def mock_workspace_path(tmp_path):
    """Mock user workspace path."""
    workspace = tmp_path / "workspaces" / USER_ORG_ADMIN_ID
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace


@pytest.fixture
def mock_skill_repo_dir(mock_workspace_path):
    """Mock skill repository directory structure."""
    skill_repo_dir = mock_workspace_path / ".claude" / "skills" / SKILL_REPO_NAME
    skill_repo_dir.mkdir(parents=True, exist_ok=True)

    # Create skill directories with SKILL.md files
    for skill in MOCK_DISCOVERED_SKILLS:
        skill_dir = skill_repo_dir / Path(skill["path"]).parent
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text(MOCK_SKILL_MD_CONTENT)

    return skill_repo_dir


# ============================================================
# Test: Skill Discovery Functions
# ============================================================

class TestSkillDiscovery:
    """Test skill discovery logic (scan SKILL.md files)."""

    def test_parse_yaml_frontmatter_valid(self):
        """Should parse valid YAML frontmatter from SKILL.md."""
        # This will test the parse_yaml_frontmatter function
        # Expected: Extract name, description, version from frontmatter
        pass

    def test_parse_yaml_frontmatter_missing(self):
        """Should return None if no frontmatter in SKILL.md."""
        pass

    def test_parse_yaml_frontmatter_invalid_yaml(self):
        """Should handle invalid YAML gracefully."""
        pass

    def test_discover_all_skills_in_repo_multiple_skills(self, mock_skill_repo_dir):
        """Should discover all SKILL.md files recursively in repo."""
        # Expected: Find 2 skills (vnstock-analyzer, crypto-tracker)
        pass

    def test_discover_all_skills_in_repo_nested_structure(self):
        """Should discover skills in deeply nested directories."""
        # Test structure: folder/subfolder/skill-name/SKILL.md
        pass

    def test_discover_all_skills_in_repo_skip_hidden_folders(self):
        """Should skip SKILL.md files in hidden folders (e.g., .git)."""
        pass

    def test_discover_all_skills_in_repo_empty_repo(self, tmp_path):
        """Should return empty list if no SKILL.md files found."""
        pass


# ============================================================
# Test: Add Skill Repository
# ============================================================

class TestAddSkillRepository:
    """Test POST /api/skills/add-repository endpoint."""

    @pytest.mark.asyncio
    async def test_add_skill_repo_success(self, app, mock_user_context):
        """Should successfully clone skill repo and discover skills."""
        # Mock git clone
        # Mock skill discovery
        # Mock database insert
        # Expected: Return 200 with discovered skills
        pass

    @pytest.mark.asyncio
    async def test_add_skill_repo_missing_auth_token(self, app):
        """Should return 400 if auth_token missing."""
        pass

    @pytest.mark.asyncio
    async def test_add_skill_repo_missing_url(self, app, mock_user_context):
        """Should return 400 if repository_url missing."""
        pass

    @pytest.mark.asyncio
    async def test_add_skill_repo_invalid_github_url(self, app, mock_user_context):
        """Should return 400 if URL is not valid GitHub URL."""
        pass

    @pytest.mark.asyncio
    async def test_add_skill_repo_already_exists(self, app, mock_user_context):
        """Should return 409 if repository already added."""
        pass

    @pytest.mark.asyncio
    async def test_add_skill_repo_clone_failure(self, app, mock_user_context):
        """Should return 500 if git clone fails."""
        pass

    @pytest.mark.asyncio
    async def test_add_skill_repo_no_skills_found(self, app, mock_user_context):
        """Should succeed but warn if no SKILL.md files found."""
        pass


# ============================================================
# Test: Install Individual Skill
# ============================================================

class TestInstallSkill:
    """Test POST /api/skills/install endpoint."""

    @pytest.mark.asyncio
    async def test_install_skill_success(self, app, mock_user_context):
        """Should successfully install individual skill."""
        # Mock: Verify repo exists
        # Mock: Verify skill exists in repo
        # Mock: Insert into installed_skills table
        # Expected: Return 200 with skill info
        pass

    @pytest.mark.asyncio
    async def test_install_skill_missing_fields(self, app, mock_user_context):
        """Should return 400 if required fields missing."""
        pass

    @pytest.mark.asyncio
    async def test_install_skill_repository_not_found(self, app, mock_user_context):
        """Should return 404 if repository not added."""
        pass

    @pytest.mark.asyncio
    async def test_install_skill_not_found_in_repo(self, app, mock_user_context):
        """Should return 404 if skill not found in repository."""
        pass

    @pytest.mark.asyncio
    async def test_install_skill_already_installed(self, app, mock_user_context):
        """Should return 409 if skill already installed."""
        pass

    @pytest.mark.asyncio
    async def test_install_skill_unauthorized(self, app):
        """Should return 401 if user not authenticated."""
        pass


# ============================================================
# Test: List Skill Repositories
# ============================================================

class TestListSkillRepositories:
    """Test GET /api/skills/repositories endpoint."""

    @pytest.mark.asyncio
    async def test_list_skill_repos_success(self, app, mock_user_context):
        """Should return all skill repositories for user."""
        pass

    @pytest.mark.asyncio
    async def test_list_skill_repos_empty(self, app, mock_user_context):
        """Should return empty array if no repos added."""
        pass

    @pytest.mark.asyncio
    async def test_list_skill_repos_with_skill_count(self, app, mock_user_context):
        """Should include skill count for each repository."""
        pass

    @pytest.mark.asyncio
    async def test_list_skill_repos_unauthorized(self, app):
        """Should return 401 if not authenticated."""
        pass


# ============================================================
# Test: List Installed Skills
# ============================================================

class TestListInstalledSkills:
    """Test GET /api/skills/installed endpoint."""

    @pytest.mark.asyncio
    async def test_list_installed_skills_success(self, app, mock_user_context):
        """Should return all installed skills for user."""
        pass

    @pytest.mark.asyncio
    async def test_list_installed_skills_empty(self, app, mock_user_context):
        """Should return empty array if no skills installed."""
        pass

    @pytest.mark.asyncio
    async def test_list_installed_skills_with_repo_info(self, app, mock_user_context):
        """Should include repository info for each skill."""
        pass

    @pytest.mark.asyncio
    async def test_list_installed_skills_filter_by_repo(self, app, mock_user_context):
        """Should filter by repository_name if provided."""
        pass


# ============================================================
# Test: Uninstall Skill
# ============================================================

class TestUninstallSkill:
    """Test DELETE /api/skills/uninstall/{skill_id} endpoint."""

    @pytest.mark.asyncio
    async def test_uninstall_skill_success(self, app, mock_user_context):
        """Should successfully uninstall skill."""
        pass

    @pytest.mark.asyncio
    async def test_uninstall_skill_not_found(self, app, mock_user_context):
        """Should return 404 if skill not installed."""
        pass

    @pytest.mark.asyncio
    async def test_uninstall_skill_unauthorized_different_user(self, app):
        """Should return 403 if skill belongs to different user."""
        pass

    @pytest.mark.asyncio
    async def test_uninstall_skill_invalid_id(self, app, mock_user_context):
        """Should return 400 if skill_id invalid."""
        pass


# ============================================================
# Test: Update Skill Repository
# ============================================================

class TestUpdateSkillRepository:
    """Test POST /api/skills/update endpoint."""

    @pytest.mark.asyncio
    async def test_update_skill_repo_success(self, app, mock_user_context):
        """Should successfully update repository via git fetch."""
        pass

    @pytest.mark.asyncio
    async def test_update_skill_repo_no_changes(self, app, mock_user_context):
        """Should indicate when repository already up to date."""
        pass

    @pytest.mark.asyncio
    async def test_update_skill_repo_new_skills_discovered(self, app, mock_user_context):
        """Should discover new skills after update."""
        pass

    @pytest.mark.asyncio
    async def test_update_skill_repo_not_found(self, app, mock_user_context):
        """Should return 404 if repository not found."""
        pass

    @pytest.mark.asyncio
    async def test_update_skill_repo_git_fetch_failure(self, app, mock_user_context):
        """Should return 500 if git fetch fails."""
        pass


# ============================================================
# Test: Delete Skill Repository
# ============================================================

class TestDeleteSkillRepository:
    """Test DELETE /api/skills/repositories/{repo_name} endpoint."""

    @pytest.mark.asyncio
    async def test_delete_skill_repo_success(self, app, mock_user_context):
        """Should successfully delete repository and all installed skills."""
        pass

    @pytest.mark.asyncio
    async def test_delete_skill_repo_cascade_uninstall(self, app, mock_user_context):
        """Should uninstall all skills from deleted repository."""
        pass

    @pytest.mark.asyncio
    async def test_delete_skill_repo_not_found(self, app, mock_user_context):
        """Should return 404 if repository not found."""
        pass

    @pytest.mark.asyncio
    async def test_delete_skill_repo_cleanup_files(self, app, mock_user_context):
        """Should remove git repository directory from workspace."""
        pass


# ============================================================
# Test: Edge Cases & Error Handling
# ============================================================

class TestSkillAPIEdgeCases:
    """Test edge cases and error handling."""

    @pytest.mark.asyncio
    async def test_skill_with_no_frontmatter(self, app):
        """Should use folder name as skill name if no frontmatter."""
        pass

    @pytest.mark.asyncio
    async def test_skill_with_malformed_frontmatter(self, app):
        """Should handle malformed YAML gracefully."""
        pass

    @pytest.mark.asyncio
    async def test_concurrent_skill_installation(self, app, mock_user_context):
        """Should handle concurrent installations safely."""
        pass

    @pytest.mark.asyncio
    async def test_install_skill_from_private_repo(self, app, mock_user_context):
        """Should support private repos with credentials."""
        pass

    @pytest.mark.asyncio
    async def test_skill_path_traversal_prevention(self, app, mock_user_context):
        """Should prevent path traversal attacks in skill paths."""
        pass


# ============================================================
# Test: Integration with Agent Loading
# ============================================================

class TestSkillLoadingIntegration:
    """Test integration with AI agent skill loading."""

    @pytest.mark.asyncio
    async def test_load_installed_skills_for_agent(self, app, mock_user_context):
        """Should load only installed skills for agent."""
        pass

    @pytest.mark.asyncio
    async def test_skill_isolation_between_users(self, app):
        """Should isolate skills between different users."""
        pass

    @pytest.mark.asyncio
    async def test_skill_priority_over_plugin_skills(self, app, mock_user_context):
        """Should handle priority when skill exists in both repo and plugin."""
        pass


# ============================================================
# Performance Tests
# ============================================================

class TestSkillPerformance:
    """Test performance of skill operations."""

    @pytest.mark.asyncio
    async def test_discover_skills_in_large_repo(self, app):
        """Should handle repositories with 100+ skills efficiently."""
        pass

    @pytest.mark.asyncio
    async def test_list_skills_with_pagination(self, app, mock_user_context):
        """Should paginate skill lists for large datasets."""
        pass


# ============================================================
# Test Utilities
# ============================================================

def _create_mock_skill_file(path: Path, name: str, description: str):
    """Helper to create mock SKILL.md file."""
    content = f"""---
name: {name}
description: {description}
---

# {name}

{description}
"""
    path.write_text(content)


def _create_mock_repo_structure(base_path: Path, skills: list):
    """Helper to create mock repository structure with skills."""
    for skill in skills:
        skill_dir = base_path / skill["path"].replace("/SKILL.md", "")
        skill_dir.mkdir(parents=True, exist_ok=True)
        _create_mock_skill_file(
            skill_dir / "SKILL.md",
            skill["name"],
            skill["description"]
        )
