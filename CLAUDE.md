# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Backend (Go API)
```bash
cd api

# Run with hot reload (recommended)
air

# Run directly without hot reload
go run cmd/server/main.go

# Run tests
go test ./...

# Run tests for specific package
go test ./services -v

# Format code
go fmt ./...

# Run linter
go vet ./...

# Run worker separately
go run cmd/worker/main.go
```

### AI Agent (Python/FastAPI)
```bash
cd api/ai

# Activate virtual environment
source venv/bin/activate  # or: source env/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run AI agent service
python claude_agent_api_v1.py
# Runs on http://localhost:8002
```

### Frontend (Next.js)
```bash
cd web/slar

# Install dependencies
npm install

# Run dev server
npm run dev
# Runs on http://localhost:3000

# Build for production
npm run build

# Start production server
npm start
```

### Database (Supabase)
```bash
# Link to Supabase project
supabase link

# Push migrations
cd supabase && supabase db push

# Generate TypeScript types
supabase gen types typescript --local > web/slar/src/types/supabase.ts
```

### Docker Compose
```bash
# Start all services
docker compose -f deploy/docker/docker-compose.yaml up -d

# View logs
docker compose -f deploy/docker/docker-compose.yaml logs -f

# Rebuild and restart specific service
docker compose -f deploy/docker/docker-compose.yaml up -d --build ai

# Stop all services
docker compose -f deploy/docker/docker-compose.yaml down
```

## Architecture Overview

SLAR is a multi-service on-call management platform with AI-powered incident response. It consists of four main components:

### 1. Go API Server (`api/`)
- **Entry Point**: `api/cmd/server/main.go`
- **Framework**: Gin (HTTP router)
- **Purpose**: Core REST API, business logic, and webhook handling
- **Key Services** (`api/services/`):
  - `scheduler_service.go` - On-call schedule computation
  - `routing.go` - Alert routing and escalation logic
  - `incident.go` - Incident lifecycle management
  - `slack_service.go` - Slack integration
  - `supabase_auth.go` - JWT verification and auth
- **Database**: PostgreSQL via Supabase (uses `database/sql` with `lib/pq` driver)
- **Runs on**: Port 8080

### 2. AI Agent Service (`api/ai/`)
- **Entry Point**: `api/ai/claude_agent_api_v1.py`
- **Framework**: FastAPI with Claude Agent SDK
- **Purpose**: AI-powered incident analysis and response using Anthropic Claude
- **Key Features**:
  - WebSocket-based chat interface for real-time interaction
  - MCP (Model Context Protocol) server integration for tools
  - Supabase storage for conversation persistence
  - Tool approval system for security
- **Key Files**:
  - `claude_agent_api_v1.py` - Main FastAPI server with WebSocket endpoints
  - `mcp_config_manager.py` - MCP server configuration and management
  - `supabase_storage.py` - Conversation and session storage
  - `incident_tools.py` - Tools for incident management
- **Runs on**: Port 8002

### 3. Frontend (`web/slar/`)
- **Framework**: Next.js 15 with App Router
- **UI Library**: Tailwind CSS + Headless UI
- **Auth**: Supabase Auth
- **Structure**:
  - `src/app/` - Next.js App Router pages
  - `src/components/` - React components (organized by feature)
  - `src/services/` - API client functions
  - `src/hooks/` - Custom React hooks
  - `src/lib/` - Utility functions and Supabase client
- **Key Pages**:
  - `/dashboard` - On-call schedule visualization with timeline
  - `/incidents` - Incident management
  - `/claude-agent` or `/ai-agent` - AI agent chat interface with xterm.js terminal
  - `/integrations` - Integration management (Slack, Alertmanager, Datadog)
- **Runs on**: Port 3000 (dev), Port 8000 (production via Kong)

### 4. Workers
- **Go Worker** (`api/cmd/worker/main.go`): Escalation processing (PGMQ consumer)
- **Slack Worker** (`api/workers/slack_worker.py`): Slack notification queue consumer (Python)

## Key Architecture Patterns

### Service Communication
- **Frontend → Go API**: Direct HTTP/HTTPS requests to `/api/*` endpoints
- **Frontend → AI Agent**: WebSocket connection for chat at `/ws/chat`
- **Go API → AI Agent**: HTTP requests to AI service endpoints
- **Workers → Database**: PGMQ (PostgreSQL Message Queue) for async tasks

### Database Pattern
- **PostgreSQL** as primary database via Supabase
- **PGMQ** extension for message queue (used by escalation worker)
- **Migrations** in `supabase/migrations/` - use Supabase CLI to apply
- No ORM - uses raw SQL with `database/sql` package in Go

