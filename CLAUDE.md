# SLAR - Smart Live Alert & Response

An open-source on-call management platform with AI-powered incident response and intelligent alerting.

## Project Structure

```
slar-oss/
├── api/              # Backend services
│   ├── cmd/          # Go application entry points
│   ├── handlers/     # HTTP request handlers (Go)
│   ├── services/     # Business logic (Go)
│   ├── models/       # Data models (Go)
│   ├── ai/           # AI agent system (Python)
│   └── workers/      # Background workers (Go + Python)
├── web/slar/         # Frontend (Next.js)
├── deploy/           # Deployment configurations
│   ├── docker/       # Docker Compose setup
│   └── helm/         # Kubernetes Helm charts
└── supabase/         # Database migrations and config
```

## Technology Stack

### Backend (Go)
- **Framework**: Gin web framework
- **Database**: PostgreSQL (via Supabase)
- **Queue**: PGMQ (PostgreSQL Message Queue)
- **Auth**: JWT with Supabase
- **Integrations**: Slack, Firebase, Redis

### AI Agent System (Python)
- **Framework**: AutoGen (multi-agent framework)
- **API**: FastAPI
- **LLM**: OpenAI GPT-4o
- **RAG**: ChromaDB for document retrieval
- **MCP**: Model Context Protocol for tool integration
- **Features**: Tool approval system, session management, runbook retrieval

### Frontend (Next.js)
- **Framework**: Next.js 15.5
- **UI**: Tailwind CSS, Headless UI, Heroicons
- **Auth**: Supabase Auth
- **Real-time**: WebSocket for AI agent communication
- **Terminal**: xterm.js for interactive terminal

### Workers
- **Go Worker**: Escalation and notification worker
- **Python Worker**: Slack message worker with Bolt SDK

## Development Principles

1. **DRY Principle**: Don't Repeat Yourself - reuse code through modules and utilities
2. **Test-First**: Write tests before implementing features
3. **Modular Architecture**: Clear separation of concerns between services
4. **Type Safety**: Use type hints in Python, strong typing in Go

## Quick Start

### Prerequisites

```bash
# Required
- Go 1.24.4+
- Python 3.11+
- Node.js 18+
- Docker & Docker Compose
- Supabase account

# Optional
- Kubernetes cluster (for Helm deployment)
- Slack workspace (for notifications)
```

### Environment Setup

1. **Create `.env` file at repository root**:
```bash
cp .env.example .env
# Edit .env with your credentials
```

2. **Supabase Setup**:
```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Link to your project
supabase link

# Push database migrations
cd supabase && supabase db push
```

### Running with Docker Compose (Recommended)

```bash
# Build and start all services
docker compose -f deploy/docker/docker-compose.yaml up -d

# View logs
docker compose -f deploy/docker/docker-compose.yaml logs -f

# Access application
open http://localhost:8000
```

### Running Services Individually

#### Backend (Go)
```bash
cd api

# Install dependencies
go mod download

# Run backend server
go run cmd/main.go

# Or with hot reload
air

# Run tests
go test ./...
```

#### AI Agent (Python)
```bash
cd api/ai

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export OPENAI_API_KEY="your_key_here"

# Run AI agent server
python main.py

# Or with uvicorn
uvicorn main:app --host 0.0.0.0 --port 8002 --reload

# Run tests
cd api/ai
pytest tests/

# Test approval system
python test_approval_simple.py
```

#### Workers
```bash
# Go worker (escalation)
cd api/workers
go run worker.go

# Python worker (Slack)
cd api/workers
pip install -r requirements.txt
python slack_worker.py
```

#### Frontend (Next.js)
```bash
cd web/slar

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Key Features & Components

### 1. AI Agent System (api/ai/)

**Architecture**: Multi-agent system using AutoGen framework with tool approval security

**Key Components**:
- `core/sre_agent.py` - Main AssistantAgent with tool approval system
- `core/agent.py` - SLARAgentManager for agent orchestration
- `core/session.py` - Session management with auto-save
- `core/tools.py` - MCP tool integration

**Tool Approval System**: Security pattern for controlling AI tool execution
- **Human-in-the-loop**: Manual approval for each tool call
- **Rule-based**: Automatic approval/denial based on predefined rules
- **LLM-based**: AI-powered safety review before execution

**Testing the Approval System**:
```bash
cd api/ai

# Quick test (2 minutes)
python test_approval_simple.py

