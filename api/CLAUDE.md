# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the backend API and services directory for SLAR (Smart Live Alert & Response). It contains three major components:
1. **Go Backend API** - RESTful API with Gin framework
2. **AI Agent System** - Python FastAPI service with AutoGen framework (see `ai/CLAUDE.md` for details)
3. **Background Workers** - Go and Python workers for async processing

## Architecture

The API follows a clean architecture pattern:

```
api/
├── cmd/
│   ├── server/main.go     # API server entry point
│   └── worker/main.go     # Background worker entry point
├── handlers/              # HTTP handlers (controllers)
├── services/              # Business logic
├── db/                    # Database models and utilities
├── models/                # Data transfer objects
├── router/                # Route registration (router/api.go)
├── workers/               # Background workers
│   ├── *.go              # Go workers (notification, incident)
│   └── slack_worker.py   # Python Slack worker (PGMQ consumer)
└── ai/                    # AI agent system (separate Python service)
```

**Key Pattern:** Handlers → Services → Database
- **Handlers** validate input and format responses
- **Services** contain business logic and can be reused
- **Database operations** are in services, not handlers

## Running the Services

### Go API Server

```bash
cd /Users/chonle/Documents/feee/slar-oss/api

# Load environment
export $(cat .env | xargs)

# Run with go run
go run cmd/server/main.go

# Or with hot reload (if air is installed)
air

# Build binary
go build -o bin/slar cmd/server/main.go
./bin/slar
```

**Default port:** 8080 (configurable via `PORT` env var)

### Go Background Workers

```bash
cd /Users/chonle/Documents/feee/slar-oss/api

# Requires DATABASE_URL environment variable
export DATABASE_URL="postgresql://..."

go run cmd/worker/main.go
```

**Workers started:**
- `NotificationWorker` - Processes PGMQ notification queue (for FCM)
- `IncidentWorker` - Handles incident escalation

### Python Slack Worker

```bash
cd /Users/chonle/Documents/feee/slar-oss/api/workers

# Install dependencies
pip install -r requirements.txt

# Set environment
export DATABASE_URL="postgresql://..."
export SLACK_BOT_TOKEN="xoxb-..."

# Run worker
python slack_worker.py
```

**Purpose:** Consumes `slack_notification_queue` from PGMQ and sends messages to Slack using Bolt SDK.

### AI Agent Service

See `ai/CLAUDE.md` for comprehensive documentation.

```bash
cd /Users/chonle/Documents/feee/slar-oss/api/ai
export OPENAI_API_KEY="sk-..."
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

### MCP Server (Model Context Protocol)

**Purpose:** Exposes AI Agent API as MCP tools for LLM applications (Claude Desktop, etc.)

See `MCP_README.md` for comprehensive documentation.

```bash
cd /Users/chonle/Documents/feee/slar-oss/api

# Install MCP dependencies
pip install -r mcp_requirements.txt

# Configure (optional)
export AI_API_BASE_URL="http://localhost:8002"

# Run MCP server
python mcp_ai_server.py
```

**Available Tools:**
- Session Management: `create_ai_session`, `get_ai_session_info`, `list_ai_sessions`, etc.
- AI Chat: `chat_with_ai_agent`
- Runbook Management: `retrieve_runbook_for_incident`, `index_github_runbooks`, etc.
- Health Check: `check_ai_service_health`

**Claude Desktop Configuration:**

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "slar-ai-agent": {
      "command": "python",
      "args": ["/path/to/slar-oss/api/mcp_ai_server.py"],
      "env": {
        "AI_API_BASE_URL": "http://localhost:8002"
      }
    }
  }
}
```

See `mcp_claude_config.example.json` for full example.

## Testing

### Go Tests

```bash
cd /Users/chonle/Documents/feee/slar-oss/api

# Run all tests
go test ./...

# Run specific package tests
go test ./handlers/...
go test ./services/...

# Run with verbose output
go test -v ./...

# Run with coverage
go test -cover ./...

# Run specific test function
go test ./handlers -run TestProcessDatadogWebhook

# Run tests in single file
go test -v ./handlers/webhook_datadog_test.go ./handlers/webhook.go
```

### Python Tests (AI Agent)

See `ai/CLAUDE.md` for details.

```bash
cd /Users/chonle/Documents/feee/slar-oss/api/ai
pytest tests/ -v
```

