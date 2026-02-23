"""
Shared pytest fixtures for authz tests.
"""

import sys
from pathlib import Path

import pytest

# Add api/ai to sys.path so authz module can be imported
sys.path.insert(0, str(Path(__file__).parent.parent))

from .test_data import MOCK_MEMBERSHIPS, MOCK_PROJECTS


@pytest.fixture
def mock_memberships():
    """Provide mock memberships data for tests."""
    return MOCK_MEMBERSHIPS


@pytest.fixture
def mock_projects():
    """Provide mock projects data for tests."""
    return MOCK_PROJECTS