# Comprehensive test suite (5-10 minutes)
python test_approval_agent.py
```

**Usage Example**:
```python
from core.sre_agent import AssistantAgent, create_rule_based_approval_func
from autogen_ext.models.openai import OpenAIChatCompletionClient

model_client = OpenAIChatCompletionClient(model="gpt-4o-mini")

agent = AssistantAgent(
    name="sre_assistant",
    model_client=model_client,
    tools=[get_server_status, restart_service],
    approval_func=create_rule_based_approval_func(
        allow_read_only=True,      # Auto-approve: get_*, list_*, check_*
        deny_destructive=True,     # Auto-deny: delete_*, destroy_*
        deny_production=True,      # Auto-deny: operations on "production"
    ),
    auto_approve_tools=["get_metrics"],
    always_deny_tools=["delete_database"],
)

result = await agent.run(task="Check server status")
```

**API Endpoints**:
- `POST /sessions` - Create new session
- `WS /ws/{session_id}` - WebSocket for real-time chat
- `POST /runbook/index` - Index GitHub repository for RAG
- `POST /runbook/retrieve` - Retrieve relevant runbooks
- `GET /health` - Health check

**Environment Variables**:
```bash
OPENAI_API_KEY=sk-...                    # Required
OPENAI_MODEL=gpt-4o                       # Default: gpt-4o
PORT=8002                                 # Default: 8002
ENABLE_CODE_EXECUTOR=false                # Enable code execution
CHROMA_COLLECTION_NAME=autogen_docs       # RAG collection
```

### 2. Backend API (api/)

**Go Backend**: RESTful API with Gin framework

**Key Handlers**:
- `handlers/incident.go` - Incident management
- `handlers/webhook.go` - Webhook integrations (Datadog, Prometheus)
- `handlers/user.go` - User management
- `handlers/optimized_scheduler.go` - Schedule optimization
- `handlers/notification.go` - Notification handling

**Database**: PostgreSQL via Supabase with PGMQ for message queuing

**API Structure**:
```bash
# Run backend
cd api
go run cmd/main.go

# Test
go test ./...

# Build
go build -o bin/slar cmd/main.go
```

### 3. Workers (api/workers/)

**Go Worker** (`worker.go`): Handles escalation and notifications from PGMQ

**Python Slack Worker** (`slack_worker.py`): Processes Slack messages and interactions

```bash
# Run workers
cd api/workers

# Go worker
go run worker.go

# Python Slack worker
python slack_worker.py
```

### 4. Frontend (web/slar/)

**Next.js Application**: Modern React-based UI

**Key Features**:
- Schedule management with timeline visualization (vis-timeline)
- Team and user management
- Incident dashboard
- AI chat interface with WebSocket
- Interactive terminal (xterm.js)

```bash
cd web/slar
npm run dev  # http://localhost:3000
```

## Deployment

### Docker Compose (Local/Development)

```bash
# Start all services
docker compose -f deploy/docker/docker-compose.yaml up -d

# Access
Frontend: http://localhost:8000
Backend API: http://localhost:8000/api
AI Agent: http://localhost:8002
```

### Kubernetes (Production)

```bash
# Create secrets
kubectl create secret generic slar-secrets \
  --from-literal=openai-api-key=xxx \
  --from-literal=database-url=xxx \
  --from-literal=supabase-anon-key=xxx \
  --from-literal=slack-bot-token=xxx

# Install Helm chart
cd deploy/helm/slar
helm install slar . -f values.yaml

# Uninstall
helm uninstall slar
```

## Testing

### Backend Tests
```bash
cd api
go test ./... -v
go test ./handlers/... -cover
```

### AI Agent Tests
```bash
cd api/ai

# Unit tests
pytest tests/ -v

# Test with coverage
pytest --cov=. tests/

# Approval system tests
python test_approval_simple.py
python test_approval_agent.py
```

### Integration Testing
```bash
# Ensure all services are running
docker compose -f deploy/docker/docker-compose.yaml up -d

# Run integration tests
# (Add integration test commands here)
```

## Common Tasks

### Adding a New AI Tool

1. **Define the tool function** in `api/ai/utils/slar_tools.py`:
```python
def restart_service(service_name: str) -> str:
    """Restart a service."""
    # Implementation
    return f"Service {service_name} restarted"
