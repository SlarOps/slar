# SLAR AI - Smart Live Alert & Response AI Agent

A modular, scalable AI-powered incident response and management system built with AutoGen and FastAPI.

## 🏗️ Architecture

The codebase follows a modular architecture with clear separation of concerns:

```
api/ai/
├── main.py                 # 🚀 Single entry point - FastAPI application
├── __init__.py            # Package exports
├── config/                # ⚙️ Configuration Management
│   ├── __init__.py
│   └── settings.py       # Centralized settings with environment variables
├── core/                  # 🧠 Core Business Logic
│   ├── __init__.py
│   ├── agent.py          # SLARAgentManager - AI agent orchestration
│   ├── session.py        # SessionManager - Session state management
│   └── tools.py          # ToolManager - MCP tool integration
├── models/               # 📋 Data Models
│   ├── __init__.py
│   └── schemas.py        # Pydantic models for API requests/responses
├── routes/               # 🛣️ API Routes
│   ├── __init__.py
│   ├── health.py         # Health check endpoints
│   ├── sessions.py       # Session management endpoints
│   ├── runbook.py        # Runbook retrieval and indexing
│   └── websocket.py      # Real-time WebSocket communication
├── utils/                # 🔧 Utilities
│   ├── __init__.py
│   ├── indexers.py       # Document indexing (GitHub, content, etc.)
│   ├── helpers.py        # Helper functions (source management)
│   └── slar_tools.py     # SLAR-specific tool functions
├── terminal/             # 💻 Terminal Server (Standalone)
│   ├── __init__.py
│   ├── terminal.py       # Terminal implementation
│   └── terminal_server.py # Standalone terminal server
└── tests/                # ✅ Test Suite
    ├── __init__.py
    ├── test_config.py
    ├── test_models.py
    └── test_utils.py
```

## 🚀 Getting Started

### Prerequisites

- Python 3.11+
- Docker (for code executor agent)
- OpenAI API Key

### Installation

```bash
# Navigate to the ai directory
cd /Users/chonle/Documents/feee/slar-oss/api/ai

# Install dependencies
pip install -r requirements.txt
```

### Configuration

All configuration is managed through environment variables. Create a `.env` file or set them in your environment:

```bash
# Required
OPENAI_API_KEY=your_api_key_here

# Optional (defaults shown)
PORT=8002
HOST=0.0.0.0
OPENAI_MODEL=gpt-4o
DATA_STORE=/path/to/data
ENABLE_KUBERNETES=false
ENABLE_CODE_EXECUTOR=false
CHROMA_COLLECTION_NAME=autogen_docs
CHROMA_K_RESULTS=3
CHROMA_SCORE_THRESHOLD=0.4
MAX_TOTAL_TOKENS=12000
LOG_LEVEL=INFO
```

### Running the Application

#### Method 1: Direct execution
```bash
python main.py
```

#### Method 2: Using uvicorn
```bash
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

#### Method 3: As a module
```bash
python -m api.ai.main
```

## 📚 Module Documentation

### Config Module (`config/`)

Centralized configuration management using environment variables.

```python
from config import get_settings

settings = get_settings()
print(settings.openai_model)  # gpt-4o
print(settings.port)  # 8002
```

**Key Features:**
- Singleton pattern for settings
- Type-safe configuration
- Environment variable support
- Computed properties for derived paths

### Core Module (`core/`)

Contains the core business logic for AI agents, sessions, and tools.

#### SLARAgentManager
Manages AI agents and their lifecycle:

```python
from core import SLARAgentManager

manager = SLARAgentManager()
team = await manager.get_selector_group_chat(user_input_func)
result = await team.run(task="Investigate database outage")
```

#### SessionManager
Handles session persistence and auto-save:

```python
from core import SessionManager

session_mgr = SessionManager(data_store="/path/to/data")
session = await session_mgr.get_or_create_session("session-123")
```

#### ToolManager
Manages MCP (Model Context Protocol) tools:

```python
from core import ToolManager

tool_mgr = ToolManager()
tool_mgr.load_mcp_config("mcp_config.yaml")
workbenches = await tool_mgr.load_mcp_workbenches()
```

### Models Module (`models/`)

Pydantic models for request/response validation:

```python
from models import IncidentRunbookRequest, GitHubIndexRequest

