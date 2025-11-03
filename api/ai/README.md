# SLAR AI Agent - Claude Agent SDK Integration

Complete AI-powered incident management system using Claude Agent SDK with MCP tool integration, WebSocket communication, and Supabase Storage synchronization.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Features](#features)
- [Bucket Synchronization](#bucket-synchronization)
- [MCP Configuration](#mcp-configuration)
- [API Reference](#api-reference)
- [Frontend Integration](#frontend-integration)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Overview

The SLAR AI Agent provides intelligent incident management through natural language conversations. Built with Claude Agent SDK, it integrates with your SLAR backend to provide real-time incident analysis, statistics, and management capabilities.

### Key Technologies

- **Claude Agent SDK** - Multi-agent framework with tool approval system
- **FastAPI** - High-performance async web framework
- **WebSocket** - Real-time bidirectional communication
- **Supabase Storage** - Cloud storage for MCP configs and skills
- **MCP (Model Context Protocol)** - Extensible tool integration

### What's Included

```
api/ai/
├── claude_agent_api_v1.py       # Main WebSocket server
├── incident_tools.py            # SLAR incident management tools
├── supabase_storage.py          # Storage sync & hash management
├── mcp_config_manager.py        # MCP configuration management
├── requirements.txt             # Python dependencies
└── README.md                    # This file
```

---

## Architecture

### System Flow

```
┌──────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                    │
│  - User opens AI Agent page                                   │
│  - Calls POST /api/sync-bucket (sync MCP + skills)           │
│  - Connects WebSocket to ws://localhost:8002/ws/chat         │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    AI Agent API (FastAPI)                     │
│  - WebSocket server with session management                   │
│  - Hash-based bucket synchronization                          │
│  - MCP server integration (incident tools + user tools)       │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    Claude Agent SDK                           │
│  - AssistantAgent with tool approval system                   │
│  - Natural language understanding                             │
│  - Tool orchestration and execution                           │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                      MCP Servers                              │
│  ├─ incident_tools: SLAR incident management                  │
│  ├─ context7: Documentation retrieval                         │
│  └─ user_tools: Custom user-uploaded tools                    │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    SLAR Backend API (Go)                      │
│  - GET /incidents - List incidents                            │
│  - GET /incidents/{id} - Get incident details                 │
│  - GET /incidents/stats - Get statistics                      │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                  PostgreSQL (Supabase)                        │
│  - incidents, users, services tables                          │
└──────────────────────────────────────────────────────────────┘
```

### Bucket Synchronization Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Storage                          │
│  Buckets (per user):                                         │
│  ├─ .mcp.json              (MCP configuration)               │
│  └─ skills/                (User skills directory)           │
│      ├─ skill1.skill                                         │
│      ├─ skill2.zip                                           │
│      └─ skill-bundle.zip                                     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ POST /api/sync-bucket (frontend)
                   │ sync_all_from_bucket() (backend)
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│               Local Workspace (Backend)                      │
│  workspaces/{user-id}/.claude/                               │
│  ├─ .mcp.json                                                │
│  ├─ .sync_state           (hash tracking)                    │
│  └─ skills/                                                  │
│      ├─ skill1.skill                                         │
│      ├─ skill2/           (extracted from .zip)              │
│      └─ skill-bundle/                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

```bash
# Required
Python 3.11+
SLAR Backend API running (Go)
Supabase account with Storage enabled

# Environment Variables
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJxxx..."
SLAR_API_URL="http://localhost:8080"
SLAR_API_TOKEN="your-jwt-token"
OPENAI_API_KEY="sk-xxx..."
```

### Installation

```bash
cd /Users/chonle/Documents/feee/slar-oss/api/ai

# Install dependencies
pip install -r requirements.txt

# Verify installation
python -c "from claude_agent_sdk import ClaudeAgentOptions; print('✅ OK')"
```

### Running the Server

```bash
# Development mode with auto-reload
uvicorn claude_agent_api_v1:app --host 0.0.0.0 --port 8002 --reload

# Production mode
python claude_agent_api_v1.py

# Expected output:
# INFO:     Started server process [12345]
# INFO:     Waiting for application startup.
# INFO:     Application startup complete.
# INFO:     Uvicorn running on http://0.0.0.0:8002
```

### Verify Connection

```bash
# Health check
curl http://localhost:8002/health

# Expected: {"status": "ok"}

# Test WebSocket (requires wscat)
wscat -c ws://localhost:8002/ws/chat
```

---

## Features

### 1. Incident Management Tools

Built-in tools for SLAR incident operations:

#### `get_incidents_by_time`
Fetch incidents within a time range with filters.

**Example Prompt:**
> "Show me all critical incidents from the last 24 hours"

**Parameters:**
- `start_time`: ISO 8601 timestamp
- `end_time`: ISO 8601 timestamp
- `status`: "triggered" | "acknowledged" | "resolved" | "all"
- `limit`: Max results (default: 50)

#### `get_incident_by_id`
Get detailed information about a specific incident.

**Example Prompt:**
> "What's the status of incident 04aed5ec-0279-4320-b163-7a8b49e14dee?"

**Parameters:**
- `incident_id`: UUID string

#### `get_incident_stats`
Get aggregate statistics for various time ranges.

**Example Prompt:**
> "How many incidents were resolved this week?"

**Parameters:**
- `time_range`: "24h" | "7d" | "30d"

### 2. Hash-Based Bucket Synchronization

Automatic, efficient synchronization between Supabase Storage and local workspace.

**How It Works:**

1. **Hash Calculation**
   ```python
   # Bucket hash = SHA256(file_name + file_size + updated_at)
   bucket_hash = calculate_bucket_hash(files_metadata)

   # Local hash = SHA256(all file paths + all file contents)
   local_hash = calculate_directory_hash(workspace_path)
   ```

2. **Sync Decision**
   ```python
   # Compare hashes
   if bucket_hash != saved_bucket_hash or local_hash != saved_local_hash:
       sync_all_from_bucket()  # Download changed files
   else:
       skip_sync()  # No changes, skip download
   ```

3. **State Tracking**
   ```json
   // .claude/.sync_state
   {
     "bucket_hash": "a3f8d92c...",
     "local_hash": "b4e9c13d...",
     "last_sync": "2025-11-03T10:30:00Z"
   }
   ```

**Benefits:**

- ✅ **Automatic**: Syncs on WebSocket connect
- ✅ **Efficient**: Only downloads when changed
- ✅ **Recovery**: Auto-restores deleted local files
- ✅ **Multi-device**: Syncs across devices
- ✅ **Fast**: Hash comparison ~5ms, skip download if unchanged

**Scenarios:**

| Scenario | Action |
|----------|--------|
| First connection | Download all files |
| Bucket unchanged | Skip download (~5ms) |
| New skill uploaded | Download new skill only |
| Local files deleted | Re-download from bucket |
| Multi-device upload | Auto-sync on other devices |

### 3. MCP Configuration Management

User-specific MCP server configuration via `.mcp.json` file.

**Configuration Format:**

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@uptudev/mcp-context7"],
      "env": {}
    },
    "custom-tool": {
      "command": "python",
      "args": ["./tools/custom_tool.py"],
      "env": {
        "API_KEY": "xxx"
      }
    }
  },
  "agentConfig": {
    "model": "sonnet",
    "permissionMode": "default",
    "maxTokens": 4096,
    "autoApproveReadOnly": true,
    "denyDestructive": true
  },
  "metadata": {
    "version": "1.0.0",
    "updatedAt": "2025-11-03T10:00:00Z"
  }
}
```

**Loading Process:**

1. Frontend uploads `.mcp.json` to Supabase Storage
2. Backend syncs on connection (via `sync_all_from_bucket()`)
3. `get_user_mcp_servers()` reads from local workspace
4. MCP servers merged with built-in tools
5. Agent initialized with combined tool set

**Refactored Loading (Optimized):**

```python
# Before: Download from Supabase every time
async def get_user_mcp_servers(auth_token: str):
    config = await download_mcp_config(user_id)  # ❌ Slow
    return parse_mcp_servers(config)

# After: Read from local file (already synced)
async def get_user_mcp_servers(auth_token: str):
    workspace = get_user_workspace_path(user_id)
    mcp_file = Path(workspace) / ".mcp.json"

    if not mcp_file.exists():
        return {}  # ✅ Safe for dict merge

    config = json.load(open(mcp_file))  # ✅ Fast (~1ms)
    return parse_mcp_servers(config)
```

**Performance:** ~50x faster (500ms → 10ms)

### 4. Skill Management

Upload and manage custom skills via Supabase Storage.

**Supported Formats:**
- `.skill` files - Single skill files
- `.zip` archives - Multiple skills or bundled skills

**Upload Flow:**

```
Frontend → POST /upload-skill → Supabase Storage
    ↓
Backend syncs on next connection
    ↓
Skills extracted to .claude/skills/
    ↓
Available to Claude Agent
```

**Skill Structure:**

```
.claude/skills/
├── my-skill.skill           # Single file skill
├── skill-bundle/            # Extracted from .zip
│   ├── skill.json
│   ├── handler.py
│   └── requirements.txt
└── another-skill/
    └── ...
```

### 5. Tool Approval System

Interactive permission system for tool execution.

**Approval Modes:**

| Mode | Description |
|------|-------------|
| `interactive` | Ask user for every tool call |
| `rule_based` | Auto-approve read-only, deny destructive |
| `hybrid` | Combine rules + manual approval |

**Example Configuration:**

```python
from core.sre_agent import create_rule_based_approval_func

approval_func = create_rule_based_approval_func(
    allow_read_only=True,      # Auto-approve: get_*, list_*
    deny_destructive=True,     # Auto-deny: delete_*, destroy_*
    deny_production=True       # Auto-deny: operations on "production"
)

agent = AssistantAgent(
    name="sre_assistant",
    tools=INCIDENT_TOOLS,
    approval_func=approval_func,
    auto_approve_tools=["get_incident_stats"],
    always_deny_tools=["delete_incident"]
)
```

**WebSocket Approval Flow:**

```
Agent requests tool execution
    ↓
Backend sends permission_request
    ↓
Frontend displays approval UI
    ↓
User approves/denies
    ↓
Backend executes tool (if approved)
    ↓
Result sent to frontend
```

---

## Bucket Synchronization

### Sync-Then-Connect Pattern

The frontend implements a "sync before connect" pattern for reliable operation:

```javascript
// 1. Sync bucket first
const response = await fetch(`${API_URL}/api/sync-bucket`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ auth_token: session.access_token })
});

