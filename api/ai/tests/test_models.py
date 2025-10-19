"""
Tests for the models module.
"""

import pytest
from models.schemas import (
    IncidentRunbookRequest,
    RunbookResult,
    RunbookRetrievalResponse,
    GitHubIndexRequest,
    GitHubIndexResponse,
    DocumentListResponse,
    DocumentStatsResponse,
    DocumentDetailResponse,
)


def test_incident_runbook_request():
    """Test IncidentRunbookRequest model."""
    request = IncidentRunbookRequest(
        incident_id="INC-001",
        incident_title="Database Connection Error",
        incident_description="Cannot connect to production database",
        severity="high",
        keywords=["database", "connection", "production"]
    )

    assert request.incident_id == "INC-001"
    assert request.severity == "high"
    assert len(request.keywords) == 3


def test_runbook_result():
    """Test RunbookResult model."""
    result = RunbookResult(
        title="Database Recovery Procedure",
        content="Step-by-step recovery process...",
        score=0.95,
        relevance_keywords=["database", "recovery"]
    )

    assert result.title == "Database Recovery Procedure"
    assert result.score == 0.95
    assert len(result.relevance_keywords) == 2


def test_github_index_request():
    """Test GitHubIndexRequest model."""
    request = GitHubIndexRequest(
        github_url="https://github.com/user/repo",
        user_id="test_user",
        branch="develop"
    )

    assert request.github_url == "https://github.com/user/repo"
    assert request.user_id == "test_user"
    assert request.branch == "develop"


def test_github_index_request_defaults():
    """Test GitHubIndexRequest with default values."""
    request = GitHubIndexRequest(
        github_url="https://github.com/user/repo"
    )

    assert request.user_id == "anonymous"
    assert request.branch == "main"


def test_github_index_response():
    """Test GitHubIndexResponse model."""
    response = GitHubIndexResponse(
        status="success",
        message="Repository indexed successfully",
        files_processed=42,
        chunks_indexed=150,
        github_url="https://github.com/user/repo"
    )

    assert response.status == "success"
    assert response.files_processed == 42
    assert response.chunks_indexed == 150


def test_document_list_response():
    """Test DocumentListResponse model."""
    response = DocumentListResponse(
        total_documents=10,
        total_chunks=50,
        documents=[{"id": "doc1", "name": "test.md"}],
        collection_name="test_collection"
    )

    assert response.total_documents == 10
    assert response.total_chunks == 50
    assert len(response.documents) == 1
