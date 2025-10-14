"""
Runbook management routes.
"""

import logging
import os
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException

# Import models and utilities with fallback
try:
    from ..models import (
        IncidentRunbookRequest, 
        RunbookRetrievalResponse, 
        RunbookResult,
        GitHubIndexRequest,
        GitHubIndexResponse,
        DocumentListResponse,
        DocumentStatsResponse,
        DocumentDetailResponse
    )
    from ..indexers import GitHubDocumentIndexer
    from ..utils import (
        generate_source_id, 
        detect_source_type, 
        load_indexed_sources,
        save_indexed_source,
        save_indexed_sources,
        clear_collection
    )
except ImportError:
    from models import (
        IncidentRunbookRequest, 
        RunbookRetrievalResponse, 
        RunbookResult,
        GitHubIndexRequest,
        GitHubIndexResponse,
        DocumentListResponse,
        DocumentStatsResponse,
        DocumentDetailResponse
    )
    from indexers import GitHubDocumentIndexer
    from utils import (
        generate_source_id, 
        detect_source_type, 
        load_indexed_sources,
        save_indexed_source,
        save_indexed_sources,
        clear_collection
    )

logger = logging.getLogger(__name__)
router = APIRouter()


def get_main_imports():
    """Helper function to get main imports with fallback."""
    try:
        from ..main import rag_memory, SOURCES_FILE
        return rag_memory, SOURCES_FILE
    except ImportError:
        from main import rag_memory, SOURCES_FILE
        return rag_memory, SOURCES_FILE


@router.post("/runbook/retrieve", response_model=RunbookRetrievalResponse)
async def retrieve_runbook_for_incident(request: IncidentRunbookRequest):
    """
    Retrieve relevant runbooks for a given incident.
    This endpoint uses vector similarity search to find the most relevant runbooks
    based on the incident title, description, and optional keywords.
    """
    try:
        rag_memory, _ = get_main_imports()
        from autogen_core.memory import MemoryContent, MemoryMimeType
        
        # Create search query from incident information
        search_parts = [request.incident_title, request.incident_description]
        if request.keywords:
            search_parts.extend(request.keywords)

        search_query = " ".join(search_parts)

        # Retrieve relevant runbooks using vector memory
        results = await rag_memory.retrieve(
            MemoryContent(content=search_query, mime_type=MemoryMimeType.TEXT)
        )

        # Process results into response format
        runbook_results = []
        for result in results:
            # Extract runbook title from content
            content_lines = result.content.split('\n')
            runbook_title = "Unknown Runbook"
            relevance_keywords = []

            for line in content_lines:
                if line.strip().startswith("RUNBOOK:"):
                    runbook_title = line.strip().replace("RUNBOOK:", "").strip()
                elif line.strip().startswith("KEYWORDS:"):
                    keywords_line = line.strip().replace("KEYWORDS:", "").strip()
                    relevance_keywords = [kw.strip() for kw in keywords_line.split(",")]
                    break

            runbook_results.append(RunbookResult(
                title=runbook_title,
                content=result.content,
                score=result.score,
                relevance_keywords=relevance_keywords
            ))

        return RunbookRetrievalResponse(
            incident_id=request.incident_id,
            runbooks_found=len(runbook_results),
            runbooks=runbook_results,
            search_query=search_query
        )

    except Exception as e:
        logger.error(f"Error retrieving runbooks for incident {request.incident_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve runbooks: {str(e)}")


