# AI Agent Migration Guide: WebSocket → HTTP Streaming

## Overview

The AI Agent interface has been completely reimplemented to use **HTTP Streaming (Server-Sent Events)** instead of WebSocket, with no dependencies on autogen-specific types.

## What Changed

### Old Implementation (Removed)
- ❌ WebSocket-based communication
- ❌ Autogen-specific message types
- ❌ Complex connection management
- ❌ `useWebSocket` hook
- ❌ WebSocket proxy in backend

### New Implementation (Added)
- ✅ HTTP POST + Server-Sent Events (SSE)
- ✅ Clean TypeScript types (`@/types/claude-agent.ts`)
- ✅ Session management with save/resume
- ✅ Simple HTTP API client
- ✅ Session sidebar with list/delete functionality
- ✅ Better error handling

## New Architecture

```
Frontend (Next.js)
    ↓ HTTP POST + SSE
Backend API (FastAPI - claude_agent_api.py)
    ↓
Claude Agent SDK
```

## Files Created

### Types
- `web/slar/src/types/claude-agent.ts` - TypeScript types

### Services
- `web/slar/src/services/claude-agent.ts` - API client with streaming support

### Hooks
- `web/slar/src/hooks/useClaudeChat.ts` - Main chat hook
- `web/slar/src/hooks/useSessionManager.ts` - Session management hook

### Components
- `web/slar/src/components/claude-agent/ChatContainer.tsx` - Main chat UI
- `web/slar/src/components/claude-agent/ChatMessage.tsx` - Message display
- `web/slar/src/components/claude-agent/SessionSidebar.tsx` - Session list
- `web/slar/src/components/claude-agent/index.ts` - Exports

### Pages
- `web/slar/src/app/ai-agent/page.tsx` - New main page (replaces page.js)
- `web/slar/src/app/ai-agent/README.md` - Documentation

## Files Modified

- `web/slar/tsconfig.json` - Added path aliases
- `web/slar/.env.example` - Updated AI API URL
- `web/slar/package.json` - Added uuid dependency

## API Endpoints Used

### Backend (`http://localhost:8002`)

```
POST   /api/chat/stream              - Stream chat (SSE)
POST   /api/chat                     - Non-streaming chat
GET    /api/sessions                 - List sessions
GET    /api/sessions/{session_id}    - Get session info
DELETE /api/sessions/{session_id}    - Delete session
POST   /api/sessions/{session_id}/fork - Fork session
GET    /api/health                   - Health check
```

## Environment Setup

### Frontend (.env.local)
```bash
NEXT_PUBLIC_AI_API_URL=http://localhost:8002
```

### Backend (api/ai/)
The backend API at `api/ai/claude_agent_api.py` is already implemented and ready to use.

## Running the New Implementation

### 1. Start Backend API
```bash
cd api/ai
python claude_agent_api.py
# Server runs on http://localhost:8002
```

### 2. Start Frontend
```bash
cd web/slar
npm install  # Install new dependencies (uuid)
npm run dev
# App runs on http://localhost:3000
```

### 3. Access AI Agent
Navigate to: `http://localhost:3000/ai-agent`

## Key Features

### Session Management
- **Auto-save**: Session ID saved to localStorage automatically
- **Resume**: Continue previous conversations on page reload
- **Switch**: Switch between sessions from sidebar
- **Delete**: Remove unwanted sessions

### Real-time Streaming
- Server-Sent Events for real-time response streaming
- Shows "Claude is typing..." indicator
- Stop button to cancel streaming
- Smooth message accumulation

### Message Types
- **User**: Your messages (blue icon)
- **Assistant**: Claude's responses (purple icon)
- **Error**: Error messages (red icon)
- **Thinking**: AI thinking process (future)

### Rich Content
- Full markdown support
- Syntax highlighting for code blocks (via react-syntax-highlighter)
- Auto-detection of programming languages
- Proper dark mode support

## Migration Notes

### For Developers

If you had custom code using the old WebSocket implementation:

**Old WebSocket Code:**
```jsx
const { wsConnection, connectionStatus } = useWebSocket(session, setMessages, setIsSending);
```

**New HTTP Streaming Code:**
```tsx
import { useClaudeChat } from '@/hooks/useClaudeChat';

const {
  messages,
  sessionId,
  isStreaming,
  connectionStatus,
  sendMessage,
  resetSession,
  loadSession,
} = useClaudeChat();

// Send message
await sendMessage("Hello Claude");
```

### Session Storage

**Old**: Session IDs were generated client-side and not persisted
**New**: Session IDs managed by backend, auto-saved to localStorage

### Message Format

**Old**: Autogen-specific message types
```js
{
  source: "assistant",
  content: { content: "..." },
  type: "agent_message"
}
```

**New**: Simple, clean TypeScript types
```ts
interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'error' | 'thinking';
  content: string;
  timestamp: number;
  raw?: string;
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
- Check browser console for errors

### Streaming not working
- Verify backend is running on correct port
- Check CORS settings in backend (already configured)
- Look for network errors in browser DevTools

### Build errors
```bash
cd web/slar
rm -rf .next node_modules
npm install
npm run build
```

## Benefits of New Implementation

1. **Simpler**: No complex WebSocket connection management
2. **Standard**: Uses standard HTTP + SSE (widely supported)
3. **Reliable**: Better error handling and recovery
4. **Debuggable**: Easy to debug with browser DevTools
5. **Session-aware**: Built-in session management
6. **Type-safe**: Clean TypeScript types throughout
7. **Testable**: Easier to test with standard HTTP mocks

## Next Steps

- [ ] Test all functionality thoroughly
- [ ] Add integration tests
- [ ] Add tool approval UI (future)
- [ ] Add file upload support (future)
- [ ] Add conversation search (future)
- [ ] Consider removing old WebSocket components (if fully migrated)

## Questions or Issues?

See documentation:
- Frontend: `web/slar/src/app/ai-agent/README.md`
- Backend API: `api/ai/claude_agent_api.py` (docstrings)
- Root docs: `CLAUDE.md` (project overview)
