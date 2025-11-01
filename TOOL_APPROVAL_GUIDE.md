# Tool Approval System - Implementation Guide

## Overview

System cho phép user approve/deny các tool execution request từ Claude Agent trước khi chúng được thực thi. Sử dụng HTTP streaming + separate approval endpoint.

## Architecture Flow

```
1. Claude muốn gọi tool
   ↓
2. Backend phát hiện ToolUseBlock
   ↓
3. Backend gửi SSE event: tool_approval_request
   ↓
4. Backend PAUSE streaming (await approval)
   ↓
5. Frontend hiển thị modal cho user
   ↓
6. User click Approve/Deny
   ↓
7. Frontend POST /api/approvals/{approval_id}
   ↓
8. Backend RESUME streaming
   ↓
9. Tool được execute (nếu approved) hoặc skip (nếu denied)
```

## Backend Components

### 1. ApprovalManager (`api/ai/approval_manager.py`)

```python
class ApprovalManager:
    """Manages pending tool approvals"""

    async def request_approval(
        self,
        session_id: str,
        tool_name: str,
        tool_args: dict
    ) -> dict:
        """
        Request approval - BLOCKS until user responds
        Returns: {"approved": bool, "reason": str}
        Timeout: 5 minutes default
        """
```

**Key Features:**
- Thread-safe với asyncio
- Auto-timeout sau 5 phút (configurable)
- In-memory storage (có thể upgrade lên Redis)

### 2. Streaming với Approval (`claude_agent_api.py`)

```python
async def stream_agent_response(...):
    """Stream with tool approval support"""

    # When ToolUseBlock is detected:
    if isinstance(block, ToolUseBlock):
        # 1. Send approval request to frontend
        approval_data = {
            'type': 'tool_approval_request',
            'approval_id': uuid.uuid4(),
            'tool_name': block.name,
            'tool_args': block.input,
        }
        yield f"data: {json.dumps(approval_data)}\n\n"

        # 2. WAIT for approval (blocks here)
        result = await approval_manager.request_approval(...)

        # 3. Continue based on result
        if result['approved']:
            yield tool_use_event
        else:
            yield tool_denied_event
```

### 3. Approval API Endpoints

```python
# Submit approval decision
POST /api/approvals/{approval_id}
Body: {
    "approved": true,
    "reason": "User approved"
}

# Get approval info (optional)
GET /api/approvals/{approval_id}
```

## Frontend Components

### 1. Hook Enhancement (`useHttpStreamingChat.js`)

```javascript
const {
  pendingApproval,  // {approval_id, tool_name, tool_args}
  approveTool,      // (approvalId, reason) => Promise
  denyTool,         // (approvalId, reason) => Promise
} = useHttpStreamingChat();
```

**Event Handling:**
```javascript
// Receive approval request
if (event.type === 'tool_approval_request') {
  setPendingApproval({
    approval_id: event.approval_id,
    tool_name: event.tool_name,
    tool_args: event.tool_args
  });
}
```

### 2. Approval Modal (`ToolApprovalModal.jsx`)

```jsx
<ToolApprovalModal
  isOpen={!!pendingApproval}
  toolName={pendingApproval.tool_name}
  toolArgs={pendingApproval.tool_args}
  onApprove={() => approveTool(approval_id, reason)}
  onDeny={() => denyTool(approval_id, reason)}
/>
```

**Features:**
- Hiển thị tool name
- Hiển thị arguments (JSON formatted)
- Approve/Deny buttons
- Cannot close without decision (modal blocking)

### 3. Page Integration (`app/ai-agent/page.js`)

```jsx
{pendingApproval && (
  <ToolApprovalModal
    isOpen={!!pendingApproval}
    onClose={() => {}}
    toolName={pendingApproval.tool_name}
    toolArgs={pendingApproval.tool_args}
    onApprove={() => approveTool(pendingApproval.approval_id, 'Approved by user')}
    onDeny={() => denyTool(pendingApproval.approval_id, 'Denied by user')}
  />
)}
```

## SSE Event Types

### New Events:

```javascript
// 1. Tool approval request (backend paused)
{
  type: 'tool_approval_request',
  approval_id: 'uuid',
  tool_name: 'read_file',
  tool_args: { path: '/etc/passwd' },
  session_id: 'session_123'
}

// 2. Tool approved and executing
{
  type: 'tool_use',
  tool_name: 'read_file',
  tool_args: { path: '/etc/passwd' }
}

// 3. Tool denied
{
  type: 'tool_denied',
  tool_name: 'read_file',
  reason: 'User denied'
}

// 4. Tool result (after execution)
{
  type: 'tool_result',
  content: '...'
}
```

