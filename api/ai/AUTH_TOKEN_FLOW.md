# Authentication Token Flow Implementation

## Overview

This document describes the implementation of authentication token passing from the frontend through WebSocket to the AI Agent backend, enabling MCP incident_tools to make authenticated API calls.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (web/slar/src/app/ai-agent/)                          │
│                                                                  │
│  1. AuthContext provides session with access_token              │
│  2. AIAgentPage extracts session.access_token                   │
│  3. useClaudeWebSocket hook receives token                      │
│  4. Token sent in WebSocket message                             │
└─────────────────────┬───────────────────────────────────────────┘
                      │ WebSocket /ws/chat
                      │ { prompt, session_id, auth_token }
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend (api/ai/claude_agent_api_v1.py)                        │
│                                                                  │
│  1. WebSocket handler receives auth_token                       │
│  2. Stores token in current_auth_token variable                 │
│  3. Calls set_auth_token() to update incident_tools             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      │ set_auth_token(token)
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  incident_tools.py                                              │
│                                                                  │
│  1. Stores token in module-level _dynamic_auth_token            │
│  2. get_auth_token() returns dynamic token or env fallback      │
│  3. All API calls use get_auth_token() in Authorization header  │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. Frontend Changes

#### web/slar/src/app/ai-agent/page.js
- Extract `access_token` from session
- Pass token to `useClaudeWebSocket` hook

```javascript
const authToken = session?.access_token || null;
const { messages, sendMessage, ... } = useClaudeWebSocket(authToken);
```

#### web/slar/src/hooks/useClaudeWebSocket.js
- Accept `authToken` parameter
- Store token in ref for WebSocket access
- Include token in WebSocket messages

```javascript
export function useClaudeWebSocket(authToken = null) {
  const authTokenRef = useRef(authToken);

  // Send with message
  const wsMessage = {
    prompt: message,
    session_id: sessionId || "",
    auth_token: authTokenRef.current || ""
  };
}
```

### 2. Backend Changes

#### api/ai/claude_agent_api_v1.py
- Receive `auth_token` from WebSocket message
- Store in connection-scoped variable
- Call `set_auth_token()` before processing each message

```python
# Get session id and auth token from data
session_id = data.get("session_id", "")
auth_token = data.get("auth_token", "")

# Update current auth token
if auth_token:
    current_auth_token = auth_token
    print(f"🔑 Auth token received (length: {len(auth_token)})")

# Set the auth token for incident_tools to use
set_auth_token(current_auth_token or "")
```

#### api/ai/incident_tools.py
- Add module-level `_dynamic_auth_token` variable
- Implement `set_auth_token()` to update token
- Implement `get_auth_token()` to retrieve token (with env fallback)
- Update all API calls to use `get_auth_token()`

```python
# Dynamic token storage
_dynamic_auth_token: Optional[str] = None

def set_auth_token(token: str) -> None:
    global _dynamic_auth_token
    _dynamic_auth_token = token

def get_auth_token() -> str:
    return _dynamic_auth_token or API_TOKEN

# In API calls
headers = {
    "Authorization": f"Bearer {get_auth_token()}",
    "Content-Type": "application/json"
}
```

## Security Considerations

1. **Token Transmission**: Token is sent over WebSocket connection (should be WSS in production)
2. **Token Storage**: Token stored in memory only, not persisted
3. **Token Scope**: Token is session-scoped and updated per message
4. **Fallback**: Environment variable `SLAR_API_TOKEN` used as fallback if no dynamic token
5. **Logging**: Token length logged but token value never logged directly

## Testing

### Manual Testing

1. **Start Backend**:
```bash
cd api/ai
export OPENAI_API_KEY="sk-..."
python claude_agent_api_v1.py
```

2. **Start Frontend**:
```bash
cd web/slar
npm run dev
```

3. **Test Flow**:
   - Login to get valid session token
   - Navigate to AI Agent page
   - Send a message that triggers incident_tools
   - Check backend logs for "🔑 Auth token received"
   - Verify API calls succeed with proper authentication

### Automated Testing

```bash
# Test token management functions
cd api/ai
python3 -c "
from incident_tools import set_auth_token, get_auth_token

test_token = 'test_jwt_token_abc123'
set_auth_token(test_token)
assert get_auth_token() == test_token
print('✅ Token management works')
"
```

## Troubleshooting

### Token Not Being Sent
- Check `session.access_token` is available in AuthContext
- Verify `authToken` is not null in AIAgentPage
- Check browser console for WebSocket messages

### Token Not Being Received
- Check backend logs for "🔑 Auth token received"
- Verify WebSocket message includes `auth_token` field
- Check data parsing in `websocket_chat` function

### API Calls Still Failing with 401
- Verify token is valid JWT from Supabase
- Check token expiration
- Ensure backend API is configured to accept Supabase tokens
- Verify `set_auth_token()` is called before tool execution

### Token Not Persisting Between Messages
- This is expected behavior - token is set per message
- Ensure frontend sends token with every WebSocket message
- Check `authTokenRef.current` is updated when session changes

## Future Improvements

1. **Token Refresh**: Implement automatic token refresh when expired
2. **Thread Safety**: Use `contextvars` for proper async context isolation
3. **Token Validation**: Validate token format before accepting
4. **Error Handling**: Better error messages when token is invalid
5. **Metrics**: Track token usage and expiration events
6. **Testing**: Add integration tests for full auth flow

## Related Files

- `web/slar/src/app/ai-agent/page.js` - AI agent page with token extraction
- `web/slar/src/hooks/useClaudeWebSocket.js` - WebSocket hook with token support
- `web/slar/src/contexts/AuthContext.js` - Authentication context provider
- `api/ai/claude_agent_api_v1.py` - WebSocket handler with token reception
- `api/ai/incident_tools.py` - MCP tools with dynamic token support

## References

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [JWT Authentication](https://jwt.io/introduction)
- [Claude Agent SDK](https://github.com/anthropics/anthropic-sdk-python)
