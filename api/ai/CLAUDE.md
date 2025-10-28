# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the AI agent system for SLAR (Smart Live Alert & Response), built with AutoGen framework and FastAPI. It provides an AI-powered incident response system with tool approval, session management, and RAG capabilities.

## Project Structure

```
api/ai/
├── main.py                    # Single entry point - FastAPI app
├── config/                    # Configuration management
│   ├── settings.py           # Centralized settings with env vars
│   └── logging_config.py     # Logging configuration
├── core/                      # Core business logic
│   ├── agent.py              # SLARAgentManager - agent orchestration
│   ├── sre_agent.py          # AssistantAgent with tool approval
│   ├── session.py            # SessionManager - session persistence
│   ├── tools.py              # ToolManager - MCP integration
│   ├── messages.py           # Message types for queue system
│   └── queue_manager.py      # SessionQueueManager for async messaging
├── workers/                   # Background workers
│   └── agent_worker.py       # AgentWorker following AutoGen patterns
├── routes/                    # FastAPI route handlers
│   ├── health.py             # Health checks
│   ├── sessions.py           # Session management
│   ├── runbook.py            # Runbook RAG
│   ├── websocket.py          # Direct WebSocket (legacy)
│   └── websocket_queue.py    # Queue-based WebSocket (recommended)
├── models/                    # Pydantic data models
│   └── schemas.py
├── utils/                     # Utilities
│   ├── helpers.py            # Source tracking
│   ├── indexers.py           # Document indexing (GitHub, content)
│   └── slar_tools.py         # SLAR-specific tool functions
├── terminal/                  # Terminal server (standalone)
└── tests/                     # Test suite
```

## Key Architectural Patterns

### 1. Queue-Based WebSocket Architecture

The system uses **AutoGen's official patterns** with `asyncio.Queue` for decoupling WebSocket connections from agent execution:

- **WebSocket Handler** (`routes/websocket_queue.py`) - Publishes user input to queue, subscribes to agent output
- **Queue Manager** (`core/queue_manager.py`) - Manages input/output queues per session (ClosureAgent pattern)
- **Agent Worker** (`workers/agent_worker.py`) - Background task processing (SingleThreadedAgentRuntime pattern)

**Benefits:**
- Users can disconnect/reconnect without losing session
- Agents continue working in background
- Messages buffered in queue
- Easy migration to PGMQ/Redis later

**Based on AutoGen docs:**
- `cookbook/extracting-results-with-an-agent.ipynb` (ClosureAgent with Queue)
- `framework/agent-and-agent-runtime.ipynb` (SingleThreadedAgentRuntime)
- `design-patterns/concurrent-agents.ipynb` (Message subscription)

### 2. Tool Approval System

Security layer in `core/sre_agent.py` that controls AI tool execution:

**Three approval patterns:**
1. **Human-in-the-loop** - Manual approval for each tool
2. **Rule-based** - Auto-approve/deny based on rules (read-only, destructive ops)
3. **LLM-based** - AI-powered safety review

**Priority order:**
1. Deny list (immediate block) → `always_deny_tools`
2. Auto-approve list → `auto_approve_tools`
3. Approval function → `approval_func`
4. Tool execution

### 3. Session Management

**AutoGenChatSession** (`core/session.py`):
- State persistence to JSON files
- Auto-save every 5 minutes
- Smart reset (resets team when token limit reached)
- History tracking

### 4. RAG Memory

ChromaDB integration for document retrieval:
- GitHub repository indexing
- Content-based retrieval
- Used for runbook queries
- Configurable via `Settings`

## Common Development Tasks

### Running the Application

```bash
cd /Users/chonle/Documents/feee/slar-oss/api/ai

# Set required environment variable
export OPENAI_API_KEY="your-key-here"

# Method 1: Direct execution
python main.py

# Method 2: With uvicorn (hot reload)
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

### Running Tests

```bash
cd /Users/chonle/Documents/feee/slar-oss/api/ai

