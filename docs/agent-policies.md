---
title: "Agent Policies"
description: "Declarative tool access control for AI agents — define allow/deny rules by role, user, or wildcard with priority-based conflict resolution"
---

# Agent Policies

## Overview

Agent Policies are a declarative access control layer that governs which tools the AI agent can invoke — and for whom — without requiring user confirmation for every action.

Policies are stored in PostgreSQL, evaluated by the Python `PolicyEvaluator` at tool invocation time, and sit **before** the existing user-prompt confirmation layer.

```
Tool invocation
      │
      ▼
Layer 1: PolicyEvaluator  ←── agent_policies table
      │
      ├─ DENY match  → reject immediately (no user prompt)
      ├─ ALLOW match → approve immediately (no user prompt)
      └─ No match    → fall through to Layer 2
      │
      ▼
Layer 2: allowed_tools list OR user confirmation prompt
      │
      ├─ Tool in allowed_tools → approve automatically
      └─ Not in list → send permission_request → wait for user response
```

This lets org admins encode security policy once and have it enforced consistently across all sessions, rather than relying on per-session `allowed_tools` configuration or manual user approvals.

---

## Policy Schema

```sql
CREATE TABLE agent_policies (
    id              UUID PRIMARY KEY,
    org_id          UUID NOT NULL,          -- Tenant isolation (required)
    project_id      UUID,                   -- NULL = org-wide policy
    name            TEXT NOT NULL,          -- Unique within org
    description     TEXT,
    effect          TEXT NOT NULL,          -- 'allow' | 'deny'
    principal_type  TEXT NOT NULL,          -- 'role' | 'user' | '*'
    principal_value TEXT,                   -- role name | user_id | NULL for '*'
    tool_pattern    TEXT NOT NULL DEFAULT '*', -- fnmatch glob or exact name
    priority        INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
);
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `effect` | `allow` \| `deny` | Whether to approve or reject the tool call |
| `principal_type` | `role` \| `user` \| `*` | Who this policy applies to |
| `principal_value` | string \| null | Role name, user UUID, or null for wildcard |
| `tool_pattern` | glob string | fnmatch pattern matched against tool names (e.g. `mcp__bash__*`) |
| `priority` | integer | Higher number wins; default 0 |
| `is_active` | boolean | Inactive policies are ignored |
| `project_id` | UUID \| null | Null means org-wide; non-null scopes to one project |

---

## Principal Types

### `*` — Wildcard (everyone)

Applies to all users in the org regardless of role.

```json
{ "principal_type": "*", "principal_value": null }
```

### `role` — Role-based

Applies to users whose effective role matches `principal_value`. Role is resolved at session start (project role takes precedence over org role).

```json
{ "principal_type": "role", "principal_value": "admin" }
{ "principal_type": "role", "principal_value": "member" }
{ "principal_type": "role", "principal_value": "viewer" }
```

### `user` — User-specific

Applies to a single user identified by UUID.

```json
{ "principal_type": "user", "principal_value": "550e8400-e29b-41d4-a716-446655440000" }
```

---

## Tool Patterns

Tool names follow the format `mcp__{server}__{tool}` for MCP tools, and bare names for built-in tools.

| Pattern | Matches |
|---|---|
| `*` | Every tool |
| `mcp__bash__*` | All tools from the `bash` MCP server |
| `mcp__bash__run_command` | Only the `run_command` tool from `bash` |
| `mcp__*` | All MCP tools |
| `TodoWrite` | Only the built-in `TodoWrite` tool |

Patterns use Python [`fnmatch`](https://docs.python.org/3/library/fnmatch.html) rules: `*` matches any sequence of characters, `?` matches a single character.

---

## Conflict Resolution

When multiple policies match the same `(user, tool)` pair, the evaluator picks a winner using two rules applied in order:

1. **Higher priority wins.** A policy with `priority: 10` beats one with `priority: 5`.
2. **DENY beats ALLOW at equal priority.** If two policies have the same priority, `deny` wins.

```
Example: org has these two active policies for the same user/tool

  Policy A: effect=allow, priority=5
  Policy B: effect=deny,  priority=5

  → Result: DENY  (rule 2: deny wins at equal priority)

Example: conflicting priorities

  Policy A: effect=deny,  priority=3
  Policy B: effect=allow, priority=10

  → Result: ALLOW  (rule 1: priority 10 beats priority 3)
```

---

## Policy Scope

Policies can be scoped at two levels:

| Scope | `project_id` field | Applies to |
|---|---|---|
| **Org-wide** | `null` | All projects in the org |
| **Project-specific** | UUID | Only that project |

When evaluating, the PolicyEvaluator loads policies for the org; it includes both org-wide policies and project-specific policies matching the session's `project_id`.

---

## Cache Invalidation

To avoid fetching policies on every tool call, the evaluator caches policies in-memory for the lifetime of a WebSocket session.

```
Session start
  │
  ├─ Fetch policies from Go API  (/internal/policies?org_id=...)
  ├─ Store in _cache list
  └─ Record current version from agent_policy_versions table

