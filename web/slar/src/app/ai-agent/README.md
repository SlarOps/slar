# AI Agent - HTTP Streaming Implementation

This is the updated AI Agent chat interface using **HTTP Streaming (Server-Sent Events)** instead of WebSocket, while keeping the same UI components and user experience.

## What Changed

### Network Layer
- ❌ **Removed**: WebSocket connection (`useWebSocket` hook)
- ✅ **Added**: HTTP Streaming with Server-Sent Events (`useHttpStreamingChat` hook)

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
    ↓ HTTP POST + SSE
Backend API (FastAPI - claude_agent_api.py)
    ↓
Claude Agent SDK
```

## Key Files

### New/Modified Files

1. **`hooks/useHttpStreamingChat.js`** (NEW)
   - Replacement for `useWebSocket` hook
   - Same interface, different implementation
   - Uses HTTP streaming with SSE
   - Auto-saves session ID to localStorage

2. **`app/ai-agent/page.js`** (MODIFIED)
   - Changed from `useWebSocket` to `useHttpStreamingChat`
   - Same UI, same features, different transport

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

- `POST /api/chat/stream` - Streaming chat with SSE (Used by this implementation)
- `GET /api/sessions` - List all sessions
- `GET /api/sessions/{session_id}` - Get session info
- `DELETE /api/sessions/{session_id}` - Delete session
- `GET /api/health` - Health check

## Features (All Preserved)

✅ Same UI and UX as before
✅ Message streaming with markdown rendering
✅ Code syntax highlighting
✅ Tool call display (ToolCallRequestEvent, ToolCallExecutionEvent)
✅ Memory query display (MemoryQueryEvent)
✅ Incident cards display
✅ Attached incident context
✅ Session management (auto-save/resume)
✅ Stop streaming button
✅ New session button

## Environment Variables

```bash
NEXT_PUBLIC_AI_API_URL=http://localhost:8002
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

The **only** change in `page.js` is:

**Before (WebSocket):**
```javascript
import { useWebSocket } from '../../components/ai-agent';

const { wsConnection, connectionStatus } = useWebSocket(session, setMessages, setIsSending);
```

**After (HTTP Streaming):**
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
} = useHttpStreamingChat();
```

Everything else remains the same!

### Hook Interface

The `useHttpStreamingChat` hook provides the same interface as the old WebSocket hook:

```javascript
{
  messages,        // Array of message objects
  setMessages,     // Update messages
  connectionStatus,// 'connected' | 'disconnected' | 'error'
  isSending,       // Boolean - is request in progress
  sendMessage,     // Function to send message
  stopStreaming,   // Function to abort streaming
  sessionId,       // Current session ID (or null)
  resetSession,    // Function to start new session
}
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

## Benefits of HTTP Streaming

1. **Simpler**: No WebSocket connection management
2. **Standard**: Uses standard HTTP + SSE (widely supported)
3. **Reliable**: Better error handling and recovery
4. **Debuggable**: Easy to debug with browser DevTools
5. **Session-aware**: Built-in session management via API
6. **Same UX**: No changes to user experience

## Advanced Features

### Session Management

Sessions are automatically managed:
- **Auto-created**: First message creates a new session
- **Auto-saved**: Session ID saved to localStorage
- **Auto-resumed**: Continues previous session on reload
- **Manual reset**: "New Session" button starts fresh

### Stop Streaming

Users can stop the AI response mid-stream:
```javascript
<button onClick={stopStreaming}>Stop</button>
```

### Attached Incidents

Incidents can be attached for context:
```javascript
const { attachedIncident, setAttachedIncident } = useAttachedIncident();

// Incident context is automatically included in message
```

## Future Enhancements

Possible improvements (not yet implemented):
- [ ] Session list sidebar (load previous sessions)
- [ ] Export conversation history
- [ ] Multi-model selection UI
- [ ] Permission mode selection
- [ ] Show tool approval requests
- [ ] Session sharing
- [ ] Voice input support

## Questions?

See also:
- Backend API: `api/ai/claude_agent_api.py`
- Hook implementation: `hooks/useHttpStreamingChat.js`
- Project docs: Root `CLAUDE.md` and `MIGRATION_GUIDE.md`
