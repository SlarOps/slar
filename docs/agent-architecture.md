---
title: "Agent Architecture"
description: "Distributed multi-tenant AI agent system — Control Plane routing, WebSocket session lifecycle, tool permission layers, MCP integration, Vault credentials, and multi-agent deployment"
---

# Agent Architecture

## Overview

SLAR's AI agent system is a distributed, multi-tenant architecture where Claude-powered agents handle incident response and on-call automation. It consists of two main layers:

1. **Control Plane** (Go API, port 8080) — routes client traffic to agents, manages agent registry
2. **Agent Service** (Python/FastAPI, port 8002) — runs Claude via the Agent SDK, manages tools, sessions, and security

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                       │
│                     WebSocket / HTTP requests                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Control Plane (Go API)                      │
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │  AIProxyHandler  │    │    AgentRegistrationHandler      │   │
│  │  GET /ws/chat    │    │  POST /internal/agents/register  │   │
│  │  (WS Proxy)      │    │  POST /internal/agents/heartbeat │   │
│  └────────┬─────────┘    └──────────────────────────────────┘   │
│           │                              ▲                      │
│           ▼                              │                      │
│  ┌──────────────────────────────────┐    │                      │
│  │          AgentRegistry           │    │  (heartbeat every   │
│  │  org:{org_id} → agent_url        │    │   30 seconds)       │
│  │  {project_id} → agent_url        │    │                      │
│  └────────┬─────────────────────────┘    │                      │
│           │                              │                      │
└───────────┼──────────────────────────────┼──────────────────────┘
            │ (WebSocket forward)          │ (self-registration)
            ▼                              │
┌─────────────────────────────────────────┴──────────────────────┐
│                     Agent Service (Python)                      │
│                   claude_agent_api_v1.py                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              WebSocket Session                          │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │    │
│  │  │  msg_router │  │ agent_queue  │  │  output_queue │  │    │
│  │  │  (receives) │→ │ (prompts)    │  │  (responses)  │  │    │
│  │  └─────────────┘  └──────┬───────┘  └───────▲───────┘  │    │
│  │                          │                   │          │    │
│  │                          ▼                   │          │    │
│  │              ┌───────────────────────┐       │          │    │
│  │              │    Claude Agent SDK   │───────┘          │    │
│  │              │  (claude_sdk_client)  │                  │    │
│  │              └───────────────────────┘                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ PolicyEngine │  │ AuditService │  │  CostTrackingService  │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  VaultClient │  │  MCPManager  │  │   WorkspaceService    │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└────────────────────────────────────────┬────────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
            ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
            │  PostgreSQL  │   │  HashiCorp   │   │  MCP Servers │
            │  (Primary DB)│   │    Vault     │   │  (External   │
            │              │   │  (Secrets)   │   │   Tools)     │
            └──────────────┘   └──────────────┘   └──────────────┘
```

---

## Control Plane — Agent Registry

### Registration Flow

Agents self-register on startup with outbound-only calls to the Control Plane. This means agents need outbound network access to the Control Plane but the Control Plane does NOT need inbound access to agents (agents push their host/port).

```
Agent startup
    │
    ├─→ POST /internal/agents/register
    │       { org_id, project_id?, host, port }
    │
    └─→ loop every 30s: POST /internal/agents/heartbeat
            { org_id, project_id? }
```

### Registry Key Schema

| Agent Scope | Registry Key | Example |
|---|---|---|
| Org-level (default) | `org:{org_id}` | `org:abc-123` |
| Project-specific | `{project_id}` | `proj-xyz` |

When a client connects with a `project_id`, the proxy first looks for a project-specific agent, then falls back to the org-level agent.

### WebSocket Proxy Flow

```
Client
  │
  ├─ GET /ws/chat?protocol=jwt&project_id=X&org_id=Y&token=Z
  │
  ▼
AIProxyHandler.ProxyWebSocket()
  │
  ├─ AgentRegistry.GetAgentURLWithOrg(project_id, org_id)
  │     → ws://agent-host:8002
  │
  ├─ Upgrade client connection to WebSocket
  │
  ├─ Dial agent WebSocket:
  │     protocol=jwt  → /ws/chat
  │     protocol=zero-trust → /ws/secure/chat
  │
  └─ pipeMessages() — two goroutines bidirectional pipe
        client → agent
        agent  → client