# Run all tests
pytest tests/ -v

# Run with coverage
pytest --cov=. tests/

# Run specific test file
pytest tests/test_config.py -v

# Test tool approval system (quick - 2 minutes)
python test_approval_simple.py

# Test tool approval system (comprehensive - 5-10 minutes)
python test_approval_agent.py
```

### Adding a New Tool

1. **Define tool function** in `utils/slar_tools.py`:
```python
def my_new_tool(arg1: str, arg2: int) -> str:
    """Tool description for LLM."""
    # Implementation
    return "result"
```

2. **Add to agent** in `core/agent.py` (in `SLARAgentManager`):
```python
from utils.slar_tools import my_new_tool

# In get_selector_group_chat():
tools = [my_new_tool, ...]
```

3. **Configure approval** (if needed):
```python
# In agent creation
approval_func=create_rule_based_approval_func(
    deny_destructive=True,  # Blocks delete_, destroy_, etc.
    deny_production=True,   # Blocks operations on "production"
)
```

### Adding a New API Endpoint

1. **Create handler** in `routes/new_feature.py`:
```python
from fastapi import APIRouter

router = APIRouter()

@router.post("/new-feature")
async def handle_new_feature():
    return {"status": "ok"}
```

2. **Register in main.py**:
```python
from routes.new_feature import router as new_feature_router

app.include_router(new_feature_router, tags=["new-feature"])
```

### Indexing Documents for RAG

```python
from utils.indexers import GitHubRepoIndexer
from main import slar_agent_manager

indexer = GitHubRepoIndexer(slar_agent_manager.rag_memory)
await indexer.index_github_repo("https://github.com/user/repo")
```

## Configuration

All configuration via environment variables (see `config/settings.py`):

### Required
```bash
OPENAI_API_KEY=sk-...
```

### Optional (with defaults)
```bash
# API
HOST=0.0.0.0
PORT=8002

# Model
OPENAI_MODEL=gpt-5

# Storage
DATA_STORE=./data

# ChromaDB
CHROMA_COLLECTION_NAME=autogen_docs
CHROMA_K_RESULTS=3
CHROMA_SCORE_THRESHOLD=0.4

# Features
ENABLE_KUBERNETES=false
ENABLE_CODE_EXECUTOR=false

# Session
SESSION_TIMEOUT_MINUTES=30
AUTO_SAVE_INTERVAL_SECONDS=300

# Tokens
MAX_TOTAL_TOKENS=12000

# Logging
LOG_LEVEL=INFO
```

### Computed Paths (from Settings)
- `settings.sources_file` → `{DATA_STORE}/indexed_sources.json`
- `settings.sessions_dir` → `{DATA_STORE}/sessions`
- `settings.chromadb_path` → `{DATA_STORE}/.chromadb_autogen`

## Import Patterns

The codebase follows strict modular imports:

```python
# Configuration (singleton pattern)
from config import get_settings
settings = get_settings()

# Core components
from core import SLARAgentManager, SessionManager, ToolManager
from core.queue_manager import SessionQueueManager
from core.messages import UserInput, AgentOutput

# Data models
from models import IncidentRunbookRequest, GitHubIndexRequest

# Utilities
from utils import generate_source_id, detect_source_type
from utils.indexers import GitHubRepoIndexer
from utils.slar_tools import get_incident_details

# Workers
from workers.agent_worker import AgentWorker

# Tool approval
from core.sre_agent import (
    AssistantAgent,
    ToolApprovalRequest,
    ToolApprovalResponse,
    create_rule_based_approval_func,
    create_human_approval_func,
    create_llm_approval_func,
)
```

**IMPORTANT:** Always import from module root (e.g., `from core import ...`), not from specific files (e.g., ~~`from core.agent import ...`~~).

## AutoGen Integration Notes

### Creating an Agent Team

```python
from core import SLARAgentManager

manager = SLARAgentManager()

# User input function
async def user_input_func(prompt: str, cancellation_token=None):
    return input(prompt)