@router.get("/runbook/test")
async def test_runbook_retrieval():
    """
    Test endpoint to verify runbook retrieval functionality with sample incidents.
    """
    try:
        # Sample test incidents
        test_incidents = [
            {
                "incident_id": "test-cpu-001",
                "incident_title": "High CPU usage detected",
                "incident_description": "CPU usage above 90% for 10 minutes",
                "severity": "critical",
                "keywords": ["cpu", "performance"]
            },
            {
                "incident_id": "test-memory-001",
                "incident_title": "Memory leak in application",
                "incident_description": "Memory usage increasing, OOMKilled events",
                "severity": "high",
                "keywords": ["memory", "oom", "leak"]
            },
            {
                "incident_id": "test-db-001",
                "incident_title": "Database connection issues",
                "incident_description": "Connection timeouts and pool exhaustion",
                "severity": "critical",
                "keywords": ["database", "connection", "timeout"]
            }
        ]

        results = []
        for incident in test_incidents:
            request = IncidentRunbookRequest(**incident)
            runbook_response = await retrieve_runbook_for_incident(request)
            results.append({
                "incident": incident,
                "runbook_retrieval": runbook_response
            })

        return {
            "status": "success",
            "test_results": results,
            "total_tests": len(test_incidents)
        }

    except Exception as e:
        logger.error(f"Error in runbook test: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Test failed: {str(e)}")


@router.post("/runbook/index-github", response_model=GitHubIndexResponse)
async def index_github_runbooks(request: GitHubIndexRequest):
    """
    Index runbooks from GitHub repository or specific files.
    Supports both repository URLs and direct file URLs.
    """
    try:
        rag_memory, SOURCES_FILE = get_main_imports()
        
        # Validate GitHub URL
        if not request.github_url.startswith("https://github.com/"):
            raise HTTPException(status_code=400, detail="Invalid GitHub URL")

        # Create GitHub content indexer
        github_indexer = GitHubDocumentIndexer(memory=rag_memory)

        # Index the GitHub content
        result = await github_indexer.index_github_content(
            github_url=request.github_url,
            branch=request.branch
        )

        # Save source info to JSON for future reindexing
        source_info = {
            "id": generate_source_id(request.github_url),
            "url": request.github_url,
            "branch": request.branch,
            "source_type": detect_source_type(request.github_url),
            "indexed_at": datetime.now().isoformat(),
            "user_id": request.user_id,
            "files_processed": result['files_processed'],
            "chunks_indexed": result['chunks_indexed'],
            "status": "active"
        }

        await save_indexed_source(source_info, SOURCES_FILE)
        logger.info(f"Saved source info for {request.github_url}")

        return GitHubIndexResponse(
            status="success",
            message=f"Successfully indexed {result['files_processed']} files from GitHub",
            files_processed=result['files_processed'],
            chunks_indexed=result['chunks_indexed'],
            github_url=request.github_url
        )

    except Exception as e:
        logger.error(f"Error indexing GitHub runbooks: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to index GitHub runbooks: {str(e)}")


