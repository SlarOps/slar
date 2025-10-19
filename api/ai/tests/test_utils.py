"""
Tests for the utils module.
"""

import pytest
from utils.helpers import (
    generate_source_id,
    detect_source_type,
)


def test_generate_source_id():
    """Test source ID generation."""
    url1 = "https://github.com/user/repo"
    url2 = "https://github.com/user/repo"
    url3 = "https://github.com/user/different"

    id1 = generate_source_id(url1)
    id2 = generate_source_id(url2)
    id3 = generate_source_id(url3)

    # Same URL should generate same ID
    assert id1 == id2
    # Different URL should generate different ID
    assert id1 != id3
    # ID should be 12 characters
    assert len(id1) == 12


def test_detect_source_type_file():
    """Test source type detection for files."""
    file_urls = [
        "https://github.com/user/repo/blob/main/README.md",
        "https://example.com/doc.txt",
        "https://example.com/guide.rst",
    ]

    for url in file_urls:
        assert detect_source_type(url) == "github_file"


def test_detect_source_type_repo():
    """Test source type detection for repositories."""
    repo_urls = [
        "https://github.com/user/repo",
        "https://github.com/user/repo/tree/main",
    ]

    for url in repo_urls:
        assert detect_source_type(url) == "github_repo"