# Approval function
approval_func = create_rule_based_approval_func(
    allow_read_only=True,
    deny_destructive=True,
)

# Get team
team = await manager.get_selector_group_chat(
    user_input_func,
    external_termination=None,
)

# Run task
result = await team.run(task="Investigate the incident")
```

### Session Persistence

Sessions automatically saved to `{DATA_STORE}/sessions/{session_id}/`:
- `session.json` - Session metadata
- `team_history.json` - Conversation history
- `team_state.json` - Team state (if applicable)

**Auto-save:** Every 5 minutes (configurable via `AUTO_SAVE_INTERVAL_SECONDS`)

### Code Executor

When `ENABLE_CODE_EXECUTOR=true`:
- Docker container: `CODE_EXECUTOR_IMAGE` (default: `python:3.11-slim`)
- Work directory: `CODE_EXECUTOR_WORK_DIR` (default: `coding`)

## API Endpoints

### Health
- `GET /health` - System health status
- `GET /health/memory` - Memory usage

### Sessions
- `POST /sessions` - Create new session
- `GET /sessions/{session_id}` - Get session details
- `DELETE /sessions/{session_id}` - Delete session
- `GET /sessions` - List all sessions

### Runbook (RAG)
- `POST /runbook/index` - Index GitHub repo
- `POST /runbook/retrieve` - Retrieve relevant runbooks
- `GET /runbook/documents` - List indexed documents

### WebSocket
- `WS /ws/{session_id}` - Direct WebSocket (legacy)
- `WS /ws/chat/queue` - Queue-based WebSocket (recommended)

## Troubleshooting

### Module Import Errors
Ensure you're in the correct directory:
```bash
cd /Users/chonle/Documents/feee/slar-oss/api/ai
python main.py
```

### ChromaDB Errors
Clear ChromaDB cache:
```bash
rm -rf /Users/chonle/Documents/feee/slar-oss/api/ai/.chromadb_autogen
```

### OpenAI API Errors
Verify API key is set:
```bash
echo $OPENAI_API_KEY
```

### Session Not Saving
Check data directory permissions:
```bash
ls -la /Users/chonle/Documents/feee/slar-oss/api/ai/data
```

### Worker Not Processing Messages
Check logs for worker status:
```bash
# In Python logging output
# Look for: "Started worker for session: {session_id}"
```

## Code Style

- Follow PEP 8
- Use type hints for all functions
- Docstrings for public functions and classes
- Keep functions focused (DRY principle)
- Import from module roots, not individual files
- Use async/await throughout

## Testing Best Practices

- Write tests before implementation (test-first)
- Use pytest fixtures for common setup
- Mock external dependencies (OpenAI, ChromaDB)
- Test approval logic thoroughly
- Verify session persistence

## Security Notes

### Tool Approval
- **ALWAYS** set `approval_func` in production
- Use `always_deny_tools` for destructive operations
- Log all approval decisions
- Test approval logic before deployment

### API Keys
- Never commit API keys
- Use environment variables
- Rotate keys regularly

## Dependencies

Key dependencies (see `requirements.txt`):
- `autogen-agentchat==0.7.5` - Agent framework
- `autogen-core==0.7.5` - Core agent runtime
- `autogen-ext==0.7.5` - Extensions (ChromaDB, Docker, etc.)
- `fastapi==0.118.0` - Web framework
- `chromadb==1.1.1` - Vector database
- `openai==2.2.0` - OpenAI API client
- `pydantic==2.12.0` - Data validation
- `uvicorn==0.37.0` - ASGI server

## Additional Documentation

- `README.md` - Complete module documentation
- `docs/ARCHITECTURE.md` - System architecture deep dive
- `docs/QUICK_START.md` - Quick start guide
- `QUEUE_ARCHITECTURE.md` - Queue-based architecture details
- `TEST_APPROVAL_README.md` - Tool approval testing guide
- `IMPLEMENTATION_SUMMARY.md` - Implementation overview