@router.get("/runbook/list-documents", response_model=DocumentListResponse)
async def list_indexed_documents():
    """
    List all documents that have been indexed in the ChromaDB vector memory.
    This endpoint provides visibility into what runbooks and documents are available for retrieval.
    """
    try:
        rag_memory, _ = get_main_imports()
        
        # Try multiple approaches to access the ChromaDB collection
        collection = None
        collection_name = "autogen_docs"  # default

        # Method 1: Try accessing _collection attribute
        if hasattr(rag_memory, '_collection') and rag_memory._collection is not None:
            collection = rag_memory._collection
            if hasattr(rag_memory, '_config'):
                collection_name = rag_memory._config.collection_name

        # Method 2: Try accessing _client and get collection
        elif hasattr(rag_memory, '_client') and rag_memory._client is not None:
            client = rag_memory._client
            if hasattr(rag_memory, '_config'):
                collection_name = rag_memory._config.collection_name
                collection = client.get_collection(name=collection_name)

        # Method 3: Try creating a new client connection
        else:
            import chromadb
            # Use the same persistence path as configured
            persistence_path = os.path.join(str(Path.home()), ".chromadb_autogen")
            client = chromadb.PersistentClient(path=persistence_path)
            collection = client.get_collection(name=collection_name)

        if collection is None:
            raise HTTPException(
                status_code=404,
                detail="ChromaDB collection not found. No documents have been indexed yet."
            )

        # Get all documents from the collection
        result = collection.get()

        # Group documents by source to avoid duplicates
        source_groups = {}

        for i, doc_id in enumerate(result['ids']):
            metadata = result['metadatas'][i] if i < len(result['metadatas']) else {}
            content = result['documents'][i] if i < len(result['documents']) else ''

            # Create a unique key for grouping
            if metadata.get('source') == 'github_runbook':
                # For GitHub runbooks, group by github_url + path
                group_key = f"{metadata.get('github_url', 'unknown')}#{metadata.get('path', 'unknown')}"
                source_display = metadata.get('path', 'Unknown file')
            else:
                # For other sources, group by source
                group_key = metadata.get('source', 'unknown')
                source_display = metadata.get('source', 'Unknown source')

            if group_key not in source_groups:
                source_groups[group_key] = {
                    'id': doc_id,  # Use first chunk's ID as representative
                    'source_display': source_display,
                    'metadata': metadata,
                    'chunks': [],
                    'total_content': '',
                    'chunk_count': 0
                }

            # Add this chunk to the group
            source_groups[group_key]['chunks'].append({
                'id': doc_id,
                'content': content,
                'chunk_index': metadata.get('chunk_index', 0)
            })
            source_groups[group_key]['chunk_count'] += 1

            # Accumulate content for preview (limit to avoid too long previews)
            if len(source_groups[group_key]['total_content']) < 500:
                source_groups[group_key]['total_content'] += content + ' '

        # Convert grouped data to documents list
        documents = []
        for group_key, group_data in source_groups.items():
            # Sort chunks by chunk_index for better content preview
            group_data['chunks'].sort(key=lambda x: x.get('chunk_index', 0))

            # Create content preview from first few chunks
            preview_content = ''
            for chunk in group_data['chunks'][:3]:  # Use first 3 chunks for preview
                preview_content += chunk['content'] + ' '

            content_preview = preview_content[:300] + '...' if len(preview_content) > 300 else preview_content

            doc_info = {
                'id': group_data['id'],
                'source_display': group_data['source_display'],
                'metadata': group_data['metadata'],
                'content_preview': content_preview.strip(),
                'chunk_count': group_data['chunk_count'],
                'chunks': group_data['chunks']  # Include individual chunks if needed
            }
            documents.append(doc_info)

        # Calculate total chunks across all documents
        total_chunks = sum(doc['chunk_count'] for doc in documents)

        return DocumentListResponse(
            total_documents=len(documents),  # Number of unique sources/files
            total_chunks=total_chunks,       # Total number of chunks
            documents=documents,
            collection_name=collection_name
        )

    except Exception as e:
        logger.error(f"Error listing indexed documents: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list documents: {str(e)}")


@router.get("/runbook/stats", response_model=DocumentStatsResponse)
async def get_document_statistics():
    """
    Get statistics about indexed documents in the ChromaDB vector memory.
    Returns counts by source type and total document information.
    """
    try:
        rag_memory, _ = get_main_imports()
        
        # Try multiple approaches to access the ChromaDB collection
        collection = None
        collection_name = "autogen_docs"  # default

        # Method 1: Try accessing _collection attribute
        if hasattr(rag_memory, '_collection') and rag_memory._collection is not None:
            collection = rag_memory._collection
            if hasattr(rag_memory, '_config'):
                collection_name = rag_memory._config.collection_name

        # Method 2: Try accessing _client and get collection
        elif hasattr(rag_memory, '_client') and rag_memory._client is not None:
            client = rag_memory._client
            if hasattr(rag_memory, '_config'):
                collection_name = rag_memory._config.collection_name
                collection = client.get_collection(name=collection_name)

        # Method 3: Try creating a new client connection
        else:
            import chromadb
            # Use the same persistence path as configured
            persistence_path = os.path.join(str(Path.home()), ".chromadb_autogen")
            client = chromadb.PersistentClient(path=persistence_path)
            collection = client.get_collection(name=collection_name)

        if collection is None:
            return DocumentStatsResponse(
                total_documents=0,
                collection_name=collection_name,
                sources={},
                total_chunks=0
            )

        # Get all documents metadata to analyze sources
        # Note: IDs are returned by default, only specify metadatas
        result = collection.get(include=['metadatas'])

        # Count by source type
        sources = {}
        total_chunks = 0

        for metadata in result['metadatas']:
            if metadata:
                source = metadata.get('source', 'unknown')
                sources[source] = sources.get(source, 0) + 1
                total_chunks += 1

        return DocumentStatsResponse(
            total_documents=len(result['ids']),
            collection_name=collection_name,
            sources=sources,
            total_chunks=total_chunks
        )

    except Exception as e:
        logger.error(f"Error getting document statistics: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get statistics: {str(e)}")