```

---

## Agent Service — Session Lifecycle

### WebSocket Session Internals

Each connected client gets a dedicated async session with four concurrent tasks:

```
WebSocket connection
        │
        ▼
  message_router()          ← reads ALL inbound WS messages (single reader)
   /        |        \
  ▼         ▼         ▼
agent_    interrupt_  permission_
queue     queue       response_queue
  │
  ▼
message_generator()         ← async generator feeds Claude SDK
  │
  ▼
ClaudeSDKClient.stream()   ← runs Claude with tools
  │
  ▼
process_responses()         ← handles SDK output stream
  │
  ▼
output_queue → websocket_sender() → Client
```

**Key design decisions:**
- Single WebSocket reader (`message_router`) avoids concurrent read race conditions
- Output queue serializes all writes to avoid concurrent write race conditions
- `heartbeat_task` sends periodic pings through the output queue (not directly)

### Message Types (Client → Agent)

| Type | Queue | Description |
|---|---|---|
| `interrupt` | interrupt_queue | Stop current generation |
| `permission_response` | permission_response_queue | User approves/denies tool |
| `fetch_capabilities` | agent_queue | Fetch slash commands (silent) |
| _(default)_ | agent_queue | User chat message |

### Message Types (Agent → Client)

| Type | Description |
|---|---|
| `text` | Assistant text response |
| `thinking` | Extended thinking block |
| `tool_result` | Tool execution result |
| `todo_update` | TodoWrite tool state |
| `conversation_started` | New conversation ID |
| `capabilities` | Available commands/plugins/skills |
| `ping` | Keep-alive heartbeat |

---

## Session Initialization

When the first message arrives on a new WebSocket connection, the agent initializes the session context:

```
First message fields:
  auth_token    → OIDC/JWT token for user identity
  org_id        → Tenant isolation
  project_id    → Project scoping (optional)
  user_id       → Explicit user ID (fallback: extracted from token)
  session_id    → Client-assigned session ID
  conversation_id → Resume existing conversation
```

Initialization sequence:

```
1. Extract user_id from auth_token (OIDC sub → UUID)
2. Get user workspace path: workspaces/{user_id}/
3. Load MCP servers from PostgreSQL (.mcp.json in workspace)
4. Load plugins from PostgreSQL (git-cloned to .claude/plugins/)
5. Sync CLAUDE.md memory from PostgreSQL
6. Sync skills from PostgreSQL
7. Load exported credentials from Vault → env vars
8. Initialize PolicyEvaluator (fetch policies from Go API)
9. Build ClaudeAgentOptions with:
   - workspace path
   - MCP server configs
   - allowed_tools (filtered by policy)
   - permission_callback
   - hooks (audit)
   - credential env vars
```

---

## Tool Permission System

### Two-Layer Authorization

Tool execution goes through two independent checks:

```
Tool invocation
      │
      ▼
Layer 1: PolicyEvaluator (ReBAC rules from DB)
      │
      ├─ DENY match  → reject immediately (no user prompt)
      ├─ ALLOW match → approve immediately (no user prompt)
      └─ No match    → fall through to Layer 2
      │
      ▼
Layer 2: allowed_tools bypass OR user confirmation prompt
      │
      ├─ Tool in allowed_tools list → approve automatically
      └─ Not in list → send permission_request to client
                          wait for permission_response
                          approve or reject based on user input
```

### PolicyEvaluator

Policies are stored in PostgreSQL (`agent_policies` table) and fetched via the Go API.

**Policy schema:**
```
effect:          "allow" | "deny"
principal_type:  "role" | "user" | "*"
principal_value: role name or user_id (null for wildcard)
tool_pattern:    fnmatch glob, e.g. "mcp__bash__*" or "*"
priority:        integer — higher wins
is_active:       boolean
```

**Conflict resolution:** DENY > ALLOW at equal priority. Higher priority number wins.

**Policy caching:** Policies are cached in-memory per session and refreshed every 60 seconds via version check against the API.

```python
# Evaluation flow
result = await evaluator.evaluate(tool_name)
if result.matched:
    if result.effect == "deny":
        return PermissionResultDeny(message=result.reason)
    elif result.effect == "allow":
        return PermissionResultAllow()