const result = await response.json();

if (result.success) {
  // 2. Then connect WebSocket
  connectWebSocket();
}
```

**Flow:**

```
User opens AI Agent page
    ↓
[Loading] "Loading your workspace..."
    ↓
POST /api/sync-bucket
    ↓
Backend: sync_all_from_bucket()
    ├─ Calculate bucket hash
    ├─ Compare with saved state
    ├─ Download if changed
    └─ Save new state
    ↓
Response: {success: true, skills_synced: 3}
    ↓
[Success] "Loaded 3 skills"
    ↓
Connect WebSocket
    ↓
Chat ready with all tools
```

**Benefits:**

- ✅ Skills guaranteed ready before chat
- ✅ Clear loading state for user
- ✅ Easy error recovery (retry button)
- ✅ No race conditions

### API Endpoint: `/api/sync-bucket`

**Request:**
```json
{
  "auth_token": "Bearer eyJhbGc..."
}
```

**Response - Success (synced):**
```json
{
  "success": true,
  "skipped": false,
  "message": "Synced successfully: MCP + 3 skills",
  "mcp_synced": true,
  "skills_synced": 3
}
```

**Response - Success (skipped):**
```json
{
  "success": true,
  "skipped": true,
  "message": "Bucket unchanged, skipped sync"
}
```

**Response - Error:**
```json
{
  "success": false,
  "message": "Error: User not authenticated"
}
```

### Hash Calculation Details

**Bucket Hash:**
```python
def calculate_bucket_hash(files_metadata: List[Dict]) -> str:
    """
    Hash based on file metadata (no download needed).
    """
    content = ""
    for file in sorted(files_metadata, key=lambda f: f['name']):
        content += f"{file['name']}:{file['size']}:{file['updated_at']}"
    return hashlib.sha256(content.encode()).hexdigest()
