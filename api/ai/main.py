import json
import logging
import os
from typing import Any, Awaitable, Callable, Optional
from datetime import datetime
import hashlib

import re
import aiofiles
import yaml
from typing import List
from pathlib import Path
import aiohttp
from io import BytesIO
import zipfile

from autogen_agentchat.agents import AssistantAgent, UserProxyAgent
from autogen_agentchat.base import TaskResult
from autogen_agentchat.messages import TextMessage, UserInputRequestedEvent, HandoffMessage, ThoughtEvent, MemoryQueryEvent
from autogen_agentchat.teams import RoundRobinGroupChat, SelectorGroupChat
from autogen_core import CancellationToken
from autogen_core.models import ChatCompletionClient
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_agentchat.conditions import TextMentionTermination, HandoffTermination
from autogen_agentchat.base import Handoff
from autogen_ext.memory.chromadb import ChromaDBVectorMemory, PersistentChromaDBVectorMemoryConfig
from autogen_core.memory import Memory, MemoryContent, MemoryMimeType

from tools_slar import get_incidents

logger = logging.getLogger(__name__)

app = FastAPI()

# Constants for JSON-based source tracking
SOURCES_FILE = os.path.join(os.path.dirname(__file__), "indexed_sources.json")

# Pydantic models for API requests/responses
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

# Initialize vector memory