## Common Development Tasks

### Adding a New API Endpoint

1. **Create handler** in `handlers/`:
```go
package handlers

import "github.com/gin-gonic/gin"

type NewFeatureHandler struct {
    service *services.NewFeatureService
}

func NewNewFeatureHandler(service *services.NewFeatureService) *NewFeatureHandler {
    return &NewFeatureHandler{service: service}
}

func (h *NewFeatureHandler) HandleNewFeature(c *gin.Context) {
    // Parse request
    var req SomeRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    // Call service
    result, err := h.service.DoSomething(c.Request.Context(), req)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }

    c.JSON(200, result)
}
```

2. **Create service** in `services/`:
```go
package services

type NewFeatureService struct {
    db *sql.DB
}

func NewNewFeatureService(db *sql.DB) *NewFeatureService {
    return &NewFeatureService{db: db}
}

func (s *NewFeatureService) DoSomething(ctx context.Context, req SomeRequest) (SomeResponse, error) {
    // Business logic here
    return SomeResponse{}, nil
}
```

3. **Register route** in `router/api.go`:
```go
// In NewGinRouter function:
newFeatureService := services.NewNewFeatureService(pg)
newFeatureHandler := handlers.NewNewFeatureHandler(newFeatureService)

// Register route (protected)
authenticated := r.Group("/")
authenticated.Use(supabaseAuthMiddleware.RequireAuth())
authenticated.POST("/new-feature", newFeatureHandler.HandleNewFeature)

// Or public
r.POST("/public/new-feature", newFeatureHandler.HandleNewFeature)
```

4. **Write test** in `handlers/`:
```go
func TestHandleNewFeature(t *testing.T) {
    // Setup
    handler := &NewFeatureHandler{
        service: &services.NewFeatureService{},
    }

    // Test implementation
}
```

### Working with Database

**Database connection** is initialized in `cmd/server/main.go` and passed to services:

```go
db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
```

**Query patterns:**

```go
// Single row
var result SomeModel
err := s.db.QueryRowContext(ctx, "SELECT * FROM table WHERE id = $1", id).Scan(&result.Field1, &result.Field2)

// Multiple rows
rows, err := s.db.QueryContext(ctx, "SELECT * FROM table")
defer rows.Close()
for rows.Next() {
    var item SomeModel
    rows.Scan(&item.Field1, &item.Field2)
    results = append(results, item)
}

// Insert/Update
_, err := s.db.ExecContext(ctx, "INSERT INTO table (field1, field2) VALUES ($1, $2)", val1, val2)
```

### Working with PGMQ (Message Queue)

**PGMQ** is used for async processing. Messages are queued via SQL functions:

**Enqueue notification:**
```go
import "github.com/google/uuid"

messageID := uuid.New().String()
_, err := db.Exec(`
    SELECT pgmq.send(
        'slack_notification_queue',
        jsonb_build_object(
            'incident_id', $1,
            'user_id', $2,
            'message', $3
        )::jsonb,
        $4
    )
`, incidentID, userID, message, messageID)
```

**Dequeue in worker:**
```go
// In worker loop
rows, err := db.Query(`
    SELECT msg_id, message
    FROM pgmq.read('slack_notification_queue', 30, 1)
`)
defer rows.Close()

for rows.Next() {
    var msgID int64
    var message json.RawMessage
    rows.Scan(&msgID, &message)

    // Process message

    // Delete after processing
    db.Exec("SELECT pgmq.delete('slack_notification_queue', $1)", msgID)
}
```

### Adding External Service Integration

Follow the pattern in `services/slack_service.go`, `services/fcm_service.go`:

```go
type NewIntegrationService struct {
    db     *sql.DB
    client *SomeAPIClient
}

func NewNewIntegrationService(db *sql.DB) (*NewIntegrationService, error) {
    // Initialize API client with credentials from env
    apiKey := os.Getenv("NEW_INTEGRATION_API_KEY")
    client := NewAPIClient(apiKey)

    return &NewIntegrationService{
        db:     db,
        client: client,
    }, nil
}
```

## Service Dependencies

Key services and their dependencies (initialized in `router/api.go`):

