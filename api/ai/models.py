"""
Pydantic models for API requests and responses.
"""

from typing import List
from pydantic import BaseModel


class IncidentRunbookRequest(BaseModel):
    incident_id: str
    incident_title: str
    incident_description: str
    severity: str = "high"
    keywords: List[str] = []


class RunbookResult(BaseModel):
    title: str
    content: str
    score: float
    relevance_keywords: List[str] = []


class RunbookRetrievalResponse(BaseModel):
    incident_id: str
    runbooks_found: int
    runbooks: List[RunbookResult]
    search_query: str


class GitHubIndexRequest(BaseModel):
    github_url: str
    user_id: str = "anonymous"
    branch: str = "main"


class GitHubIndexResponse(BaseModel):
    status: str
    message: str
    files_processed: int
    chunks_indexed: int
    github_url: str


class DocumentListResponse(BaseModel):
    total_documents: int  # Number of unique sources/files
    total_chunks: int     # Total number of chunks across all documents
    documents: List[dict]
    collection_name: str


class DocumentStatsResponse(BaseModel):
    total_documents: int
    collection_name: str
    sources: dict  # source type -> count
    total_chunks: int


class DocumentDetailResponse(BaseModel):
    document_id: str
    source_display: str
    metadata: dict
    chunks: List[dict]
    total_chunks: int