rag_memory = ChromaDBVectorMemory(
    config=PersistentChromaDBVectorMemoryConfig(
        collection_name="autogen_docs",
        persistence_path=os.path.join(str(Path.home()), ".chromadb_autogen"),
        k=3,  # Return top 3 results
        score_threshold=0.4,  # Minimum similarity score
    )
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

state_path = "team_state.json"
history_path = "team_history.json"

async def get_team(
    user_input_func: Callable[[str, Optional[CancellationToken]], Awaitable[str]],
) -> RoundRobinGroupChat:
    # Get model client from config.
    
    model_client = OpenAIChatCompletionClient(
        model=os.getenv("OPENAI_MODEL", "gpt-4o"),
        api_key=os.getenv("OPENAI_API_KEY"),
    )

    # Create the team.
    planning_agent = AssistantAgent(
        "SREAgent",
        description="An agent for planning tasks, this agent should be the first to engage when given a new task.",
        model_client=model_client,
        memory=[rag_memory],
        tools=[get_incidents],
        reflect_on_tool_use=True,
        system_message="""
        You are a planning agent for SRE team.
        Your job is to break down complex tasks into smaller, manageable subtasks.
        """,
    )
    user_proxy = UserProxyAgent(
        name="user",
        input_func=user_input_func,  # Use the user input function.
    )
    
    termination = TextMentionTermination("TERMINATE")
    handoff_termination = HandoffTermination(target="user")

    team = RoundRobinGroupChat(
        [planning_agent, user_proxy],
        termination_condition=termination | handoff_termination,
    )
    # Load state from file.
    if not os.path.exists(state_path):
        return team
    async with aiofiles.open(state_path, "r") as file:
        state = json.loads(await file.read())
    await team.load_state(state)
    return team


async def get_history() -> list[dict[str, Any]]:
    """Get chat history from file."""
    if not os.path.exists(history_path):
        return []
    async with aiofiles.open(history_path, "r") as file:
        return json.loads(await file.read())


@app.get("/history")
async def history() -> list[dict[str, Any]]:
    try:
        return await get_history()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/runbook/retrieve", response_model=RunbookRetrievalResponse)
async def retrieve_runbook_for_incident(request: IncidentRunbookRequest):
    """
    Retrieve relevant runbooks for a given incident.
    This endpoint uses vector similarity search to find the most relevant runbooks
    based on the incident title, description, and optional keywords.
    """
    try:
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


@app.get("/runbook/test")
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


@app.post("/runbook/index-github", response_model=GitHubIndexResponse)
async def index_github_runbooks(request: GitHubIndexRequest):
    """
    Index runbooks from GitHub repository or specific files.
    Supports both repository URLs and direct file URLs.
    """
    try:
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

        await save_indexed_source(source_info)
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


@app.get("/runbook/list-documents", response_model=DocumentListResponse)
async def list_indexed_documents():
    """
    List all documents that have been indexed in the ChromaDB vector memory.
    This endpoint provides visibility into what runbooks and documents are available for retrieval.
    """
    try:
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


@app.get("/runbook/stats", response_model=DocumentStatsResponse)
async def get_document_statistics():
    """
    Get statistics about indexed documents in the ChromaDB vector memory.
    Returns counts by source type and total document information.
    """
    try:
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


@app.get("/runbook/document/{document_id}", response_model=DocumentDetailResponse)
async def get_document_detail(document_id: str):
    """
    Get detailed information about a specific document including all its chunks.
    """
    try:
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


@app.post("/runbook/reindex")
async def reindex_all_runbooks():
    """
    Reindex all previously indexed GitHub sources.
    This endpoint reads from the JSON file and re-indexes all sources,
    clearing existing data first to avoid duplicates.
    """
    try:
        # Load sources from JSON file
        sources = load_indexed_sources()

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
        cleared_count = await clear_collection()
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
        await save_indexed_sources(sources)

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


@app.get("/runbook/sources")
async def list_indexed_sources():
    """
    List all indexed sources from the JSON file.
    Shows what sources are available for reindexing.
    """
    try:
        sources = load_indexed_sources()

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


@app.delete("/runbook/sources/{source_id}")
async def remove_indexed_source(source_id: str):
    """
    Remove a source from tracking (doesn't delete from ChromaDB).
    This removes the source from future reindex operations.
    """
    try:
        sources = load_indexed_sources()
        original_count = len(sources)

        # Filter out the source with matching ID
        sources = [s for s in sources if s.get("id") != source_id]

        if len(sources) == original_count:
            raise HTTPException(status_code=404, detail="Source not found")

        # Save updated sources
        await save_indexed_sources(sources)

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


@app.websocket("/ws/chat")
async def chat(websocket: WebSocket):
    await websocket.accept()

    # User input function used by the team.
    async def _user_input(prompt: str, cancellation_token: CancellationToken | None) -> str:
        # Wait until we receive a non-empty TextMessage from the client.
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                logger.info("Client disconnected while waiting for user input")
                raise  # Let WebSocketDisconnect propagate to be handled by outer try/except

            # Try to validate as TextMessage; ignore other event types
            try:
                message = TextMessage.model_validate(data)
            except Exception:
                # Not a TextMessage; ignore and keep waiting
                continue

            content = (message.content or "").strip()
            if content:
                return content
            # Ignore empty messages and keep waiting

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except Exception as e:
                await websocket.send_json(jsonable_encoder({
                    "type": "error",
                    "source": "system",
                    "content": f"Invalid JSON for first message. Please send a JSON object. Error: {str(e)}",
                    "example": {"content": "hi", "source": "user", "type": "TextMessage"}
                }))
                continue
            request = TextMessage.model_validate(data)
            
            try:
                team = await get_team(_user_input)
                history = await get_history()
                stream = team.run_stream(task=request)
                async for message in stream:
                    if isinstance(message, TaskResult):
                        continue
                    if message.source == "user":
                        continue
                    # Handle MemoryQueryEvent specially to add source metadata
                    if isinstance(message, MemoryQueryEvent):
                        # Send MemoryQueryEvent as-is since it already contains content with metadata
                        await websocket.send_json(jsonable_encoder(message.model_dump()))
                    else:
                        # Send other message types normally
                        await websocket.send_json(jsonable_encoder(message.model_dump()))
                    if not isinstance(message, UserInputRequestedEvent):
                        # Don't save user input events to history.
                        history.append(jsonable_encoder(message.model_dump()))
                    
                    print(message.model_dump())

                # # Save team state to file.
                # async with aiofiles.open(state_path, "w") as file:
                #     state = await team.save_state()
                #     await file.write(json.dumps(state))

                # # Save chat history to file.
                # async with aiofiles.open(history_path, "w") as file:
                #     await file.write(json.dumps(history))
                    
            except WebSocketDisconnect:
                # Client disconnected during message processing - exit gracefully
                logger.info("Client disconnected during message processing")
                break
            except Exception as e:
                # Send error message to client
                error_message = {
                    "type": "error",
                    "content": f"Error: {str(e)}",
                    "source": "system"
                }
                try:
                    await websocket.send_json(jsonable_encoder(error_message))
                    # Re-enable input after error
                    await websocket.send_json(jsonable_encoder({
                        "type": "UserInputRequestedEvent",
                        "content": "An error occurred. Please try again.",
                        "source": "system"
                    }))
                except WebSocketDisconnect:
                    # Client disconnected while sending error - exit gracefully
                    logger.info("Client disconnected while sending error message")
                    break
                except Exception as send_error:
                    logger.error(f"Failed to send error message: {str(send_error)}")
                    break

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        try:
            await websocket.send_json(jsonable_encoder({
                "type": "error",
                "content": f"Unexpected error: {str(e)}",
                "source": "system"
            }))
        except WebSocketDisconnect:
            # Client already disconnected - no need to send
            logger.info("Client disconnected before error could be sent")
        except Exception:
            # Failed to send error message - connection likely broken
            logger.error("Failed to send error message to client")
            pass

# JSON-based source tracking functions
def load_indexed_sources() -> List[dict]:
    """Load indexed sources from JSON file"""
    try:
        if os.path.exists(SOURCES_FILE):
            with open(SOURCES_FILE, 'r') as f:
                data = json.load(f)
                return data.get('indexed_sources', [])
        return []
    except Exception as e:
        logger.error(f"Error loading sources: {str(e)}")
        return []

async def save_indexed_source(source_info: dict):
    """Add or update a source in the JSON file"""
    try:
        # Load existing sources
        if os.path.exists(SOURCES_FILE):
            with open(SOURCES_FILE, 'r') as f:
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
        with open(SOURCES_FILE, 'w') as f:
            json.dump(data, f, indent=2)

    except Exception as e:
        logger.error(f"Error saving source: {str(e)}")

async def save_indexed_sources(sources: List[dict]):
    """Save all sources back to JSON file"""
    try:
        data = {
            "indexed_sources": sources,
            "last_reindex": datetime.now().isoformat(),
            "total_sources": len(sources)
        }

        with open(SOURCES_FILE, 'w') as f:
            json.dump(data, f, indent=2)

    except Exception as e:
        logger.error(f"Error saving sources: {str(e)}")

def generate_source_id(github_url: str) -> str:
    """Generate unique ID for source"""
    return hashlib.md5(github_url.encode()).hexdigest()[:12]

def detect_source_type(github_url: str) -> str:
    """Detect if URL is file or repo"""
    if "/blob/" in github_url or github_url.endswith((".md", ".txt", ".rst")):
        return "github_file"
    return "github_repo"

async def clear_collection():
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

class SimpleDocumentIndexer:
    """Basic document indexer for AutoGen Memory."""

    def __init__(self, memory: Memory, chunk_size: int = 1500) -> None:
        self.memory = memory
        self.chunk_size = chunk_size

    async def _fetch_content(self, source: str) -> str:
        """Fetch content from URL or file."""
        if source.startswith(("http://", "https://")):
            async with aiohttp.ClientSession() as session:
                async with session.get(source) as response:
                    return await response.text()
        else:
            async with aiofiles.open(source, "r", encoding="utf-8") as f:
                return await f.read()

    def _strip_html(self, text: str) -> str:
        """Remove HTML tags and normalize whitespace."""
        text = re.sub(r"<[^>]*>", " ", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _split_text(self, text: str) -> List[str]:
        """Split text into fixed-size chunks."""
        chunks: list[str] = []
        # Just split text into fixed-size chunks
        for i in range(0, len(text), self.chunk_size):
            chunk = text[i : i + self.chunk_size]
            chunks.append(chunk.strip())
        return chunks

    async def index_documents(self, sources: List[str]) -> int:
        """Index documents into memory."""
        total_chunks = 0

        for source in sources:
            try:
                content = await self._fetch_content(source)

                # Strip HTML if content appears to be HTML
                if "<" in content and ">" in content:
                    content = self._strip_html(content)

                chunks = self._split_text(content)

                for i, chunk in enumerate(chunks):
                    await self.memory.add(
                        MemoryContent(
                            content=chunk, mime_type=MemoryMimeType.TEXT, metadata={"source": source, "chunk_index": i}
                        )
                    )

                total_chunks += len(chunks)

            except Exception as e:
                print(f"Error indexing {source}: {str(e)}")

        return total_chunks

class ContentDocumentIndexer:
    """Basic document indexer for AutoGen Memory."""

    def __init__(self, memory: Memory, chunk_size: int = 1500) -> None:
        self.memory = memory
        self.chunk_size = chunk_size

    def _split_text(self, text: str) -> List[str]:
        """Split text into fixed-size chunks."""
        chunks: list[str] = []
        # Just split text into fixed-size chunks
        for i in range(0, len(text), self.chunk_size):
            chunk = text[i : i + self.chunk_size]
            chunks.append(chunk.strip())
        return chunks

    async def index_documents(self, contents: List[str]) -> int:
        """Index documents into memory."""
        total_chunks = 0
        for content in contents:
            chunks = self._split_text(content)
            for i, chunk in enumerate(chunks):
                await self.memory.add(
                    MemoryContent(
                        content=chunk, mime_type=MemoryMimeType.TEXT, metadata={"source": "runbook", "chunk_index": i}
                    )
                )
            total_chunks += len(chunks)
        return total_chunks


class GitHubDocumentIndexer:
    """GitHub document indexer for fetching and indexing runbooks from GitHub."""

    def __init__(
        self, memory: Memory, chunk_size: int = 1500, github_token: Optional[str] = None
    ) -> None:
        self.memory = memory
        self.chunk_size = chunk_size
        self.github_token = github_token or os.getenv("GITHUB_TOKEN")

    def _split_text(self, text: str) -> List[str]:
        """Split text into fixed-size chunks."""
        chunks: list[str] = []
        for i in range(0, len(text), self.chunk_size):
            chunk = text[i : i + self.chunk_size]
            chunks.append(chunk.strip())
        return chunks

    def _auth_headers(self) -> dict:
        return {"Authorization": f"token {self.github_token}"} if self.github_token else {}

    async def _fetch_github_content(self, url: str) -> str:
        """Fetch content from GitHub URL."""
        # Convert GitHub URL to raw content URL
        if "/blob/" in url:
            # Convert blob URL to raw URL
            raw_url = url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
        else:
            # For repository URLs, we'll need to fetch the API
            raw_url = url

        async with aiohttp.ClientSession() as session:
            async with session.get(raw_url, headers=self._auth_headers()) as response:
                if response.status == 200:
                    return await response.text()
                else:
                    raise Exception(f"Failed to fetch content from {raw_url}: {response.status}")

    async def _fetch_github_repo_files(self, repo_url: str, branch: str = "main") -> List[tuple[str, str]]:
        """
        Efficiently fetch markdown-like files from a GitHub repository by downloading a single tarball/zipball.
        Returns a list of (relative_path, file_content) tuples.
        """
        parts = repo_url.replace("https://github.com/", "").strip("/").split("/")
        if len(parts) < 2:
            raise Exception("Invalid GitHub repository URL")
        owner, repo = parts[0], parts[1]

        # Use zipball to avoid many API calls and recursion limits
        zipball_api = f"https://api.github.com/repos/{owner}/{repo}/zipball/{branch}"

        async with aiohttp.ClientSession() as session:
            async with session.get(zipball_api, headers=self._auth_headers()) as response:
                if response.status != 200:
                    raise Exception(f"Failed to download repository archive: {response.status}")
                data = await response.read()

        # Unpack zip in-memory and collect target files
        results: List[tuple[str, str]] = []
        with zipfile.ZipFile(BytesIO(data)) as zf:
            for name in zf.namelist():
                # Skip directories
                if name.endswith("/"):
                    continue
                # Only index likely text runbooks
                if not (name.lower().endswith(".md") or name.lower().endswith(".txt") or name.lower().endswith(".rst")):
                    continue
                with zf.open(name, "r") as f:
                    raw_bytes = f.read()
                    try:
                        content = raw_bytes.decode("utf-8", errors="ignore")
                    except Exception:
                        # If decode fails, skip file
                        continue
                    # Remove the leading repo folder prefix in the archive (owner-repo-<sha>/)
                    path_parts = name.split("/", 1)
                    relative_path = path_parts[1] if len(path_parts) > 1 else name
                    results.append((relative_path, content))
        return results

    async def index_github_content(self, github_url: str, branch: str = "main") -> dict:
        """Index content from GitHub URL (repository or specific file)."""
        files_processed = 0
        total_chunks = 0

        try:
            if "/blob/" in github_url or github_url.endswith((".md", ".txt", ".rst")):
                # Single file URL
                content = await self._fetch_github_content(github_url)
                chunks = self._split_text(content)

                for i, chunk in enumerate(chunks):
                    await self.memory.add(
                        MemoryContent(
                            content=chunk,
                            mime_type=MemoryMimeType.TEXT,
                            metadata={
                                "source": "github_runbook",
                                "github_url": github_url,
                                "path": github_url.split("/")[-1],
                                "chunk_index": i
                            }
                        )
                    )

                files_processed = 1
                total_chunks = len(chunks)

            else:
                # Repository URL - fetch all markdown/text files via zipball
                file_entries = await self._fetch_github_repo_files(github_url, branch)
                for relative_path, file_content in file_entries:
                    chunks = self._split_text(file_content)
                    for i, chunk in enumerate(chunks):
                        await self.memory.add(
                            MemoryContent(
                                content=chunk,
                                mime_type=MemoryMimeType.TEXT,
                                metadata={
                                    "source": "github_runbook",
                                    "github_url": github_url,
                                    "path": relative_path,
                                    "chunk_index": i,
                                },
                            )
                        )
                    total_chunks += len(chunks)
                files_processed = len(file_entries)

            return {
                "files_processed": files_processed,
                "chunks_indexed": total_chunks
            }

        except Exception as e:
            logger.error(f"Error indexing GitHub content: {str(e)}")
            raise

# Example usage
if __name__ == "__main__":
    import uvicorn
    import asyncio
    # asyncio.run(index_runbooks_docs())
    uvicorn.run(app, host="0.0.0.0", port=8002)
    