request = IncidentRunbookRequest(
    incident_id="INC-001",
    incident_title="Database Error",
    incident_description="Connection timeout",
    severity="high",
    keywords=["database", "timeout"]
)
```

### Routes Module (`routes/`)

FastAPI route handlers organized by functionality:
- `/health` - Health checks and system status
- `/sessions` - Session management
- `/runbook` - Runbook indexing and retrieval
- `/ws` - WebSocket for real-time communication

### Utils Module (`utils/`)

Utility functions and helpers:

```python
from utils import generate_source_id, detect_source_type
from utils import SimpleDocumentIndexer, GitHubRepoIndexer

# Generate unique source ID
source_id = generate_source_id("https://github.com/user/repo")

# Detect source type
source_type = detect_source_type("https://github.com/user/repo/blob/main/README.md")
# Returns: "github_file"
```

## 🧪 Testing

Run the test suite:

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest --cov=. tests/

# Run specific test file
pytest tests/test_config.py -v
```

## 🔌 API Endpoints

### Health
- `GET /health` - System health status
- `GET /health/memory` - Memory usage statistics

### Sessions
- `POST /sessions` - Create new session
- `GET /sessions/{session_id}` - Get session details
- `DELETE /sessions/{session_id}` - Delete session

### Runbook
- `POST /runbook/index` - Index GitHub repository
- `POST /runbook/retrieve` - Retrieve relevant runbooks
- `GET /runbook/documents` - List indexed documents

### WebSocket
- `WS /ws/{session_id}` - Real-time chat communication

## 🛠️ Development

### Adding a New Module

1. Create module directory: `mkdir api/ai/new_module`
2. Add `__init__.py` with exports
3. Implement module functionality
4. Write tests in `tests/test_new_module.py`
5. Update main documentation

### Code Style

- Follow PEP 8
- Use type hints
- Document all public functions
- Keep functions focused (DRY principle)
- Use meaningful variable names

### DRY Principle

The codebase follows the DRY (Don't Repeat Yourself) principle:
- Centralized configuration in `config/`
- Reusable components in `core/`
- Shared utilities in `utils/`
- Single entry point in `main.py`

## 📝 Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | OpenAI API key (required) |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model to use |
| `HOST` | `0.0.0.0` | Server host |
| `PORT` | `8002` | Server port |
| `DATA_STORE` | `./` | Data storage directory |
| `ENABLE_KUBERNETES` | `false` | Enable K8s agent |
| `ENABLE_CODE_EXECUTOR` | `false` | Enable code executor |
| `CHROMA_COLLECTION_NAME` | `autogen_docs` | ChromaDB collection name |
| `CHROMA_K_RESULTS` | `3` | Number of results from RAG |
| `CHROMA_SCORE_THRESHOLD` | `0.4` | Minimum similarity score |
| `MAX_TOTAL_TOKENS` | `12000` | Max tokens per conversation |
| `SESSION_TIMEOUT_MINUTES` | `30` | Session timeout |
| `AUTO_SAVE_INTERVAL_SECONDS` | `300` | Auto-save interval |
| `CODE_EXECUTOR_IMAGE` | `python:3.11-slim` | Docker image for code execution |
| `CODE_EXECUTOR_WORK_DIR` | `coding` | Work directory for code executor |
| `MCP_CONFIG_PATH` | `mcp_config.yaml` | MCP configuration file |
| `CORS_ORIGINS` | `*` | Allowed CORS origins |
| `LOG_LEVEL` | `INFO` | Logging level |

## 🚢 Deployment

### Docker

```bash
docker build -t slar-ai .
docker run -p 8002:8002 -e OPENAI_API_KEY=your_key slar-ai
```

### Production Considerations

- Set appropriate `CORS_ORIGINS`
- Use environment-specific `.env` files
- Configure proper logging levels
- Set up monitoring and health checks
- Use a reverse proxy (nginx, traefik)
- Enable HTTPS

## 📄 License

See the main repository LICENSE file.

## 🤝 Contributing

1. Follow the modular structure
2. Write tests for new features
3. Update documentation
4. Follow DRY principles
5. Use type hints

## 🐛 Troubleshooting

### Import Errors
- Ensure you're in the correct directory
- Check Python path includes the parent directory
- Verify all `__init__.py` files exist

### ChromaDB Issues
- Check `DATA_STORE` directory permissions
- Verify ChromaDB persistence path exists
- Clear `.chromadb_autogen` if corrupted

### MCP Tool Errors
- Validate `mcp_config.yaml` syntax
- Check MCP server connectivity
- Review MCP server logs

For more help, check the GitHub issues or contact the SLAR team.