### Authentication Flow
1. Supabase Auth handles user authentication
2. Frontend gets JWT token from Supabase
3. JWT sent in `Authorization: Bearer <token>` header to Go API
4. Go API verifies JWT signature using `SUPABASE_JWT_SECRET` in `services/supabase_auth.go`
5. User ID extracted from JWT claims for authorization

### AI Agent Integration
- **MCP Servers**: AI agent can dynamically load MCP servers for tool integration
- **Workspaces**: Each user session has isolated workspace in `api/ai/workspaces/{session_id}/`
- **Tool Approval**: Security mechanism requiring user approval for certain AI actions
- **Storage**: Conversations stored in Supabase `slar_claude_conversations` table

### Alert Routing
1. Webhook received (Alertmanager, Datadog, etc.) at `handlers/webhook.go`
2. Alert normalized to internal format
3. Routing rules evaluated in `services/routing.go`
4. On-call schedule consulted (`services/scheduler_service.go`)
5. Notifications sent via Slack/FCM/Email
6. Escalation policies triggered if unacknowledged

## Environment Configuration

Critical environment variables (see `.env.example`):

**Database & Supabase**:
- `DATABASE_URL` - PostgreSQL connection string (required)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` (required)

**AI Agent**:
- `OPENAI_API_KEY` - Anthropic API key (required for AI features)
- `AI_PORT` - AI service port (default: 8002)
- `AI_RATE_LIMIT` - Rate limit per minute (default: 60)

**Integration Tokens**:
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`
- `FCM_CREDENTIALS_PATH` (optional for Firebase push)

## Testing Notes

### Go Tests
- Tests use `_test.go` suffix convention
- Mock database connections where possible
- Example: `api/handlers/webhook_prometheus_test.go`

### Integration Testing
- Use Docker Compose for full stack testing
- Ensure Supabase is accessible for E2E tests
- AI agent requires valid Anthropic API key

## Important Implementation Details

### Scheduler System
- Two implementations exist:
  - `scheduler_service.go` - Original scheduler
  - `optimized_scheduler_service.go` - Performance-optimized version
- Handles complex on-call rotations with overrides
- Computes "who's on-call" for any given time

### PGMQ Queue Names
- `escalation_queue` - Escalation tasks processed by Go worker
- `slack_notification_queue` - Slack messages processed by Python worker

### Hot Reload Development
- **Go API**: Use `air` for hot reload (configured in `api/.air.toml`)
- **Next.js**: Built-in hot reload with `npm run dev`
- **Python AI**: Manual restart required (or use `uvicorn --reload`)

### Time Handling
- All times stored in UTC in database
- Frontend converts to local timezone for display
- Set timezone in DB connection: `SET TIME ZONE 'UTC'`

## Security Considerations

- JWT verification is critical - see `services/supabase_auth.go`
- AI tool approval system prevents unauthorized actions
- Rate limiting implemented on AI agent endpoints
- CORS configured per environment (`ALLOWED_ORIGINS`, `AI_ALLOWED_ORIGINS`)
- Never commit `.env` files with real credentials
- SQL injection protection via parameterized queries

## Deployment

### Docker Images
- Built for `linux/amd64` platform
- Three main images: `slar-api`, `slar-ai`, `slar-slack-worker`
- Frontend served via Next.js standalone build + Kong gateway

### Kubernetes
- Helm charts in `deploy/helm/slar/`
- Secrets required: API keys, DB credentials, JWT secrets
- See `deploy/helm/slar/README.md` for details

## Dependencies

### Go Modules
- Managed with `go mod` - see `api/go.mod`
- Key deps: Gin, JWT, Firebase Admin SDK, Redis client

### Python Packages
- Managed with `pip` - see `api/ai/requirements.txt`
- Key deps: FastAPI, Claude Agent SDK, MCP, Supabase client

### Node Packages
- Managed with `npm` - see `web/slar/package.json`
- Key deps: Next.js 15, React 19, Supabase client, xterm.js

## Troubleshooting Common Issues

### "Database connection refused"
- Verify `DATABASE_URL` in `.env`
- Check Supabase project is accessible
- Ensure PGMQ extension is installed

### "AI agent WebSocket connection failed"
- Confirm AI service is running on port 8002
- Check CORS settings (`AI_ALLOWED_ORIGINS`)
- Verify Anthropic API key is valid

### "JWT verification failed"
- Ensure `SUPABASE_JWT_SECRET` matches Supabase project
- Check token hasn't expired
- Verify Authorization header format: `Bearer <token>`

### "Hot reload not working (Go)"
- Check `air` is installed: `go install github.com/cosmtrek/air@latest`
- Verify `.air.toml` configuration in `api/` directory
- Check `tmp/` directory permissions