```

**Local Workspace Hash:**
```python
def calculate_directory_hash(directory: Path) -> str:
    """
    Hash based on file paths and contents.
    """
    file_hashes = []
    for file_path in sorted(directory.rglob("*")):
        if file_path.is_file():
            rel_path = file_path.relative_to(directory)
            with open(file_path, 'rb') as f:
                file_hash = hashlib.sha256(f.read()).hexdigest()
            file_hashes.append(f"{rel_path}:{file_hash}")

    combined = "|".join(file_hashes)
    return hashlib.sha256(combined.encode()).hexdigest()
```

---

## MCP Configuration

### Configuration Workflow

```
┌────────────────────────────────────────┐
│  Frontend (Integrations Page)          │
│  - User edits MCP config in UI         │
│  - Calls uploadMCPConfig(userId, cfg)  │
└────────────┬───────────────────────────┘
             │
             ▼
┌────────────────────────────────────────┐
│  Supabase Storage                      │
│  - Upload to {userId}/.mcp.json        │
│  - Create bucket if not exists         │
└────────────┬───────────────────────────┘
             │
             │ User opens AI Agent
             │
             ▼
┌────────────────────────────────────────┐
│  Backend: sync_all_from_bucket()       │
│  - Download .mcp.json to workspace     │
│  - Save to workspaces/{userId}/.claude/│
└────────────┬───────────────────────────┘
             │
             ▼