# No match → fall through to allowed_tools or user prompt
```

---

## MCP Integration

MCP (Model Context Protocol) servers extend the agent with external tools.

### Built-in MCP Servers

| Server | Module | Tools |
|---|---|---|
| Incident Tools | `incident_tools.py` | Create/query incidents (direct DB) |
| Memory Tools | `memory_tools.py` | CLAUDE.md persistence |

### User-Configured MCP Servers

Users configure external MCP servers via the UI. Configs are stored in PostgreSQL and synced to workspace `.mcp.json` files.

```
PostgreSQL (mcp_servers table)
      │
      ▼ sync on session init
workspaces/{user_id}/.mcp.json
      │
      ▼
MCPConfigManager (in-memory cache, 60s TTL)
      │
      ▼
ClaudeAgentOptions.mcp_servers
      │
      ▼
Claude Agent SDK spawns MCP server processes
```

### Marketplace Plugins

Plugins are git repositories that extend the agent. They are cloned into the workspace on installation.

```
Marketplace registry (PostgreSQL)
      │
      ▼ git clone on install
workspaces/{user_id}/.claude/plugins/{plugin_name}/
      │
      ▼ loaded on session init via workspace_service.load_user_plugins()
ClaudeAgentOptions (plugin configs injected)
```

---

## Security Architecture

### Authentication

| Layer | Method | Details |
|---|---|---|
| Control Plane WS | JWT query param | `?token=<jwt>` — Supabase JWT or OIDC token |
| Agent WS (JWT) | JWT in first message | `auth_token` field — verified by agent |
| Agent WS (Zero-Trust) | OIDC at `/ws/secure/chat` | Token verified by `zero_trust_verifier.py` |
| REST endpoints | Bearer token in Authorization header | Verified per-request |

**User ID derivation:**
- Supabase users: UUID from JWT `sub` claim
- OIDC users: `uuid5(DNS_NAMESPACE, oidc_sub)` — deterministic, matches Go API

### Credential Management (Vault)

Credentials with `export_to_agent=true` are loaded from HashiCorp Vault at session start and injected as environment variables into the agent process.

```
Vault path layout:
  secret/users/{user_id}/{type}/{name}       ← user-scoped
  secret/projects/{project_id}/{type}/{name} ← project-scoped (preferred)

Env injection flow:
  1. Check user has project access (authz client)
  2. List credentials in Vault
  3. Resolve env_mappings: { ENV_VAR: json_key }
  4. Inject into ClaudeAgentOptions.environment
```

### Rate Limiting

All endpoints (except `/health`) are rate-limited per user:

```
Config: AI_RATE_LIMIT requests per window (default: 60/min)
Storage: in-memory dict (per-process, resets on restart)
Exceeded → 429 response + audit log EVENT_TYPE.AUTH_RATE_LIMITED
```

### Audit Logging

`AuditService` logs all significant events to PostgreSQL asynchronously (batch writer, 50 events / 5s flush):

| Category | Events |
|---|---|
| `session` | Connect, disconnect, auth failures |
| `chat` | User messages (preview only, not full content) |
| `tool` | Tool invocations with approval status and policy result |
| `security` | Rate limits, signature errors, auth failures |

---

## Workspace Layout

Each user gets an isolated workspace directory:

```
workspaces/
└── {user_id}/
    ├── .mcp.json              ← MCP server configurations
    ├── CLAUDE.md              ← Persistent memory (synced from DB)
    └── .claude/
        ├── plugins/
        │   └── {plugin_name}/ ← Git-cloned marketplace plugins
        └── skills/
            └── {skill_name}.md ← User skills (synced from DB)
```

---

## Cost Tracking

Every Claude SDK `ResultMessage` is captured and logged to PostgreSQL:

```python
ResultMessage fields captured:
  total_cost_usd              → float
  usage.input_tokens          → int
  usage.output_tokens         → int
  usage.cache_creation_input_tokens → int
  usage.cache_read_input_tokens     → int
  duration_ms                 → int
  num_turns                   → int

