<p align="center">
  <img src="./images/banner.png" alt="SLAR Banner">
</p>

<h1 align="center">SLAR - Smart Live Alert & Response</h1>

<p align="center">
  <strong>Open-source on-call management with AI-powered incident response</strong>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-deployment">Deployment</a> •
  <a href="#-contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/go-%3E%3D1.24-00ADD8.svg" alt="Go Version">
  <img src="https://img.shields.io/badge/python-%3E%3D3.11-3776AB.svg" alt="Python Version">
  <img src="https://img.shields.io/badge/status-beta-yellow.svg" alt="Status">
</p>

---
<img width="1366" height="768" alt="Slar - AI Incident Management" src="https://github.com/user-attachments/assets/951dfd50-7038-4e7f-989a-e4574a96e4fc" />


## 🚀 Quick Start

Get SLAR running in 3 minutes:

### Prerequisites

- Docker & Docker Compose
- [Supabase](https://supabase.com) account (free tier works)
- Anthropic Claude API key (for AI features) - get from [console.anthropic.com](https://console.anthropic.com)

### 1. Clone & Configure

```bash
git clone https://github.com/slarops/slar.git
cd slar

# Copy and edit environment file
cp .env.example .env
# Edit .env with your credentials:
# - OPENAI_API_KEY: Your Anthropic Claude API key (starts with sk-ant-)
# - DATABASE_URL: Your Supabase PostgreSQL connection string
# - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET: From Supabase dashboard
# - SLACK_BOT_TOKEN, SLACK_APP_TOKEN (optional for Slack integration)
```

### 2. Launch

```bash
docker compose -f deploy/docker/docker-compose.yaml up -d
```

**Database migrations will run automatically before services start.**

**Access**: http://localhost:8000

---

## ✨ Features

### Core Capabilities

- **🔄 Flexible Scheduling** - On-call rotations with automated handoffs and override support
- **🤖 AI-Powered Response** - Claude-powered incident analysis with MCP tool integration for live data access
- **📊 Smart Routing** - Rule-based alert routing with priority and condition matching
- **⚡ Multi-Channel Alerts** - Slack, FCM push notifications, and email (Telegram coming soon)
- **👥 Team Management** - Multi-team support with RBAC and escalation policies
- **📈 Timeline Views** - Interactive schedule visualization with real-time updates
- **🔌 Extensible Tools** - MCP (Model Context Protocol) support for connecting AI to external tools and APIs

### Integrations

- **Alertmanager** - Prometheus alert ingestion
- **Datadog** - Webhook integration for monitors
- **Slack** - Native notifications and interactive workflows
- **Firebase** - Push notifications for mobile (coming soon)

---

## 🏗️ Tech Stack

### Backend
- **Go 1.24** - API server (Gin framework)
- **Python 3.11** - AI agent system (FastAPI + Claude SDK)
- **PostgreSQL** - Primary database (via Supabase)
- **PGMQ** - Message queue for async processing
- **Redis** - Caching layer

### Frontend
- **Next.js 15** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **xterm.js** - Terminal interface for AI agent

### AI & ML
- **Claude (Anthropic)** - AI for intelligent incident response and analysis
- **Claude Agent SDK** - Anthropic's SDK for conversational AI with tool use and MCP support
- **MCP (Model Context Protocol)** - Protocol for connecting AI agents to external tools and data sources

---

## 🏃 Development

### Backend (Go)

```bash
cd api

# Install dependencies
go mod download

# Run with hot reload
air

# Or run directly
go run cmd/server/main.go

# Run tests
go test ./...
```

**API**: http://localhost:8080

### AI Agent (Python)

```bash
cd api/ai

# Setup virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables (or add to .env)
export OPENAI_API_KEY="sk-ant-..."  # Anthropic API key
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SUPABASE_JWT_SECRET="your-jwt-secret"

# Run service
python claude_agent_api_v1.py
```

**API**: http://localhost:8002
**WebSocket**: ws://localhost:8002/ws/chat

### Frontend (Next.js)

```bash
cd web/slar

# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build
```

**App**: http://localhost:3000

### Workers

```bash
# Go worker (escalation)
cd api
go run cmd/worker/main.go

# Python Slack worker
cd api/workers
pip install -r requirements.txt
python slack_worker.py
```

---

## 📐 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         SLAR Platform                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐     ┌──────────────┐  │
│  │   Next.js    │──────│   Go API     │─────│  PostgreSQL  │  │
│  │   Frontend   │      │   (Gin)      │     │  (Supabase)  │  │
│  └──────────────┘      └──────┬───────┘     └──────────────┘  │
│         │                     │                                 │
│         │                     │                                 │
│         │              ┌──────┴───────┐                        │
│         │              │              │                         │
│         │        ┌─────▼─────┐  ┌────▼─────┐                  │
│         │        │    PGMQ   │  │  Redis   │                  │
│         │        │   Queue   │  │  Cache   │                  │
│         │        └─────┬─────┘  └──────────┘                  │
│         │              │                                        │
│         │        ┌─────▼─────────────┐                        │
│         │        │                    │                        │
│  ┌──────▼────────▼─────┐      ┌──────▼──────┐                │
│  │   Python AI Agent   │      │  Go Workers │                 │
│  │ (FastAPI/Claude SDK)│      │  (Escalation)│                │
│  └─────────────────────┘      └─────────────┘                 │
│         │                             │                         │
│         │                             │                         │
│  ┌──────▼─────────────────────────────▼─────────────────────┐ │
│  │              External Integrations                        │ │
│  │  Slack │ FCM │ Alertmanager │ Datadog │ Anthropic       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Overview

| Component | Purpose | Technology |
|-----------|---------|------------|
| **Frontend** | User interface with terminal for AI chat | Next.js 15, React 19, TypeScript, Tailwind CSS, xterm.js |
| **API Server** | REST API & business logic | Go (Gin), PostgreSQL, Supabase Auth |
| **AI Agent** | AI-powered incident response with MCP tools | Python (FastAPI, Claude Agent SDK, MCP) |
| **Workers** | Async task processing | Go (escalation) & Python (Slack notifications) |
| **Database** | Data persistence & message queue | PostgreSQL with PGMQ extension (Supabase) |
| **Queue** | Message broker for workers | PGMQ (PostgreSQL-based queue) |
| **Cache** | Performance optimization (optional) | Redis |

### Key Communication Patterns

- **Frontend ↔ Go API**: REST API calls to `/api/*` endpoints with JWT authentication
- **Frontend ↔ AI Agent**: WebSocket connection at `/ws/chat` for real-time AI interaction
- **AI Agent ↔ MCP Servers**: Local MCP server connections for tool integration (Datadog, incident management, etc.)
- **Workers ↔ Database**: PGMQ consumers polling for async jobs (escalations, notifications)
- **Go API ↔ External Services**: Webhook receivers for Alertmanager, Datadog, Slack

---

## 🚀 Deployment

### Docker Compose (Recommended for local/staging)

```bash
# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Build and start all services (migrations run automatically)
docker compose -f deploy/docker/docker-compose.yaml up -d

# View logs
docker compose -f deploy/docker/docker-compose.yaml logs -f

# View migration logs
docker compose -f deploy/docker/docker-compose.yaml logs migration

# Stop services
docker compose -f deploy/docker/docker-compose.yaml down
```

**Note**: Database migrations are applied automatically before services start. No manual Supabase CLI setup required.

**Services**:
- **Web**: http://localhost:8000
- **API**: http://localhost:8000/api
- **AI Agent**: http://localhost:8002

### Kubernetes (Production)

```bash
# Create secrets
kubectl create secret generic slar-secrets \
  --from-literal=openai-api-key=sk-ant-xxx \
  --from-literal=database-url=postgresql://... \
  --from-literal=supabase-url=https://xxx.supabase.co \
  --from-literal=supabase-anon-key=xxx \
  --from-literal=supabase-service-role-key=xxx \
  --from-literal=supabase-jwt-secret=xxx \
  --from-literal=slack-bot-token=xoxb-xxx \
  --from-literal=slack-app-token=xapp-xxx

# Install with Helm (migrations run automatically via pre-install hook)
cd deploy/helm/slar
helm install slar . -f values.yaml

# Upgrade (migrations run automatically via pre-upgrade hook)
helm upgrade slar .

# Uninstall
helm uninstall slar
```

**Note**: Database migrations are applied automatically before install/upgrade via Kubernetes Jobs with Helm hooks.

**Note**: Check [deploy/helm/slar/](deploy/helm/slar/) directory for Helm chart values and configuration options.

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Guide

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Follow** coding standards:
   - Go: `go fmt`, follow Go conventions
   - Python: PEP 8, type hints required
   - TypeScript: ESLint + Prettier
4. **Write** tests for new features
5. **Commit** with [conventional commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation
   - `test:` - Tests
6. **Push** and create a Pull Request

### Development Setup

See [CLAUDE.md](CLAUDE.md) for comprehensive development guide including:
- Project structure
- Development workflow
- Testing strategies
- AI agent development

---

## 📚 Documentation

- **[CLAUDE.md](CLAUDE.md)** - Comprehensive development guide with commands, architecture, and troubleshooting
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines and development standards
- **[.env.example](.env.example)** - Environment variable reference and configuration

---

## 🔒 Security

### Reporting Vulnerabilities

**DO NOT** open public issues for security vulnerabilities.

Please report security issues to:
- Email: security@slar.dev
- GitHub Security Advisories (preferred)

### Security Features

- ✅ JWT signature verification (Supabase Auth)
- ✅ SQL injection prevention (parameterized queries)
- ✅ Rate limiting on AI agent endpoints
- ✅ CORS protection with configurable origins
- ✅ AI tool approval system for sensitive operations
- ✅ Error message sanitization to prevent information disclosure
- ✅ Secure credential management via environment variables

---

## 📝 License

Apache 2.0 License - see [LICENSE](LICENSE) file for details.

This means you can:
- ✅ Use commercially
- ✅ Modify
- ✅ Distribute
- ✅ Use privately

You must:
- 📄 Include license and copyright
- 📄 State changes made

---

## 🌟 Roadmap

- [ ] **Mobile App** - React Native app for iOS/Android
- [ ] **Telegram Integration** - Native bot and notifications
- [ ] **SSO Authentication** - SAML/OAuth support
- [ ] **Advanced Analytics** - Incident metrics and reporting
- [ ] **Webhook Builder** - Visual webhook configuration
- [ ] **Multi-region Support** - Global deployment options

---

## 💬 Community & Support

- **Issues**: [GitHub Issues](https://github.com/slarops/slar/issues)
- **Discussions**: [GitHub Discussions](https://github.com/slarops/slar/discussions)
- **Documentation**: [docs.slar.dev](https://docs.slar.dev) (coming soon)

---

## 🙏 Acknowledgments

Built with amazing open-source projects:
- [Supabase](https://supabase.com) - Database and authentication
- [Anthropic Claude](https://www.anthropic.com) - AI-powered incident response
- [Next.js](https://nextjs.org) - React framework
- [Gin](https://gin-gonic.com) - Go web framework

---

<p align="center">
  Made with ❤️ by the SLAR team
</p>

<p align="center">
  <a href="#-quick-start">Back to top</a>
</p>
