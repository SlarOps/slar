"""
Utility functions and helpers for SLAR AI.

This module contains:
- Document indexers for processing various document sources
- Helper functions for source management
- SLAR-specific tool functions
"""

from .indexers import SimpleDocumentIndexer, ContentDocumentIndexer, GitHubDocumentIndexer
from .helpers import (
    generate_source_id,
    detect_source_type,
    load_indexed_sources,
    save_indexed_source,
    save_indexed_sources,
    clear_collection,
)
from .slar_tools import get_incidents

__all__ = [
    # Indexers
    "SimpleDocumentIndexer",
    "ContentDocumentIndexer",
    "GitHubDocumentIndexer",
    # Helpers
    "generate_source_id",
    "detect_source_type",
    "load_indexed_sources",
    "save_indexed_source",
    "save_indexed_sources",
    "clear_collection",
    # SLAR Tools
    "get_incidents",
]
