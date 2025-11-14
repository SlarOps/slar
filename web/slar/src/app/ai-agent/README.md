# AI Agent - WebSocket Implementation

This is the AI Agent chat interface using **WebSocket** to connect to the Claude Agent API (`api/ai/claude_agent_api.py`), with support for real-time messaging, tool approval system, and session management.

## What Changed

### Network Layer
- ✅ **Added**: WebSocket connection with Claude Agent API (`useClaudeWebSocket` hook)
- ✅ **Features**: Heartbeat (ping/pong), tool approval system, session management, auto-reconnection

### Same UI Components
All existing UI components remain unchanged:
- `ChatHeader` - Connection status and controls
- `MessagesList` - Message display with markdown & syntax highlighting
- `MessageComponent` - Individual message rendering with tool calls, incidents, etc.
- `ChatInput` - Input field with attachments and session management
- `Badge` - Status and severity badges
- All existing utilities and helpers

## Architecture

```
Frontend (Next.js)
    ↓ WebSocket (ws://localhost:8002/ws/chat)
Backend API (FastAPI - claude_agent_api.py)
    ↓
Claude Agent SDK (with tool approval)
```

## Key Files

### New/Modified Files

1. **`hooks/useClaudeWebSocket.js`** (NEW)
   - WebSocket hook for Claude Agent API
   - Handles connection, heartbeat, messages, and tool approvals
   - Auto-reconnection with exponential backoff
   - Session management with localStorage

2. **`app/ai-agent/page.js`** (MODIFIED)
   - Changed from `useHttpStreamingChat` to `useClaudeWebSocket`
   - Same UI, same features, real-time WebSocket transport

3. **`components/ai-agent/ToolApprovalModal.jsx`** (EXISTING)
   - Modal for tool approval requests
   - Works with interactive approval mode

### Unchanged Components

All these remain the same:
- `components/ai-agent/MessageComponent.js`
- `components/ai-agent/MessagesList.js`
- `components/ai-agent/ChatHeader.js`
- `components/ai-agent/Badge.js`
- `components/ai-agent/utils.js`
- `components/ai-agent/hooks/useAttachedIncident.js`
- `components/ai-agent/hooks/useAutoScroll.js`

## API Backend

Backend API at `api/ai/claude_agent_api.py` provides:

- `WS /ws/chat` - WebSocket endpoint for real-time chat (Used by this implementation)
- `POST /api/chat` - Non-streaming chat endpoint
- `GET /api/sessions` - List all sessions
- `GET /api/sessions/{session_id}` - Get session info
- `DELETE /api/sessions/{session_id}` - Delete session
- `GET /api/health` - Health check

### WebSocket Message Types

**Client → Server:**
- `prompt` - Send user message
- `pong` - Heartbeat response
- `approval_response` - Tool approval/denial

**Server → Client:**
- `connected` - Connection established
- `ping` - Heartbeat ping
- `session_init` - Session initialized
- `processing` - Query started
- `thinking` - Agent thinking
- `text` - Text content (streaming)
- `tool_use` - Tool execution
- `tool_result` - Tool result
- `approval_request` - Tool approval needed
- `complete` - Query completed
- `error` - Error occurred

## Features (All Preserved)

✅ Real-time WebSocket communication
✅ Message streaming with markdown rendering
✅ Code syntax highlighting
✅ Tool approval system (interactive, rule-based, hybrid)
✅ Heartbeat (ping/pong) for connection health
✅ Auto-reconnection on disconnect
✅ Incident cards display
✅ Attached incident context
✅ Session management (auto-save/resume)
✅ Stop streaming button
✅ New session button

## Environment Variables

```bash
# WebSocket URL for Claude Agent API
NEXT_PUBLIC_AI_WS_URL=ws://localhost:8002/ws/chat

# For production (wss://)
NEXT_PUBLIC_AI_WS_URL=wss://your-domain.com/ws/chat
```

## Usage

The page works exactly the same as before from a user perspective:

1. **Start a conversation** - Type a message and press Enter
2. **Attach incidents** - Context is automatically included
3. **View tool calls** - See what tools the AI is using
4. **Stop streaming** - Click stop button to cancel
5. **New session** - Start fresh with new session button

## Development

```bash
# Start backend API
cd api/ai
python claude_agent_api.py

# Start frontend (in new terminal)
cd web/slar
npm run dev

# Open browser
open http://localhost:3000/ai-agent
```

## Migration Notes

### What Developers Need to Know

The change in `page.js`:

**Before (HTTP Streaming):**
```javascript
import { useHttpStreamingChat } from '../../hooks/useHttpStreamingChat';

const {
  messages,
  setMessages,
  connectionStatus,
  isSending,
  sendMessage,
  stopStreaming,
  sessionId,
  resetSession,
  pendingApproval,
  approveTool,
  denyTool,
} = useHttpStreamingChat();
```

**After (WebSocket):**
```javascript
import { useClaudeWebSocket } from '../../hooks/useClaudeWebSocket';

const {
  messages,
  setMessages,
  connectionStatus,
  isSending,
  sendMessage,
  stopStreaming,
  sessionId,
  resetSession,
  pendingApproval,
  approveTool,
  denyTool,
} = useClaudeWebSocket();
```