Each tool call (every 60 seconds)
  │
  ├─ GET /internal/policies/version?org_id=...
  ├─ Compare with cached version
  │
  ├─ Same version → skip reload, bump timer
  └─ Different version → reload full policy list
```

The `agent_policy_versions` table is updated automatically by a PostgreSQL trigger (`trg_bump_policy_version`) on any INSERT, UPDATE, or DELETE to `agent_policies`. Admins editing policies takes effect within 60 seconds for active sessions.

---

## REST API

All endpoints require `org_id` (query param or `X-Org-ID` header). Requests must include a valid Bearer token.

### List Policies

```
GET /policies?org_id=<uuid>&project_id=<uuid>&active_only=true
```

| Parameter | Required | Description |
|---|---|---|
| `org_id` | Yes | Tenant isolation |
| `project_id` | No | Filter to one project (omit for all scopes) |
| `active_only` | No | Return only `is_active=true` policies |

Response:
```json
{
  "policies": [ { ...policy } ],
  "total": 3
}
```

### Get Policy

```
GET /policies/:id?org_id=<uuid>
```

### Create Policy

```
POST /policies
Content-Type: application/json

{
  "org_id": "<uuid>",
  "project_id": "<uuid>",          // optional
  "name": "Block bash for viewers",
  "description": "Viewers cannot run shell commands",
  "effect": "deny",
  "principal_type": "role",
  "principal_value": "viewer",
  "tool_pattern": "mcp__bash__*",
  "priority": 10,
  "is_active": true
}
```

`org_id` can also be provided as a query param or `X-Org-ID` header; body takes precedence.

### Update Policy

```
PATCH /policies/:id?org_id=<uuid>
Content-Type: application/json

{
  "is_active": false
}
```

All fields are optional — only provided fields are updated.

### Delete Policy

```
DELETE /policies/:id?org_id=<uuid>
```

### Get Version (cache invalidation endpoint)

```
GET /policies/version?org_id=<uuid>
```

Response:
```json
{ "org_id": "<uuid>", "version": 7 }
```

---

## Common Policy Patterns

### Block all shell access for non-admin users

```json
[
  {
    "name": "deny-bash-non-admin",
    "effect": "deny",
    "principal_type": "role",
    "principal_value": "member",
    "tool_pattern": "mcp__bash__*",
    "priority": 10
  },
  {
    "name": "deny-bash-viewer",
    "effect": "deny",
    "principal_type": "role",
    "principal_value": "viewer",
    "tool_pattern": "mcp__bash__*",
    "priority": 10
  }
]
```

### Allow admins to use all tools without prompts

```json
{
  "name": "allow-all-admin",
  "effect": "allow",
  "principal_type": "role",
  "principal_value": "admin",
  "tool_pattern": "*",
  "priority": 0
}
```

### Block a specific user from running destructive commands

```json
{
  "name": "restrict-user-alice",
  "effect": "deny",
  "principal_type": "user",
  "principal_value": "550e8400-e29b-41d4-a716-446655440000",
  "tool_pattern": "mcp__bash__run_command",
  "priority": 20
}
```

### Deny all tools org-wide (whitelist mode)

Pair a low-priority deny-all with high-priority allow rules for specific tools:

```json
[
  {
    "name": "deny-all-default",
    "effect": "deny",
    "principal_type": "*",
    "tool_pattern": "*",
    "priority": 0
  },
  {
    "name": "allow-incident-tools",
    "effect": "allow",
    "principal_type": "*",
    "tool_pattern": "mcp__incident_tools__*",
    "priority": 10
  }
]
```

> **Important:** The allow rule must have **higher** priority than the deny rule. Deny beats allow only at the **same** priority level.

---

## How allowed_tools Interacts with Policies

`allowed_tools` is the list of tools that bypass user confirmation in Layer 2. At session initialization, the PolicyEvaluator **pre-filters** this list: any tool that matches an active DENY policy is removed from `allowed_tools` before the session starts.

```
Session init
  │
  ├─ Load configured allowed_tools: ["mcp__bash__*", "TodoWrite", ...]
  │
  ├─ For each tool in the list:
  │     if policy_evaluator.is_denied(tool) → remove from list
  │
  └─ Pass filtered allowed_tools to ClaudeAgentOptions
```

This means even if a user configures a broad `allowed_tools` bypass, DENY policies still take effect.

---

## Files Reference

| File | Responsibility |
|---|---|
| `api/ai/policy_evaluator.py` | Core evaluation engine, cache, version check |
| `api/handlers/policy.go` | REST API handler (CRUD + version endpoint) |
| `api/services/policy.go` | Business logic and database queries |
| `api/internal/database/migrations/20260218100000_create_agent_policies.sql` | Table schema + version trigger |
| `api/ai/claude_agent_api_v1.py` | PolicyEvaluator integration in WebSocket session |
| `api/ai/authz/client.py` | Role resolution used by PolicyEvaluator |
