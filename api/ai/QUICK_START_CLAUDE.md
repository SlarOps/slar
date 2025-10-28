# Quick Start: Claude Agent SDK

Get started with Claude Agent SDK integration in 5 minutes!

## Prerequisites

- Python 3.11+
- ANTHROPIC_API_KEY from https://console.anthropic.com/

## Step 1: Install Dependencies

```bash
cd /Users/chonle/Documents/feee/slar-oss/api/ai

# Install Claude Agent SDK
pip install anthropic-agents==0.1.0

# Or install all dependencies
pip install -r requirements.txt
```

## Step 2: Set API Key

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key-here"

# Optional: Set default agent type
export DEFAULT_AGENT_TYPE="claude"
```

## Step 3: Test the Integration

```bash
# Run integration tests
python test_claude_integration.py

# Expected output:
# ✅ Settings test completed
# ✅ Approval translation test completed
# ✅ Claude Manager test completed
# ✅ Agent Router test completed
```

## Step 4: Use in Your Code

### Example 1: Simple Query

```python
import asyncio
from core.claude_manager import ClaudeAgentManager

async def main():
    manager = ClaudeAgentManager()

    async for output in manager.run_task(
        task="What are the top 3 causes of high latency in web applications?",
        session_id="demo_session"
    ):
        print(output.message)

    await manager.close()

asyncio.run(main())
```

### Example 2: With Approval System

```python
import asyncio
from core.claude_manager import ClaudeAgentManager
from core.sre_agent import create_rule_based_approval_func

async def main():
    # Create approval function
    approval_func = create_rule_based_approval_func(
        allow_read_only=True,      # Auto-approve get_*, list_*
        deny_destructive=True,     # Auto-deny delete_*, destroy_*
        deny_production=True,      # Auto-deny production operations
    )

    # Initialize with approval
    manager = ClaudeAgentManager(approval_func=approval_func)

    async for output in manager.run_task(
        task="Check the server status and suggest optimizations",
        session_id="incident_123"
    ):
        print(f"[{output.source}] {output.message}")

    await manager.close()

asyncio.run(main())
```

### Example 3: Using Agent Router

```python
import asyncio
from core import get_agent_router

async def main():
    router = get_agent_router()

    # Choose agent type dynamically
    agent_type = "claude"  # or "autogen"

    if agent_type == "claude":
        async for output in router.run_task_with_claude(
            task="Analyze this error log and suggest fixes",
            session_id="debug_session"
        ):
            print(output.message)
    else:
        # Use AutoGen for complex multi-agent tasks
        result = await router.run_task_with_autogen(
            task="Complex incident investigation",
            user_input_func=lambda p: input(p),
        )

    await router.close()

asyncio.run(main())
```

## Step 5: Run the Server

```bash
# Start the FastAPI server
python main.py

# Or with uvicorn (hot reload)
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

The server now supports both AutoGen and Claude SDK!

## WebSocket Endpoints

### Claude SDK WebSocket

```javascript
// Connect to Claude SDK
const ws = new WebSocket(
  `ws://localhost:8002/ws/chat/claude?token=${yourToken}`
);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.message);
};

// Send message
ws.send(JSON.stringify({
  message: "Help me investigate incident #456"
}));
```

### Auto-Routing WebSocket

```javascript
// Specify agent type in query params
const ws = new WebSocket(
  `ws://localhost:8002/ws/chat/auto?token=${yourToken}&agent_type=claude`
);
```

## Available Endpoints

| Endpoint | Agent | Description |
|----------|-------|-------------|
| `/ws/chat/queue` | AutoGen | Original AutoGen WebSocket |
| `/ws/chat/claude` | Claude | Claude SDK WebSocket |
| `/ws/chat/auto` | Both | Auto-routing based on query param |

## Configuration Options

### Environment Variables

```bash
# Required
export ANTHROPIC_API_KEY="sk-ant-..."

# Optional
export ANTHROPIC_MODEL="claude-sonnet-4-5-20250929"
export DEFAULT_AGENT_TYPE="claude"
```

### In Code

```python
from config import get_settings

settings = get_settings()
print(settings.anthropic_api_key)  # Check if set
print(settings.default_agent_type)  # autogen or claude
```

## Common Use Cases

### 1. Incident Response

```python
async def investigate_incident(incident_id: str):
    manager = ClaudeAgentManager(
        approval_func=create_rule_based_approval_func(
            allow_read_only=True,
            deny_destructive=True,
        )
    )

    task = f"""
    Investigate incident #{incident_id}:
    1. Retrieve incident details
    2. Analyze error logs
    3. Suggest remediation steps
    """

    async for output in manager.run_task(task, session_id=f"incident_{incident_id}"):
        # Stream results to user
        print(output.message)

    await manager.close()
```

### 2. Runbook Retrieval

```python
async def get_runbook(service: str, issue: str):
    manager = ClaudeAgentManager()

    task = f"Find runbooks for {service} related to {issue}"

    async for output in manager.run_task(task, session_id=f"runbook_{service}"):
        print(output.message)

    await manager.close()
```

### 3. Log Analysis

```python
async def analyze_logs(log_data: str):
    manager = ClaudeAgentManager(
        approval_func=create_rule_based_approval_func(allow_read_only=True)
    )

    task = f"""
    Analyze these logs and identify:
    - Error patterns
    - Performance bottlenecks
    - Potential root causes

    Logs:
    {log_data}
    """

    async for output in manager.run_task(task, session_id="log_analysis"):
        print(output.message)

    await manager.close()
```

## Troubleshooting

### Import Error: anthropic-agents

```bash
pip install anthropic-agents
```

### API Key Not Set

```bash
# Check current value
echo $ANTHROPIC_API_KEY

# Set if not configured
export ANTHROPIC_API_KEY="sk-ant-your-key"
```

### Module Not Found

```bash
# Ensure you're in the correct directory
cd /Users/chonle/Documents/feee/slar-oss/api/ai

# Run with Python path
PYTHONPATH=. python your_script.py
```

## Next Steps

1. **Read full documentation**: [CLAUDE_SDK_INTEGRATION.md](./CLAUDE_SDK_INTEGRATION.md)
2. **Explore approval system**: [TEST_APPROVAL_README.md](./TEST_APPROVAL_README.md)
3. **Check examples**: See `test_claude_integration.py` for more examples
4. **Review architecture**: [README.md](./README.md)

## Comparison: AutoGen vs Claude SDK

| When to Use AutoGen | When to Use Claude SDK |
|---------------------|------------------------|
| Multi-agent workflows | Single-agent tasks |
| Complex orchestration | Simple query-response |
| Multiple LLM providers | Claude-specific features |
| Existing codebase | New development |

## Getting Help

- **Documentation**: `/Users/chonle/Documents/feee/slar-oss/api/ai/CLAUDE_SDK_INTEGRATION.md`
- **Tests**: `python test_claude_integration.py`
- **Logs**: Check console output or log files
- **GitHub Issues**: https://github.com/slarops/slar/issues

---

**Ready to go!** 🚀

Start using Claude Agent SDK alongside your existing AutoGen implementation.