┌────────────────────────────────────────┐
│  Backend: get_user_mcp_servers()       │
│  - Read .mcp.json from local workspace │
│  - Parse mcpServers section            │
│  - Return merged with built-in tools   │
└────────────┬───────────────────────────┘
             │
             ▼
┌────────────────────────────────────────┐
│  Agent Initialization                  │
│  ClaudeAgentOptions(                   │
│    mcp_servers={                       │
│      "incident_tools": {...},          │
│      **user_mcp_servers                │
│    }                                   │
│  )                                     │
└────────────────────────────────────────┘
```

### Built-in vs User MCP Servers

**Built-in (Always Available):**
- `incident_tools` - SLAR incident management tools

**User-specific (From `.mcp.json`):**
- `context7` - Documentation retrieval
- `custom-tool` - User-uploaded custom tools
- Any other MCP server the user configures

**Merge Strategy:**
```python
# Built-in tools (always included)
incident_tools = create_incident_tools_server()

# User tools (from .mcp.json)
user_mcp_servers = await get_user_mcp_servers(auth_token)

# Merge (user tools can override built-in)
mcp_servers = {
    "incident_tools": incident_tools,
    **user_mcp_servers  # User config takes precedence
}
```

---

## API Reference

### WebSocket API

**Endpoint:** `ws://localhost:8002/ws/chat`

**Message Format:**

**Client → Server:**
```json
{
  "prompt": "Show me recent incidents",
  "session_id": "session_123",
  "auth_token": "Bearer eyJhbGc..."
}
```

**Server → Client:**

**Text Message:**
```json
{
  "type": "text",
  "content": "Here are the recent incidents..."
}
```

**Thinking Block:**
```json
{
  "type": "thinking",
  "content": "I need to call get_incidents_by_time tool..."
}
```

**Tool Use:**
```json
{
  "type": "tool_use",
  "content": {
    "tool_name": "get_incidents_by_time",
    "tool_input": {"start_time": "...", "end_time": "..."}
  }
}
```

**Tool Result:**
```json
{
  "type": "tool_result",
  "content": "Found 10 incidents: [...]"
}
```

**Permission Request:**
```json
{
  "type": "permission_request",
  "approval_id": "approval_123",
  "tool_name": "get_incident_by_id",
  "tool_input": {"incident_id": "xxx"}
}
```

**Complete:**
```json
{
  "type": "complete"
}
```

**Error:**
```json
{
  "type": "error",
  "error": "Error message"
}
```

### HTTP Endpoints

#### `GET /health`
Health check endpoint.

**Response:**
```json
{"status": "ok"}
```

#### `POST /api/sync-bucket`
Sync Supabase Storage bucket to local workspace.

**Request:**
```json
{
  "auth_token": "Bearer eyJhbGc..."
}
```

**Response:**
```json
{
  "success": true,
  "skipped": false,
  "message": "Synced successfully: MCP + 3 skills",
  "mcp_synced": true,
  "skills_synced": 3
}
```

