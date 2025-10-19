# Quick Start Guide

## 🚀 5-Minute Setup

### 1. Install Dependencies
```bash
cd api/ai
pip install -r requirements.txt
```

### 2. Set Environment Variables
```bash
export OPENAI_API_KEY="your-api-key-here"
# Optional: customize other settings
export PORT=8002
export ENABLE_KUBERNETES=false
```

### 3. Run the Application
```bash
python main.py
```

That's it! The API is now running at `http://localhost:8002`

## 📚 Quick Reference

### Import Patterns
```python
# Configuration
from config import get_settings
settings = get_settings()

# Core components
from core import SLARAgentManager, SessionManager, ToolManager

# Data models
from models import IncidentRunbookRequest, GitHubIndexRequest

# Utilities
from utils import generate_source_id, SimpleDocumentIndexer
```

### Common Tasks

#### Create an AI Agent
```python
from core import SLARAgentManager

manager = SLARAgentManager()
team = await manager.get_selector_group_chat(user_input_func)
result = await team.run(task="Your task here")
```

#### Manage Sessions
```python
from core import SessionManager

session_mgr = SessionManager()
session = await session_mgr.get_or_create_session("session-123")
await session_mgr.save_session(session)
```

#### Index Documents
```python
from utils import GitHubRepoIndexer
from core import SLARAgentManager

manager = SLARAgentManager()
indexer = GitHubRepoIndexer(manager.rag_memory)
await indexer.index_github_repo("https://github.com/user/repo")
```

## 🧪 Testing

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest --cov=. tests/

# Run specific test
pytest tests/test_config.py -v
```

## 🌐 API Endpoints

### Test Health
```bash
curl http://localhost:8002/health
```

### Create Session
```bash
curl -X POST http://localhost:8002/sessions
```

### WebSocket Chat
```javascript
const ws = new WebSocket('ws://localhost:8002/ws/session-id');
ws.onmessage = (event) => console.log(event.data);
ws.send(JSON.stringify({message: "Hello AI!"}));
```

## 📁 Project Structure

```
api/ai/
├── main.py          # Start here!
├── config/          # Settings
├── core/            # Business logic
├── models/          # Data models
├── routes/          # API endpoints
├── utils/           # Helpers
└── tests/           # Tests
```

## 🔧 Configuration

All configuration via environment variables:

```bash
# Required
OPENAI_API_KEY=sk-...

# Optional (with defaults)
PORT=8002
HOST=0.0.0.0
OPENAI_MODEL=gpt-4o
ENABLE_KUBERNETES=false
ENABLE_CODE_EXECUTOR=false
```

See [README.md](README.md) for full list.

## 📖 Documentation

- [README.md](README.md) - Complete documentation
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Migration from old structure
- [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md) - Refactoring overview

## 🆘 Troubleshooting

### Module not found
```bash
# Ensure you're in the right directory
cd api/ai
# Check Python path
python -c "import sys; print(sys.path)"
```

### ChromaDB errors
```bash
# Clear ChromaDB cache
rm -rf .chromadb_autogen
```

### OpenAI API errors
```bash
# Verify API key
echo $OPENAI_API_KEY
```

## 💡 Tips

1. **Use settings module** instead of `os.getenv()`
2. **Import from modules** not individual files
3. **Run tests** before committing
4. **Check logs** for debugging
5. **Read the docs** for details

## 🎯 Next Steps

1. ✅ Set up environment
2. ✅ Run the application
3. 📖 Read [README.md](README.md)
4. 🧪 Write tests for new features
5. 🚀 Deploy to production

Happy coding! 🎉
