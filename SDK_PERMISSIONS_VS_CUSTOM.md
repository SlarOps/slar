# SDK Permissions vs Custom Approval System

## Comparison

### ✅ SDK Built-in Permissions (Recommended)

**Pros:**
- ✅ Native SDK support - ít bugs hơn
- ✅ Đơn giản hơn - SDK handle phần lớn logic
- ✅ Callbacks async/await built-in
- ✅ Behavior options: `allow`, `deny`, `ask`
- ✅ Không cần custom ToolUseBlock handling
- ✅ SDK tự động pause/resume execution
- ✅ Built-in với permission modes

**Cons:**
- ❌ Ít control hơn UI/UX của approval flow
- ❌ Cần integrate với SDK callbacks

**Use Cases:**
- Standard approval flows
- Rule-based permissions (whitelist/blacklist)
- Simple user prompts

### ❌ Custom Approval System

**Pros:**
- ✅ Full control UI/UX
- ✅ Custom approval modal design
- ✅ Advanced features (history, delegation, etc.)
- ✅ Can integrate with external systems

**Cons:**
- ❌ More complex implementation
- ❌ Manual pause/resume của stream
- ❌ Cần handle ToolUseBlock manually
- ❌ More maintenance
- ❌ Có thể có race conditions

**Use Cases:**
- Complex approval workflows
- Multi-step approvals
- External approval systems (Slack, email, etc.)

## Implementation: SDK Built-in Permissions

### Backend

```python
async def can_use_tool_callback(
    tool_name: str,
    input_args: dict,
    session_id: str
):
    """
    SDK canUseTool callback

    Returns:
        dict: {"behavior": "allow" | "deny" | "ask"}
    """
    # 1. Auto-approve safe tools
    safe_tools = ['Read', 'Glob', 'Grep']
    if tool_name in safe_tools:
        return {"behavior": "allow"}

    # 2. Auto-deny dangerous tools
    if tool_name == 'Bash':
        command = input_args.get('command', '')
        if any(d in command for d in ['rm -rf', 'sudo']):
            return {"behavior": "deny"}

    # 3. Ask user for approval
    result = await approval_manager.request_approval(
        session_id=session_id,
        tool_name=tool_name,
        tool_args=input_args
    )

    if result['approved']:
        return {"behavior": "allow"}
    else:
        return {"behavior": "deny", "message": result['reason']}


# Pass to SDK
async def stream_agent_response(...):
    async def can_use_tool(tool_name: str, input_args: dict):
        return await can_use_tool_callback(
            tool_name,
            input_args,
            current_session_id
        )

    options = ClaudeAgentOptions(
        can_use_tool=can_use_tool,
        permission_mode='default',  # or 'acceptEdits'
        ...
    )
```

### Permission Modes

```python
# 1. acceptEdits - Auto-approve file edits
options = ClaudeAgentOptions(
    permission_mode='acceptEdits'
)

# 2. bypassPermissions - No approval needed (dangerous!)
options = ClaudeAgentOptions(
    permission_mode='bypassPermissions'
)

# 3. default - Use can_use_tool callback
options = ClaudeAgentOptions(
    permission_mode='default',
    can_use_tool=can_use_tool_callback
)
```

### Behavior Options

```python
# Allow - Execute tool immediately
return {"behavior": "allow"}

# Deny - Block tool execution
return {"behavior": "deny"}

# Deny with custom message
return {
    "behavior": "deny",
    "message": "This tool is not allowed in production"
}

# Ask - Pause and show prompt to user (SDK handles this)
return {"behavior": "ask"}

# Ask with custom prompt
return {
    "behavior": "ask",
    "message": f"Allow {tool_name} to access {file_path}?"
}
```

## Advanced: Rule-Based Permissions

### 1. Whitelist/Blacklist

```python
class PermissionPolicy:
    """Permission policy with rules"""

    SAFE_TOOLS = {'Read', 'Glob', 'Grep', 'WebFetch'}
    DANGEROUS_TOOLS = {'KillShell', 'Bash'}

    SAFE_PATHS = {'/tmp/', '/var/log/'}
    DANGEROUS_PATHS = {'/etc/', '/sys/', '/proc/'}

    @classmethod
    async def check(cls, tool_name: str, input_args: dict) -> dict:
        # Whitelist
        if tool_name in cls.SAFE_TOOLS:
            return {"behavior": "allow"}

        # Blacklist
        if tool_name in cls.DANGEROUS_TOOLS:
            command = input_args.get('command', '')
            if any(d in command for d in ['rm', 'delete', 'sudo']):
                return {"behavior": "deny"}

        # Path-based rules for file operations
        if tool_name in {'Read', 'Write', 'Edit'}:
            path = input_args.get('file_path', '')

            # Deny dangerous paths
            if any(path.startswith(p) for p in cls.DANGEROUS_PATHS):
                return {
                    "behavior": "deny",
                    "message": f"Access to {path} is not allowed"
                }

            # Auto-approve safe paths
            if any(path.startswith(p) for p in cls.SAFE_PATHS):
                return {"behavior": "allow"}

        # Default: Ask user
        return {"behavior": "ask"}


# Use in callback
async def can_use_tool_callback(tool_name, input_args, session_id):
    result = await PermissionPolicy.check(tool_name, input_args)

    if result["behavior"] == "ask":
        # Request user approval via frontend
        approval = await approval_manager.request_approval(...)
        return {"behavior": "allow" if approval['approved'] else "deny"}

    return result
```

### 2. User-Based Permissions

