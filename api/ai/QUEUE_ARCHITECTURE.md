# Queue-Based Architecture for AutoGen Agents

## Overview

This implementation follows **AutoGen's official patterns** for decoupling WebSocket connections from agent execution using `asyncio.Queue`. This architecture enables:

- ✅ **WebSocket Reconnection** - Users can disconnect/reconnect without losing session
- ✅ **Background Processing** - Agents continue working even if user closes tab
- ✅ **Clean Separation** - WebSocket layer is independent of agent layer
- ✅ **State Persistence** - Sessions saved to disk, messages buffered in queue
- ✅ **Future Scalability** - Easy migration to Redis/PGMQ/gRPC later

## Architecture

```
┌──────────┐         ┌───────────────┐         ┌──────────────┐
│  Browser │ ◄─────► │   WebSocket   │ ◄─────► │    Queue     │
└──────────┘         │   Handler     │         │   Manager    │
                     └───────────────┘         └──────────────┘
                                                      ▲ │
                                                      │ │
                                                      │ ▼
                                               ┌──────────────┐
                                               │    Agent     │
                                               │    Worker    │
                                               └──────────────┘
                                                      │
                                                      ▼
                                               ┌──────────────┐
                                               │   AutoGen    │
                                               │  Team/Agent  │
                                               └──────────────┘
```

## Components

### 1. Message Types (`core/messages.py`)

Defines message structures for communication:

```python
@dataclass
class UserInput:
    """User message to agent"""
    session_id: str
    content: str
    source: str = "user"

@dataclass
class AgentOutput:
    """Agent message to user"""
    session_id: str
    content: str
    source: str
    message_type: str
    metadata: Dict[str, Any] | None = None
```

### 2. Queue Manager (`core/queue_manager.py`)

**Based on AutoGen Pattern**: `ClosureAgent` with `asyncio.Queue` for collecting results

- Manages `asyncio.Queue` instances per session
- Input queue: WebSocket → Agent
- Output queue: Agent → WebSocket
- Follows AutoGen's publish/subscribe pattern

**Key Methods**:
- `publish_input()` - WebSocket publishes user messages
- `publish_output()` - Agent publishes responses
- `subscribe_input()` - Agent subscribes to user messages
- `subscribe_output()` - WebSocket subscribes to agent responses

**AutoGen Reference**:
```python
# From AutoGen docs: Using asyncio.Queue to collect agent results
queue = asyncio.Queue[TaskResponse]()

async def collect_result(_agent: ClosureContext, message: TaskResponse, ctx: MessageContext) -> None:
    await queue.put(message)
```

### 3. Agent Worker (`workers/agent_worker.py`)

**Based on AutoGen Pattern**: `SingleThreadedAgentRuntime` background processing

- Runs in background `asyncio.Task` (not separate process)
- Processes messages from input queue
- Publishes results to output queue
- Manages AutoGen team lifecycle
- Handles session state persistence

**Key Features**:
- `start_session_worker()` - Start background task for session
- `_process_session()` - Main processing loop
- Custom `_user_input()` function that reads from queue
- Streams agent outputs to queue following AutoGen pattern

**AutoGen Reference**:
```python
# From AutoGen docs: Background runtime processing
runtime = SingleThreadedAgentRuntime()
runtime.start()  # Processes messages in background
await runtime.publish_message(message, topic_id)
await runtime.stop_when_idle()
```

### 4. WebSocket Handler (`routes/websocket_queue.py`)

**New Endpoint**: `/ws/chat/queue`

- Accepts WebSocket connections
- Publishes user input to queue
- Subscribes to output queue
- Forwards agent messages to browser
- Handles disconnection gracefully

**Flow**:
1. User connects → Start agent worker if not running
2. User sends message → Publish to input queue
3. Background task subscribes to output queue → Forward to WebSocket
4. User disconnects → Agent continues processing
5. User reconnects → Receives buffered messages

## Usage

### For Frontend

Connect to new queue-based endpoint:

```javascript
// Old endpoint (direct connection)
const ws = new WebSocket('ws://localhost:8000/ws/chat?token=...');

// New endpoint (queue-based)
const ws = new WebSocket('ws://localhost:8000/ws/chat/queue?token=...');
```