@router.get("/runbook/document/{document_id}", response_model=DocumentDetailResponse)
async def get_document_detail(document_id: str):
    """
    Get detailed information about a specific document including all its chunks.
    """
    try:
        rag_memory, _ = get_main_imports()
        
        # Try multiple approaches to access the ChromaDB collection
        collection = None
        collection_name = "autogen_docs"  # default

        # Method 1: Try accessing _collection attribute
        if hasattr(rag_memory, '_collection') and rag_memory._collection is not None:
            collection = rag_memory._collection
            if hasattr(rag_memory, '_config'):
                collection_name = rag_memory._config.collection_name

        # Method 2: Try accessing _client and get collection
        elif hasattr(rag_memory, '_client') and rag_memory._client is not None:
            client = rag_memory._client
            if hasattr(rag_memory, '_config'):
                collection_name = rag_memory._config.collection_name
                collection = client.get_collection(name=collection_name)

        # Method 3: Try creating a new client connection
        else:
            import chromadb
            # Use the same persistence path as configured
            persistence_path = os.path.join(str(Path.home()), ".chromadb_autogen")
            client = chromadb.PersistentClient(path=persistence_path)
            collection = client.get_collection(name=collection_name)

        if collection is None:
            raise HTTPException(
                status_code=404,
                detail="ChromaDB collection not found."
            )

        # Get all documents to find the one with matching ID and related chunks
        result = collection.get()

        # Find the document and all related chunks
        target_metadata = None
        related_chunks = []

        for i, doc_id in enumerate(result['ids']):
            if doc_id == document_id:
                target_metadata = result['metadatas'][i] if i < len(result['metadatas']) else {}
                break

        if target_metadata is None:
            raise HTTPException(status_code=404, detail="Document not found")

        # Find all chunks with the same source
        if target_metadata.get('source') == 'github_runbook':
            # For GitHub runbooks, find all chunks with same github_url + path
            target_url = target_metadata.get('github_url')
            target_path = target_metadata.get('path')

            for i, doc_id in enumerate(result['ids']):
                metadata = result['metadatas'][i] if i < len(result['metadatas']) else {}
                if (metadata.get('github_url') == target_url and
                    metadata.get('path') == target_path):
                    related_chunks.append({
                        'id': doc_id,
                        'content': result['documents'][i] if i < len(result['documents']) else '',
                        'chunk_index': metadata.get('chunk_index', 0),
                        'metadata': metadata
                    })
        else:
            # For other sources, find all chunks with same source
            target_source = target_metadata.get('source')

            for i, doc_id in enumerate(result['ids']):
                metadata = result['metadatas'][i] if i < len(result['metadatas']) else {}
                if metadata.get('source') == target_source:
                    related_chunks.append({
                        'id': doc_id,
                        'content': result['documents'][i] if i < len(result['documents']) else '',
                        'chunk_index': metadata.get('chunk_index', 0),
                        'metadata': metadata
                    })

        # Sort chunks by chunk_index
        related_chunks.sort(key=lambda x: x.get('chunk_index', 0))

        # Determine source display
        if target_metadata.get('source') == 'github_runbook':
            source_display = target_metadata.get('path', 'Unknown file')
        else:
            source_display = target_metadata.get('source', 'Unknown source')

        return DocumentDetailResponse(
            document_id=document_id,
            source_display=source_display,
            metadata=target_metadata,
            chunks=related_chunks,
            total_chunks=len(related_chunks)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting document detail: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get document detail: {str(e)}")


@router.post("/runbook/reindex")
async def reindex_all_runbooks():
    """
    Reindex all previously indexed GitHub sources.
    This endpoint reads from the JSON file and re-indexes all sources,
    clearing existing data first to avoid duplicates.
    """
    try:
        rag_memory, SOURCES_FILE = get_main_imports()
        
        # Load sources from JSON file
        sources = load_indexed_sources(SOURCES_FILE)

        if not sources:
            return {
                "status": "success",
                "message": "No sources to reindex",
                "sources_reindexed": 0,
                "chunks_indexed": 0
            }

        logger.info(f"Starting reindex of {len(sources)} sources")

        # Clear all existing data first to avoid duplicates
        logger.info("Clearing existing data before reindex...")
        cleared_count = await clear_collection(rag_memory)
        logger.info(f"Cleared {cleared_count} existing documents")

        total_chunks = 0
        reindexed_count = 0
        failed_sources = []

        # Re-index each source using existing flow
        for source in sources:
            try:
                logger.info(f"Reindexing source: {source['url']}")

                github_indexer = GitHubDocumentIndexer(memory=rag_memory)
                result = await github_indexer.index_github_content(
                    github_url=source["url"],
                    branch=source["branch"]
                )

                # Update source metadata
                source["indexed_at"] = datetime.now().isoformat()
                source["files_processed"] = result['files_processed']
                source["chunks_indexed"] = result['chunks_indexed']
                source["status"] = "active"

                total_chunks += result['chunks_indexed']
                reindexed_count += 1

                logger.info(f"Successfully reindexed {source['url']}: {result['chunks_indexed']} chunks")

            except Exception as e:
                logger.error(f"Failed to reindex {source['url']}: {str(e)}")
                source["status"] = "failed"
                failed_sources.append({
                    "url": source["url"],
                    "error": str(e)
                })

        # Save updated sources back to JSON
        await save_indexed_sources(sources, SOURCES_FILE)

        # Prepare response
        response = {
            "status": "success",
            "message": f"Reindexed {reindexed_count} of {len(sources)} sources",
            "sources_reindexed": reindexed_count,
            "total_sources": len(sources),
            "chunks_indexed": total_chunks,
            "cleared_documents": cleared_count
        }

        if failed_sources:
            response["failed_sources"] = failed_sources
            response["message"] += f" ({len(failed_sources)} failed)"

        logger.info(f"Reindex completed: {reindexed_count} sources, {total_chunks} chunks")
        return response

    except Exception as e:
        logger.error(f"Error during reindex: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Reindex failed: {str(e)}")


@router.get("/runbook/sources")
async def list_indexed_sources_endpoint():
    """
    List all indexed sources from the JSON file.
    Shows what sources are available for reindexing.
    """
    try:
        _, SOURCES_FILE = get_main_imports()
        
        sources = load_indexed_sources(SOURCES_FILE)

        # Calculate some statistics
        total_files = sum(source.get('files_processed', 0) for source in sources)
        total_chunks = sum(source.get('chunks_indexed', 0) for source in sources)
        active_sources = len([s for s in sources if s.get('status') == 'active'])

        return {
            "sources": sources,
            "total_sources": len(sources),
            "active_sources": active_sources,
            "total_files_processed": total_files,
            "total_chunks_indexed": total_chunks
        }

    except Exception as e:
        logger.error(f"Error listing sources: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list sources: {str(e)}")


@router.delete("/runbook/sources/{source_id}")
async def remove_indexed_source(source_id: str):
    """
    Remove a source from tracking (doesn't delete from ChromaDB).
    This removes the source from future reindex operations.
    """
    try:
        _, SOURCES_FILE = get_main_imports()
        
        sources = load_indexed_sources(SOURCES_FILE)
        original_count = len(sources)

        # Filter out the source with matching ID
        sources = [s for s in sources if s.get("id") != source_id]

        if len(sources) == original_count:
            raise HTTPException(status_code=404, detail="Source not found")

        # Save updated sources
        await save_indexed_sources(sources, SOURCES_FILE)

        return {
            "status": "success",
            "message": f"Source {source_id} removed from tracking",
            "remaining_sources": len(sources)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing source: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to remove source: {str(e)}")
