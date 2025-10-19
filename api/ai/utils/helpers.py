"""
Utility functions for source management and document processing.
"""

import json
import os
import hashlib
import logging
from datetime import datetime
from typing import List
from pathlib import Path

logger = logging.getLogger(__name__)


def generate_source_id(github_url: str) -> str:
    """Generate unique ID for source"""
    return hashlib.md5(github_url.encode()).hexdigest()[:12]


def detect_source_type(github_url: str) -> str:
    """Detect if URL is file or repo"""
    if "/blob/" in github_url or github_url.endswith((".md", ".txt", ".rst")):
        return "github_file"
    return "github_repo"


def load_indexed_sources(sources_file: str) -> List[dict]:
    """Load indexed sources from JSON file"""
    try:
        if os.path.exists(sources_file):
            with open(sources_file, 'r') as f:
                data = json.load(f)
                return data.get('indexed_sources', [])
        return []
    except Exception as e:
        logger.error(f"Error loading sources: {str(e)}")
        return []


async def save_indexed_source(source_info: dict, sources_file: str):
    """Add or update a source in the JSON file"""
    try:
        # Load existing sources
        if os.path.exists(sources_file):
            with open(sources_file, 'r') as f:
                data = json.load(f)
        else:
            data = {"indexed_sources": [], "last_reindex": None, "total_sources": 0}

        sources = data["indexed_sources"]

        # Check if source already exists (update vs add)
        existing_index = None
        for i, source in enumerate(sources):
            if source["url"] == source_info["url"]:
                existing_index = i
                break

        if existing_index is not None:
            # Update existing
            sources[existing_index] = source_info
        else:
            # Add new
            sources.append(source_info)

        # Update metadata
        data["indexed_sources"] = sources
        data["total_sources"] = len(sources)
        data["last_update"] = datetime.now().isoformat()

        # Save back to file
        with open(sources_file, 'w') as f:
            json.dump(data, f, indent=2)

    except Exception as e:
        logger.error(f"Error saving source: {str(e)}")


async def save_indexed_sources(sources: List[dict], sources_file: str):
    """Save all sources back to JSON file"""
    try:
        data = {
            "indexed_sources": sources,
            "last_reindex": datetime.now().isoformat(),
            "total_sources": len(sources)
        }

        with open(sources_file, 'w') as f:
            json.dump(data, f, indent=2)

    except Exception as e:
        logger.error(f"Error saving sources: {str(e)}")


async def clear_collection(rag_memory):
    """Clear all documents from ChromaDB collection"""
    try:
        # Access ChromaDB collection using multiple methods
        collection = None
        if hasattr(rag_memory, '_collection') and rag_memory._collection is not None:
            collection = rag_memory._collection
        elif hasattr(rag_memory, '_client') and rag_memory._client is not None:
            client = rag_memory._client
            collection = client.get_collection(name="autogen_docs")
        else:
            import chromadb
            persistence_path = os.path.join(str(Path.home()), ".chromadb_autogen")
            client = chromadb.PersistentClient(path=persistence_path)
            collection = client.get_collection(name="autogen_docs")

        if collection:
            # Get all document IDs
            result = collection.get()
            if result['ids']:
                # Delete all documents
                collection.delete(ids=result['ids'])
                logger.info(f"Cleared {len(result['ids'])} documents from collection")
                return len(result['ids'])
            else:
                logger.info("Collection is already empty")
                return 0
        else:
            logger.warning("Could not access ChromaDB collection")
            return 0

    except Exception as e:
        logger.error(f"Error clearing collection: {str(e)}")
        raise