Context captured:
  user_id, org_id, project_id, session_id, conversation_id, model
```

**Batch writing:** events queued in memory, flushed every 5 seconds or when 50 events accumulate. Idempotent via `ON CONFLICT (event_id) DO NOTHING`.

---

## Key Files Reference

### Agent Service (`api/ai/`)

| File | Responsibility |
|---|---|
| `claude_agent_api_v1.py` | Main FastAPI app, WebSocket sessions, Control Plane registration |
| `workspace_service.py` | Workspace management, OIDC token → user_id, MCP/plugin/skill loading |
| `mcp_config_manager.py` | MCP config cache with TTL |
| `policy_evaluator.py` | Declarative tool access control (allow/deny policies) |
| `audit_service.py` | Async audit log writer |
| `cost_tracking_service.py` | Async cost event batch writer |
| `vault_client.py` | HashiCorp Vault integration for secrets |
| `incident_tools.py` | Built-in incident management MCP tools (direct DB) |
| `memory_tools.py` | Built-in CLAUDE.md persistence tools |
| `zero_trust_verifier.py` | OIDC token verification for zero-trust auth |
| `authz/client.py` | ReBAC role lookup (calls Go API) |

### Control Plane (`api/handlers/`)

| File | Responsibility |
|---|---|
| `ai_proxy.go` | WebSocket proxy — client ↔ agent bidirectional pipe |
| `ai_api_proxy.go` | HTTP proxy — forwards sync API calls to agent |
| `agent_registration.go` | Agent self-registration and heartbeat endpoints |
| `policy.go` | CRUD endpoints for agent policies |

### Agent Routes (`api/ai/routes_*.py`)

| File | Routes |
|---|---|
| `routes_conversations.py` | Conversation history CRUD |
| `routes_mcp.py` | MCP server management |
| `routes_tools.py` | Allowed tools management |
| `routes_skills.py` | Skill repository |
| `routes_marketplace.py` | Plugin marketplace |
| `routes_credentials.py` | Credential management |
| `routes_cost.py` | Cost analytics and export |
| `routes_audit.py` | Audit log query |
| `routes_sync.py` | Workspace sync |
| `routes_memory.py` | Memory (CLAUDE.md) management |

---

## Environment Variables

### Agent Service

| Variable | Default | Description |
|---|---|---|
| `CONTROL_PLANE_URL` | `http://localhost:8080` | Go API URL for registration |
| `AI_ORG_ID` | — | Org this agent belongs to (required for CP registration) |
| `AI_PROJECT_ID` | — | Project this agent serves (empty = org-level) |
| `AI_HOST` | `localhost` | Host reported to Control Plane |
| `AI_PORT` | `8002` | Port this agent listens on |
| `AI_ALLOWED_ORIGINS` | `http://localhost:3000,...` | CORS allowed origins |
| `AI_RATE_LIMIT` | `60` | Requests per minute per user |
| `ANTHROPIC_API_KEY` | — | Claude API key (required) |
| `DATABASE_URL` | — | PostgreSQL connection (required) |
| `VAULT_ADDR` | `http://vault:8200` | HashiCorp Vault address |
| `VAULT_ENABLED` | `true` | Enable Vault integration |
| `USER_WORKSPACES_DIR` | `./workspaces` | Root directory for user workspaces |

---

## Multi-Agent Deployment

Multiple agent instances can run simultaneously, each serving different scopes:

```
┌─────────────────────────────────────────┐
│            Control Plane                │
│                                         │
│  Registry:                              │
│    org:abc-123  → agent-default:8002    │
│    proj-xyz     → agent-dedicated:8002  │
└─────────────────────────────────────────┘
          │                    │
          ▼                    ▼
┌──────────────────┐  ┌──────────────────┐
│  Agent (Default) │  │ Agent (Dedicated) │
│  AI_ORG_ID=abc   │  │ AI_ORG_ID=abc    │
│  AI_PROJECT_ID=  │  │ AI_PROJECT_ID=   │
│  (empty)         │  │ proj-xyz         │
└──────────────────┘  └──────────────────┘
```

Client requests for `proj-xyz` route to the dedicated agent; all other projects in org `abc-123` route to the default agent.