**Benefits for Users**:
- Can refresh page without losing conversation
- Can close tab, agent keeps working
- Can reconnect and see all messages
- Better for long-running tasks

### Message Format

Same format as before:

```json
// Send to agent
{
  "content": "Hello, agent!",
  "source": "user",
  "type": "TextMessage"
}

// Receive from agent
{
  "type": "TextMessage",
  "content": "Hello! How can I help?",
  "source": "assistant"
}
```

## AutoGen Patterns Used

### 1. ClosureAgent Pattern
**Source**: `cookbook/extracting-results-with-an-agent.ipynb`

```python
# AutoGen official pattern
queue = asyncio.Queue[FinalResult]()

async def output_result(_agent: ClosureContext, message: FinalResult, ctx: MessageContext) -> None:
    await queue.put(message)

await ClosureAgent.register_closure(
    runtime, "output_result", output_result,
    subscriptions=lambda: [DefaultSubscription()]
)
```

**Our Implementation**:
```python
# In agent_worker.py
await self.queue_manager.publish_output(session_id, AgentOutput(...))
```

### 2. SingleThreadedAgentRuntime Background Processing
**Source**: `framework/agent-and-agent-runtime.ipynb`

```python
# AutoGen official pattern
runtime = SingleThreadedAgentRuntime()
runtime.start()  # Runs in background
await runtime.publish_message(message, topic_id)
await runtime.stop_when_idle()
```

**Our Implementation**:
```python
# In agent_worker.py
task = asyncio.create_task(self._process_session(session_id))
# Processes messages in background
```

### 3. Message Subscription Pattern
**Source**: `design-patterns/concurrent-agents.ipynb`

```python
# AutoGen official pattern
async for message in queue:
    # Process message
    pass
```

**Our Implementation**:
```python
# In queue_manager.py
async def subscribe_output(self, session_id: str):
    queue = self.get_output_queue(session_id)
    while True:
        message = await queue.get()
        yield message
```

## Migration Path

### Current: asyncio.Queue (In-Memory)
- ✅ Fast, simple, zero dependencies
- ⚠️ Single process only
- ⚠️ No persistence across restarts

### Future: PGMQ (PostgreSQL-based)
When you need:
- Multiple server instances
- Message persistence across restarts
- Higher reliability

**Easy Migration** - Change ONE class:

```python
# In main.py, replace:
queue_manager = SessionQueueManager()  # asyncio.Queue

# With:
queue_manager = PGMQSessionQueueManager()  # PostgreSQL

# All other code stays the same!
```

### Future: Redis Streams
For real-time, high-throughput scenarios:

```python
queue_manager = RedisSessionQueueManager()
```

### Future: gRPC (Distributed)
For multi-language, distributed systems:

```python
# Use AutoGen's GrpcWorkerAgentRuntime
from autogen_ext.runtimes.grpc import GrpcWorkerAgentRuntime
worker = GrpcWorkerAgentRuntime(host_address="localhost:50051")
```

## Benefits Over Direct Connection

| Feature | Direct Connection | Queue-Based |
|---------|------------------|-------------|
| Reconnection | ❌ Loses state | ✅ Preserves state |
| Background Tasks | ❌ Requires connection | ✅ Works without connection |
| Scalability | ❌ One process | ✅ Easy to scale |
| Message Buffer | ❌ None | ✅ Queue buffers |
| Complexity | ⭐ Simple | ⭐⭐ Moderate |

## Testing

### Test Reconnection
1. Connect to `/ws/chat/queue`
2. Send message
3. Disconnect WebSocket
4. Reconnect with same `session_id`
5. Should receive all buffered messages

### Test Background Processing
1. Send long-running task
2. Close browser tab
3. Open new tab, reconnect
4. Should see task completed

## References

All patterns based on official AutoGen documentation:

1. **ClosureAgent Pattern**:
   - https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/cookbook/extracting-results-with-an-agent.ipynb

2. **SingleThreadedAgentRuntime**:
   - https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/framework/agent-and-agent-runtime.ipynb

3. **Concurrent Agents**:
   - https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/design-patterns/concurrent-agents.ipynb

4. **Message Publishing**:
   - https://github.com/microsoft/autogen/blob/python-v0.7.4/python/docs/src/user-guide/core-user-guide/framework/message-and-communication.ipynb