Everything else remains the same!

### Hook Interface

The `useClaudeWebSocket` hook provides:

```javascript
{
  messages,         // Array of message objects
  setMessages,      // Update messages
  connectionStatus, // 'connecting' | 'connected' | 'disconnected' | 'error'
  isSending,        // Boolean - is request in progress
  sendMessage,      // Function to send message (with options)
  stopStreaming,    // Function to stop streaming
  sessionId,        // Current session ID (or null)
  resetSession,     // Function to start new session
  pendingApproval,  // Pending tool approval request (or null)
  approveTool,      // Function to approve tool
  denyTool,         // Function to deny tool
  connect,          // Function to manually connect
  disconnect,       // Function to manually disconnect
}
```

### Send Message Options

```javascript
sendMessage(message, {
  forkSession: false,          // Create new session branch
  systemPrompt: "...",         // Custom system prompt
  permissionMode: "acceptEdits", // "acceptEdits" | "approveOnly" | "denyEdits"
  model: "sonnet",             // "sonnet" | "opus" | "haiku"
  allowedTools: ["Read", "Write", "Bash"], // Allowed tools (null = all)
  approvalMode: "hybrid",      // "none" | "interactive" | "rule_based" | "hybrid"
  approvalConfig: {            // Approval configuration
    timeout: 60,
    auto_approve_safe: true,
    always_deny_dangerous: true
  }
});
```

### Message Format

Messages maintain the same format as before:

```javascript
{
  role: 'user' | 'assistant',
  source: 'user' | 'assistant' | 'system',
  content: 'message content',
  type: 'TextMessageContentPartChunk' | 'ToolCallRequestEvent' | etc.,
  timestamp: 'ISO date string',
  isStreaming: true | false,
  incidents: [...],  // optional
  // ... other fields
}
```

## Troubleshooting

### Backend not responding
```bash
# Check backend is running
curl http://localhost:8002/api/health
# Should return: {"status": "healthy", "active_sessions": 0}
```

### Session not persisting
- Check browser's localStorage: `claude_session_id` key
- Ensure `NEXT_PUBLIC_AI_API_URL` is set correctly

### Streaming not working
- Verify backend is running on correct port (8002)
- Check browser DevTools Network tab for SSE connection
- Look for CORS errors (should be configured in backend)

### Build errors
```bash
cd web/slar
rm -rf .next node_modules
npm install
npm run build
```

## Benefits of WebSocket

1. **Real-time**: Bidirectional communication for instant updates
2. **Efficient**: Single persistent connection, less overhead
3. **Interactive**: Tool approval system with user confirmation
4. **Resilient**: Auto-reconnection with exponential backoff
5. **Heartbeat**: Connection health monitoring with ping/pong
6. **Stateful**: Session persistence across page reloads
7. **Same UX**: No changes to user experience

## Advanced Features

### Session Management

Sessions are automatically managed:
- **Auto-created**: First message creates a new session
- **Auto-saved**: Session ID saved to localStorage
- **Auto-resumed**: Continues previous session on reload
- **Manual reset**: "New Session" button starts fresh
- **Fork session**: Create new branch from existing session

### Tool Approval System

Three approval modes available:

1. **None** (`approval_mode: "none"`)
   - No approval required
   - All tools execute immediately

2. **Rule-based** (`approval_mode: "rule_based"`)
   - Auto-approve safe tools (Read, Glob, Grep)
   - Auto-deny dangerous tools (delete, destroy, etc.)
   - Configurable allow/deny lists

3. **Interactive** (`approval_mode: "interactive"`)
   - Ask user for every tool execution
   - Shows tool name and arguments
   - User approves or denies via modal

4. **Hybrid** (`approval_mode: "hybrid"`) - **Recommended**
   - Auto-approve safe tools
   - Auto-deny dangerous tools
   - Ask user for everything else
   - Best balance of security and UX

### Stop Streaming

Users can stop the AI response mid-stream:
```javascript
<button onClick={stopStreaming}>Stop</button>
```

This closes the WebSocket connection and reconnects automatically.

### Heartbeat Monitoring

Connection health is monitored via ping/pong:
- Server sends `ping` every 30 seconds
- Client responds with `pong`
- Timeout after 10 seconds triggers reconnection

## Future Enhancements

Possible improvements (not yet implemented):
- [ ] Session list sidebar (load previous sessions)
- [ ] Export conversation history
- [ ] Multi-model selection UI (sonnet/opus/haiku)
- [ ] Permission mode selector
- [ ] Approval mode selector in UI
- [ ] Tool execution history view
- [ ] Session sharing/collaboration
- [ ] Voice input support
- [ ] Message editing/regeneration
- [ ] Conversation branching/forking UI

## Questions?

See also:
- Backend API: `api/ai/claude_agent_api.py`
- Hook implementation: `hooks/useHttpStreamingChat.js`
- Project docs: Root `CLAUDE.md` and `MIGRATION_GUIDE.md`