```python
class UserPermissions:
    """Permission based on user role"""

    ROLE_PERMISSIONS = {
        'admin': {
            'allowed_tools': ['*'],  # All tools
            'denied_tools': [],
        },
        'developer': {
            'allowed_tools': ['Read', 'Write', 'Bash', 'Grep'],
            'denied_tools': ['KillShell'],
        },
        'viewer': {
            'allowed_tools': ['Read', 'Grep'],
            'denied_tools': ['Write', 'Edit', 'Bash'],
        }
    }

    @classmethod
    async def check(cls, user_role: str, tool_name: str) -> dict:
        perms = cls.ROLE_PERMISSIONS.get(user_role, {})

        # Check denied
        if tool_name in perms.get('denied_tools', []):
            return {
                "behavior": "deny",
                "message": f"Role '{user_role}' cannot use {tool_name}"
            }

        # Check allowed
        allowed = perms.get('allowed_tools', [])
        if '*' in allowed or tool_name in allowed:
            return {"behavior": "allow"}

        # Not in allowed list
        return {
            "behavior": "deny",
            "message": f"Tool '{tool_name}' not available for role '{user_role}'"
        }


# Use in callback
async def can_use_tool_callback(tool_name, input_args, session_id):
    user = await get_user_from_session(session_id)
    return await UserPermissions.check(user.role, tool_name)
```

### 3. Time-Based Permissions

```python
from datetime import datetime, time

class TimeBasedPermissions:
    """Restrict dangerous tools during business hours"""

    BUSINESS_HOURS = (time(9, 0), time(18, 0))  # 9am - 6pm
    RESTRICTED_TOOLS = {'Bash', 'KillShell', 'Edit'}

    @classmethod
    def is_business_hours(cls) -> bool:
        now = datetime.now().time()
        start, end = cls.BUSINESS_HOURS
        return start <= now <= end

    @classmethod
    async def check(cls, tool_name: str) -> dict:
        if tool_name in cls.RESTRICTED_TOOLS:
            if cls.is_business_hours():
                return {
                    "behavior": "ask",
                    "message": f"Executing {tool_name} during business hours requires approval"
                }

        return {"behavior": "allow"}
```

### 4. Rate Limiting

```python
from collections import defaultdict
from datetime import datetime, timedelta

class RateLimiter:
    """Limit tool usage per session"""

    def __init__(self):
        self.usage = defaultdict(list)  # session_id -> [timestamps]
        self.limits = {
            'Bash': (5, timedelta(minutes=10)),  # 5 times per 10 min
            'Write': (20, timedelta(minutes=10)),
        }

    async def check(self, session_id: str, tool_name: str) -> dict:
        if tool_name not in self.limits:
            return {"behavior": "allow"}

        max_count, time_window = self.limits[tool_name]
        now = datetime.now()

        # Get usage for this session
        usage = self.usage[f"{session_id}:{tool_name}"]

        # Remove old entries
        cutoff = now - time_window
        usage[:] = [t for t in usage if t > cutoff]

        # Check limit
        if len(usage) >= max_count:
            return {
                "behavior": "deny",
                "message": f"Rate limit exceeded for {tool_name}"
            }

        # Record usage
        usage.append(now)

        return {"behavior": "allow"}


rate_limiter = RateLimiter()

async def can_use_tool_callback(tool_name, input_args, session_id):
    return await rate_limiter.check(session_id, tool_name)
```

## Best Practices

### 1. Layered Permissions

Combine multiple checks:

```python
async def can_use_tool_callback(tool_name, input_args, session_id):
    # Layer 1: User role
    user = await get_user_from_session(session_id)
    result = await UserPermissions.check(user.role, tool_name)
    if result["behavior"] == "deny":
        return result

    # Layer 2: Policy rules
    result = await PermissionPolicy.check(tool_name, input_args)
    if result["behavior"] == "deny":
        return result

    # Layer 3: Rate limiting
    result = await rate_limiter.check(session_id, tool_name)
    if result["behavior"] == "deny":
        return result

    # Layer 4: Time-based
    result = await TimeBasedPermissions.check(tool_name)
    if result["behavior"] == "deny":
        return result

    # Layer 5: Ask user if all checks pass but tool is sensitive
    if tool_name in SENSITIVE_TOOLS:
        approval = await approval_manager.request_approval(...)
        return {"behavior": "allow" if approval['approved'] else "deny"}

    return {"behavior": "allow"}
```

### 2. Audit Logging

```python
async def can_use_tool_callback(tool_name, input_args, session_id):
    result = await permission_check(...)

    # Log all permission decisions
    await log_permission_decision(
        session_id=session_id,
        tool_name=tool_name,
        input_args=input_args,
        decision=result["behavior"],
        reason=result.get("message", ""),
        timestamp=datetime.now()
    )

    return result
```

### 3. Configuration

```yaml
# permissions.yaml
permission_mode: default

safe_tools:
  - Read
  - Glob
  - Grep
  - WebFetch

dangerous_tools:
  - KillShell
  - Bash

auto_approve_paths:
  - /tmp/
  - /var/log/

auto_deny_paths:
  - /etc/
  - /sys/
  - /root/

user_roles:
  admin:
    allow: ["*"]
  developer:
    allow: ["Read", "Write", "Bash", "Grep"]
    deny: ["KillShell"]
  viewer:
    allow: ["Read", "Grep"]
    deny: ["Write", "Edit", "Bash"]
```

## Recommendation

**Use SDK Built-in Permissions** với layered approach:

1. **permissionMode**: Set to `'default'`
2. **can_use_tool**: Implement với rules-based logic
3. **approval_manager**: Chỉ dùng khi cần user input
4. **Auto-approve**: Safe, read-only tools
5. **Auto-deny**: Dangerous operations
6. **Ask user**: Everything else

Đơn giản, an toàn, và dễ maintain!