## Configuration

### Backend (`claude_agent_api.py`)

```python
# Approval timeout
approval_manager = ApprovalManager(timeout_seconds=300)  # 5 minutes

# Enable can_use_tool in options
query_options = {
    "model": options.model,
    "can_use_tool": can_use_tool_callback,  # Enable approval
}
```

### Frontend (`.env.local`)

```bash
NEXT_PUBLIC_AI_API_URL=http://localhost:8002
```

## Security Considerations

### 1. Tool Whitelist/Blacklist

```python
# Example: Auto-approve safe tools
async def can_use_tool_callback(tool_name, tool_args, session_id):
    # Whitelist: Auto-approve read-only tools
    if tool_name in ['read_file', 'list_directory', 'grep']:
        return True

    # Blacklist: Auto-deny dangerous tools
    if tool_name in ['delete_file', 'execute_command']:
        return False

    # Ask user for everything else
    result = await approval_manager.request_approval(...)
    return result['approved']
```

### 2. Argument Validation

```python
# Example: Check file paths
if tool_name == 'read_file':
    path = tool_args.get('path', '')
    if path.startswith('/etc/') or path.startswith('/sys/'):
        return False  # Deny sensitive paths
```

### 3. User Context

```python
# Example: Check user permissions
async def can_use_tool_callback(tool_name, tool_args, session_id):
    user = get_user_from_session(session_id)

    if not user.can_use_tool(tool_name):
        return False

    # Continue with approval flow
```

## Advanced Features

### 1. Auto-approval Rules

```python
class ApprovalPolicy:
    """Define approval policies"""

    def should_auto_approve(self, tool_name, tool_args):
        # Auto-approve read operations
        if tool_name.startswith('read_') or tool_name.startswith('get_'):
            return True
        return False

    def should_auto_deny(self, tool_name, tool_args):
        # Auto-deny destructive operations
        if tool_name.startswith('delete_') or tool_name.startswith('destroy_'):
            return True
        return False
```

### 2. Approval History

```python
# Store approval history in DB
CREATE TABLE tool_approvals (
    id UUID PRIMARY KEY,
    session_id UUID,
    user_id UUID,
    tool_name VARCHAR(255),
    tool_args JSONB,
    approved BOOLEAN,
    reason TEXT,
    created_at TIMESTAMP
);
```

### 3. Bulk Approval

```javascript
// Frontend: "Approve All" for this session
const [autoApproveMode, setAutoApproveMode] = useState(false);

useEffect(() => {
  if (autoApproveMode && pendingApproval) {
    approveTool(pendingApproval.approval_id, 'Auto-approved');
  }
}, [autoApproveMode, pendingApproval]);
```

## Testing

### Backend Test

```bash
cd api/ai

# Start server
python claude_agent_api.py

# Test with curl (in another terminal)
curl -X POST http://localhost:8002/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Read the file /etc/hosts",
    "model": "sonnet"
  }'

# Should receive tool_approval_request event
# Then POST approval:
curl -X POST http://localhost:8002/api/approvals/{approval_id} \
  -H "Content-Type: application/json" \
  -d '{"approved": true, "reason": "Test approval"}'
```

### Frontend Test

```bash
cd web/slar
npm run dev

# Navigate to http://localhost:3000/ai-agent
# Send message: "Read file /etc/hosts"
# Should see approval modal pop up
```

## Troubleshooting

### Backend không pause khi có tool request

**Kiểm tra:**
- `can_use_tool` callback có được pass vào `query_options` không?
- `approval_manager` có được import đúng không?

### Frontend không hiển thị modal

**Kiểm tra:**
- `pendingApproval` state có được set không? (check console)
- Event type có đúng là `tool_approval_request` không?
- Modal component có được render không?

### Timeout sau 5 phút

**Solution:**
```python
# Increase timeout
approval_manager = ApprovalManager(timeout_seconds=600)  # 10 minutes
```

### Approval không hoạt động sau user respond

**Kiểm tra:**
- POST request có thành công không? (check network tab)
- `approval_id` có đúng không?
- Backend có log error không?

## Future Enhancements

- [ ] Redis-based approval manager (để scale horizontally)
- [ ] Approval policy configuration UI
- [ ] Approval history dashboard
- [ ] Notification system (email/Slack when approval needed)
- [ ] Mobile approval support
- [ ] Approval delegation (assign to another user)

## References

- Claude Agent SDK: https://docs.claude.com/en/api/agent-sdk
- Server-Sent Events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- AsyncIO: https://docs.python.org/3/library/asyncio.html