```

2. **Add to agent** in `api/ai/core/agent.py`:
```python
tools = [restart_service, get_status, ...]
```

3. **Configure approval** (if needed):
```python
agent = AssistantAgent(
    tools=tools,
    approval_func=create_rule_based_approval_func(
        deny_destructive=True
    ),
)
```

4. **Test the tool**:
```bash
cd api/ai
python -c "from utils.slar_tools import restart_service; print(restart_service('nginx'))"
```

### Adding a New API Endpoint

1. **Create handler** in `api/handlers/`:
```go
func HandleNewFeature(c *gin.Context) {
    // Implementation
    c.JSON(200, gin.H{"status": "ok"})
}
```

2. **Register route** in `api/router/`:
```go
router.POST("/api/new-feature", handlers.HandleNewFeature)
```

3. **Add tests** in `api/handlers/`:
```go
func TestHandleNewFeature(t *testing.T) {
    // Test implementation
}
```

### Database Migrations

```bash
# Create new migration
cd supabase
supabase migration new migration_name

# Edit migration file
# supabase/migrations/YYYYMMDDHHMMSS_migration_name.sql

# Apply migrations
supabase db push

# Reset database (caution!)
supabase db reset
```

## Architecture Notes

### Service Communication

```
Frontend (Next.js)
    ↓ HTTP/WebSocket
Backend API (Go) ← → Supabase (PostgreSQL)
    ↓ PGMQ
Workers (Go/Python)
    ↓ Slack SDK
Slack

Frontend (Next.js)
    ↓ WebSocket
AI Agent (Python/FastAPI)
    ↓ OpenAI API
GPT-4o
```

### AI Agent Flow

```
User → WebSocket → SessionManager → SLARAgentManager
                                           ↓
                                    AssistantAgent (with approval)
                                           ↓
                                    Tool Approval Check:
                                    1. Deny list (immediate block)
                                    2. Auto-approve list (skip approval)
                                    3. Approval function (decide)
                                           ↓
                                    Tool Execution
                                           ↓
                                    Response → User
```

### Security Layers

1. **Authentication**: Supabase JWT validation
2. **Authorization**: Role-based access control
3. **Tool Approval**: AI action approval before execution
4. **Rate Limiting**: API rate limits (configured in backend)
5. **CORS**: Configured origins in both backend and AI agent

## Troubleshooting

### Backend Issues

**Error: Database connection failed**
```bash
# Check Supabase connection
echo $DATABASE_URL
# Verify migrations are applied
cd supabase && supabase db push
```

**Error: Port already in use**
```bash
# Find process using port
lsof -i :8000
# Kill process
kill -9 <PID>
```

### AI Agent Issues

**Error: OpenAI API key not set**
```bash
export OPENAI_API_KEY="sk-..."
```

**Error: ChromaDB persistence error**
```bash
# Clear ChromaDB cache
rm -rf api/ai/.chromadb_autogen
```

**Error: Module import failures**
```bash
# Ensure you're in correct directory
cd api/ai
# Check Python path
python -c "import sys; print(sys.path)"
```

**Error: Tool approval not working**
```bash
# Test approval system
cd api/ai
python test_approval_simple.py
```

### Worker Issues

**Error: PGMQ queue not found**
```bash
# Check PGMQ setup in database
# Ensure migrations created PGMQ tables
```

**Error: Slack token invalid**
```bash
# Verify Slack tokens
echo $SLACK_BOT_TOKEN
echo $SLACK_APP_TOKEN
```

### Frontend Issues

**Error: Cannot connect to backend**
```bash
# Check backend is running
curl http://localhost:8000/api/health

# Check CORS configuration
# Update NEXT_PUBLIC_API_URL in .env
```

## Resources

- **Repository**: https://github.com/slarops/slar
- **Issues**: https://github.com/slarops/slar/issues
- **Documentation**: See `/docs` and `/api/ai/README.md`
- **AutoGen Docs**: https://microsoft.github.io/autogen/
- **Supabase Docs**: https://supabase.com/docs

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Follow coding standards:
   - **Go**: Follow Go conventions, run `go fmt`
   - **Python**: Follow PEP 8, use type hints
   - **TypeScript**: Use ESLint and Prettier
4. Write tests (test-first approach)
5. Commit changes: `git commit -m "feat: add new feature"`
6. Push to branch: `git push origin feature/new-feature`
7. Submit pull request with clear description

### Commit Convention

Follow conventional commits:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

## License

Apache 2.0 License - see [LICENSE](LICENSE) file for details.