```go
fcmService         := services.NewFCMService(pg)
slackService       := services.NewSlackService(pg)
alertService       := services.NewAlertService(pg, redis, fcmService)
incidentService    := services.NewIncidentService(pg, redis, fcmService)
userService        := services.NewUserService(pg, redis)
groupService       := services.NewGroupService(pg)
escalationService  := services.NewEscalationService(pg, redis, groupService, fcmService)
```

**Pattern:** Services that depend on other services receive them as constructor parameters.

## Authentication & Authorization

**Supabase JWT middleware** protects routes:

```go
// In router/api.go
supabaseAuthMiddleware := handlers.NewSupabaseAuthMiddleware(userService)

authenticated := r.Group("/")
authenticated.Use(supabaseAuthMiddleware.RequireAuth())
authenticated.GET("/protected", handler.Protected)
```

**Middleware extracts user from JWT** and sets in context:
- Access via `c.Get("user")` in handlers
- User ID available at `c.Get("user_id")`

## Environment Variables

**Required:**
```bash
DATABASE_URL=postgresql://user:pass@host:port/dbname
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx...
```

**Optional:**
```bash
PORT=8080                           # API server port
REDIS_URL=redis://localhost:6379    # Redis for caching
SLACK_BOT_TOKEN=xoxb-...           # Slack integration
SLACK_SIGNING_SECRET=xxx           # Slack webhook verification
FCM_CREDENTIALS_PATH=./firebase.json  # Firebase for push notifications
OPENAI_API_KEY=sk-...              # For AI agent service
```

## WebSocket Endpoints

The API includes webhook handlers for external integrations:

**Alertmanager webhook:**
```bash
POST /webhooks/alertmanager
Content-Type: application/json

{
  "alerts": [...],
  "status": "firing"
}
```

**Datadog webhook:**
```bash
POST /webhooks/datadog
Content-Type: application/json

{
  "id": "8306077573749414142",
  "title": "[P1] [Triggered] Alert",
  "transition": "Triggered",
  ...
}
```

**Prometheus webhook:**
```bash
POST /webhooks/prometheus
Content-Type: application/json

{
  "alerts": [...],
  "status": "firing"
}
```

See `handlers/webhook.go` for implementation details.

## CORS Configuration

CORS is configured in `router/api.go`:

```go
r.Use(func(c *gin.Context) {
    c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
    c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")
    // ...
})
```

For production, update `Access-Control-Allow-Origin` to specific domains.

## Code Organization Principles

1. **Handlers are thin** - validate input, call service, return response
2. **Services contain business logic** - reusable, testable
3. **Database access in services** - not in handlers
4. **Use context.Context** - for cancellation and timeouts
5. **Error handling** - return errors, log in handlers
6. **Constructor pattern** - `NewXxxService(dependencies)` returns `*XxxService`

## Debugging

**Enable detailed logs:**
```bash
# Gin sets debug mode in main.go
gin.SetMode(gin.DebugMode)
```

**Check database connectivity:**
```bash
psql $DATABASE_URL -c "SELECT 1"
```

**Check Redis connectivity:**
```bash
redis-cli -u $REDIS_URL ping
```

**View worker logs:**
```bash
# Go workers log to stdout
go run cmd/worker/main.go

# Python Slack worker logs to file and stdout
tail -f workers/slack_worker.log
```

## Common Issues

**"Database connection failed"**
- Check `DATABASE_URL` is set and valid
- Ensure database is running and accessible
- Verify migrations are applied (see root CLAUDE.md)

**"Port already in use"**
```bash
lsof -i :8080
kill -9 <PID>
```

**"Module import error" (Go)**
```bash
go mod download
go mod tidy
```

**"PGMQ queue not found"**
- Ensure PGMQ extension is installed in database
- Check migrations have created required queues

**"Supabase auth failed"**
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set
- Check JWT token is valid and not expired

## Dependencies

Key Go dependencies (from `go.mod`):
- `github.com/gin-gonic/gin` - Web framework
- `github.com/lib/pq` - PostgreSQL driver
- `github.com/go-redis/redis/v8` - Redis client
- `github.com/golang-jwt/jwt/v5` - JWT authentication
- `firebase.google.com/go/v4` - Firebase Admin SDK
- `github.com/google/uuid` - UUID generation

## Related Documentation

- **Root CLAUDE.md** - Project overview and deployment
- **ai/CLAUDE.md** - Comprehensive AI agent documentation
- **README.md** - Getting started guide