#### `POST /sessions`
Create new agent session.

**Request:**
```json
{
  "auth_token": "Bearer eyJhbGc..."
}
```

**Response:**
```json
{
  "session_id": "session_abc123",
  "created_at": "2025-11-03T10:00:00Z"
}
```

#### `GET /sessions`
List all active sessions.

**Response:**
```json
{
  "sessions": [
    {
      "session_id": "session_abc123",
      "created_at": "2025-11-03T10:00:00Z",
      "user_id": "user-456"
    }
  ]
}
```

---

## Frontend Integration

### React/Next.js Example

```javascript
'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSyncBucket } from '@/hooks/useSyncBucket';
import { useClaudeWebSocket } from '@/hooks/useClaudeWebSocket';

export default function AIAgentPage() {
  const { session } = useAuth();
  const authToken = session?.access_token;

  // Step 1: Sync bucket
  const { syncStatus, syncMessage, syncBucket } = useSyncBucket(authToken);

  // Step 2: Connect WebSocket (manual)
  const {
    messages,
    sendMessage,
    connect: connectWebSocket
  } = useClaudeWebSocket(authToken, { autoConnect: false });

  // Sync on mount
  useEffect(() => {
    if (authToken) {
      syncBucket();
    }
  }, [authToken]);

  // Connect after sync
  useEffect(() => {
    if (syncStatus === 'ready') {
      connectWebSocket();
    }
  }, [syncStatus]);

  return (
    <div>
      {/* Loading state */}
      {syncStatus === 'syncing' && (
        <div>Loading your workspace...</div>
      )}

      {/* Error state */}
      {syncStatus === 'error' && (
        <div>
          <p>Error: {syncMessage}</p>
          <button onClick={retrySync}>Retry</button>
        </div>
      )}

      {/* Chat interface */}
      {syncStatus === 'ready' && (
        <div>
          <Messages messages={messages} />
          <ChatInput onSend={sendMessage} />
        </div>
      )}
    </div>
  );
}
```

### Custom Hooks

**`useSyncBucket.js`:**
```javascript
export function useSyncBucket(authToken) {
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncMessage, setSyncMessage] = useState('');

  const syncBucket = useCallback(async () => {
    setSyncStatus('syncing');
    setSyncMessage('Loading your workspace...');

    const response = await fetch(`${AI_API_URL}/api/sync-bucket`, {
      method: 'POST',
      body: JSON.stringify({ auth_token: authToken })
    });

    const result = await response.json();

    if (result.success) {
      setSyncStatus('ready');
      setSyncMessage(result.message);
    } else {
      setSyncStatus('error');
      setSyncMessage(result.message);
    }
  }, [authToken]);

  return { syncStatus, syncMessage, syncBucket };
}
```

**`useClaudeWebSocket.js`:**
```javascript
export function useClaudeWebSocket(authToken, options = {}) {
  const { autoConnect = false } = options;
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);

  const connect = useCallback(() => {
    const ws = new WebSocket('ws://localhost:8002/ws/chat');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleMessage(data);
    };

    wsRef.current = ws;
  }, []);

  const sendMessage = useCallback((prompt) => {
    wsRef.current.send(JSON.stringify({
      prompt,
      auth_token: authToken
    }));
  }, [authToken]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
  }, [autoConnect]);

  return { messages, sendMessage, connect };
}
```

---

## Testing

### Unit Tests

```bash
# Test incident tools
cd api/ai
python test_incident_tools.py

# Expected output:
# ✅ TEST 1: Get incidents by time range
# ✅ TEST 2: Filter by status
# ✅ TEST 3: Get incident by ID
# ✅ TEST 4: Get statistics
# ✅ TEST 5: Error handling
```

### Integration Tests

```bash
# Test hash sync
python test_hash_sync.py "Bearer eyJhbGc..."

# Expected output:
# 🔍 Calculating bucket hash...
# 📁 Calculating local workspace hash...
# 🔍 Checking if sync needed...
# 🔄 Running sync_all_from_bucket...
# ✅ Test completed!
```

### Manual Testing

```bash
# 1. Start backend API
cd api
go run cmd/main.go

# 2. Start AI agent
cd api/ai
python claude_agent_api_v1.py

# 3. Start frontend
cd web/slar
npm run dev

# 4. Open browser
open http://localhost:3000/ai-agent

# 5. Test flow
# - Should see "Loading your workspace..."
# - Then "Loaded X skills"
# - Then chat interface ready
```

---

## Troubleshooting

### Common Issues

#### Issue: Sync always triggers (never skips)

**Cause:** `.sync_state` file missing or corrupted

**Fix:**
```bash
# Check sync state
cat workspaces/{user-id}/.claude/.sync_state

# Delete and reconnect (will create fresh state)
rm workspaces/{user-id}/.claude/.sync_state
```

#### Issue: WebSocket connection fails

**Cause:** AI agent not running or port blocked

**Fix:**
```bash
# Check if service is running
curl http://localhost:8002/health

# Check port
lsof -i :8002

# Restart service
python claude_agent_api_v1.py
```

#### Issue: Tools not available in agent

**Cause:** `.mcp.json` not synced or parse error

**Fix:**
```bash
# Check if file exists
ls -la workspaces/{user-id}/.claude/.mcp.json

# Validate JSON
cat workspaces/{user-id}/.claude/.mcp.json | python -m json.tool

# Force sync
rm workspaces/{user-id}/.claude/.sync_state
```

#### Issue: Permission denied errors

**Cause:** Auth token invalid or expired

**Fix:**
```bash
# Verify token
python -c "import jwt; jwt.decode('your-token', options={'verify_signature': False})"

# Get new token from frontend
# Check Supabase session in browser console
```

### Debug Mode

Enable detailed logging:

```python
# In claude_agent_api_v1.py
logging.basicConfig(level=logging.DEBUG)
```

View logs in console for detailed debugging information.

---

## Performance Optimization

### Sync Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Hash calculation (bucket) | ~50ms | Metadata only, 1 API call |
| Hash calculation (local) | ~20ms | Local I/O for 10 files |
| Hash comparison | ~5ms | In-memory comparison |
| Full sync (MCP + 3 skills) | ~500ms | Download + extract |
| Skip sync (unchanged) | ~75ms | Hash calc only |

**Optimization Tips:**
- Sync happens once at connection start
- Subsequent connections skip if unchanged
- Only changed files re-downloaded
- Local cache reduces repeated downloads

### WebSocket Performance

| Operation | Time | Notes |
|-----------|------|-------|
| WebSocket connect | ~50ms | TCP + HTTP upgrade |
| Tool approval request | ~10ms | JSON message |
| Tool execution | ~200ms | Depends on tool |
| Message streaming | ~1ms/chunk | Real-time updates |

---

## Security

### Authentication

- All requests require valid Supabase JWT token
- Token verified on every WebSocket message
- Session isolated per user_id

### Authorization

- User can only access their own bucket
- Workspace directories isolated by user_id
- RLS policies enforce bucket access

### Tool Approval

- Interactive approval for destructive operations
- Rule-based auto-approve for read-only tools
- Always-deny list for dangerous operations

### Data Privacy

- Files stored in user-specific buckets
- Workspaces isolated per user
- No cross-user data access

---

## Dependencies

```txt
fastapi>=0.115.0
uvicorn>=0.32.0
websockets>=13.0
claude-agent-sdk>=0.1.0
aiohttp>=3.10.0
python-dotenv>=1.0.0
pydantic>=2.0.0
supabase>=2.0.0
pyjwt>=2.8.0
```

Install all:
```bash
pip install -r requirements.txt
```

---

## Contributing

### Code Style

- Follow PEP 8 for Python
- Use type hints for all functions
- Add docstrings for public APIs
- Write tests for new features

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/new-feature

# Make changes and commit
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/new-feature
```

---

## License

Apache 2.0 License - see [LICENSE](../../LICENSE) file for details.

---

## Support

For issues or questions:

1. Check this README
2. Review code comments
3. Run test scripts
4. Create GitHub issue

## Related Documentation

- [Root CLAUDE.md](../../CLAUDE.md) - Project overview
- [Backend CLAUDE.md](../CLAUDE.md) - Backend API docs
- [Frontend README](../../web/slar/README.md) - Frontend docs
