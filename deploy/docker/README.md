# SLAR Docker Deployment

Docker Compose configuration for deploying SLAR stack locally or in production.

## Prerequisites

- Docker 20.10+
- Docker Compose v2+
- Node.js 18+ (for building Next.js locally)
- Environment variables configured in `.env` file at repository root

## Quick Start

```bash
cd deploy/docker

# View all commands
./dev.sh help

# Start locally
./dev.sh up

# View logs
./dev.sh logs

# Stop
./dev.sh down
```

## Available Commands

| Command | Description |
|---------|-------------|
| `./dev.sh up` | Start all services locally |
| `./dev.sh down` | Stop all services |
| `./dev.sh restart` | Restart all services |
| `./dev.sh logs [service]` | View logs (optionally specify service) |
| `./dev.sh build` | Build all Docker images |
| `./dev.sh push [registry]` | Build and push to registry |
| `./dev.sh deploy [registry]` | Build, push, and restart K8s |
| `./dev.sh status` | Show service status and health |
| `./dev.sh clean` | Clean up Docker resources |
| `./dev.sh help` | Show help message |

## Examples

### Local Development

```bash
# Start everything
./dev.sh up

# View all logs
./dev.sh logs

# View specific service logs
./dev.sh logs ai
./dev.sh logs api

# Check status
./dev.sh status

# Restart a service
docker compose restart ai

# Stop everything
./dev.sh down
```

### Production Deployment

```bash
# Deploy to default registry (ghcr.io/slarops)
./dev.sh deploy

# Deploy to custom registry
./dev.sh deploy ghcr.io/your-org

# Or set environment variable
REGISTRY=ghcr.io/your-org ./dev.sh deploy

# Just build without pushing
./dev.sh build

# Just push (assumes already built)
./dev.sh push ghcr.io/your-org
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| **web** | 3000 | Next.js frontend |
| **api** | 8080 | Go backend API |
| **ai** | 8002 | Python AI agent (FastAPI) |
| **slack-worker** | - | Slack message worker |
| **kong** | 8000, 8001, 8443 | API Gateway |

## Access URLs

After running `./dev.sh up`:

- **Frontend**: http://localhost:8000
- **API**: http://localhost:8000/api
- **AI Agent**: http://localhost:8002
- **Kong Admin**: http://localhost:8001

## Configuration

### Environment Setup

```bash
# Copy template
cp ../../.env.example ../../.env

# Edit with your values
vim ../../.env
```

**Required variables:**
```bash
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
SUPABASE_JWT_SECRET=...
ANTHROPIC_API_KEY=sk-...
```

See `.env.example` for complete list.

### Custom Registry/Tag

```bash
# Use environment variables
export REGISTRY=ghcr.io/your-org
export TAG=1.0.2
./dev.sh deploy

# Or inline
REGISTRY=ghcr.io/your-org TAG=1.0.2 ./dev.sh deploy
```

## Troubleshooting

### Exec format error in Kubernetes

**Error**: `exec /usr/local/bin/docker-entrypoint.sh: exec format error`

**Cause**: Image built for wrong platform or wrong line endings

**Solution**:
```bash
# Rebuild with correct platform (script handles this automatically)
./dev.sh deploy ghcr.io/your-org
```

The script automatically:
- Fixes line endings in shell scripts
- Builds for linux/amd64 platform
- Ensures compatibility across platforms

### Web service build fails

**Error**: `.next/standalone not found`

**Solution**: Script handles this automatically by building Next.js before Docker build

### Port conflicts

```bash
# Find what's using the port
lsof -i :8000

# Stop conflicting container
docker ps
docker stop <container-id>
```

### Database connection failed

```bash
# Check environment variables
cat ../../.env

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

## Advanced Usage

### Manual Docker commands

```bash
# View running containers
docker compose ps

# Execute command in container
docker compose exec ai bash
docker compose exec api sh

# View resource usage
docker stats

# Rebuild specific service
cd ../../web/slar && npm run build && cd ../../deploy/docker
docker compose build web
docker compose up -d web
```

### Health checks

```bash
# Automated (shows all services)
./dev.sh status

# Manual checks
curl http://localhost:8000              # Frontend
curl http://localhost:8000/api/health   # API
curl http://localhost:8002/health       # AI Agent

# Docker health status
docker compose ps
```

### Cleanup

```bash
# Remove unused resources (interactive)
./dev.sh clean

# Manual cleanup
docker image prune -a -f
docker volume prune -f
docker container prune -f
docker system prune -a --volumes
```

## Architecture

```
Browser → Kong Gateway (:8000)
            ├─→ Web (:3000) - Next.js frontend
            ├─→ API (:8080) - Go backend
            └─→ AI (:8002)  - Python FastAPI

API → Supabase (PostgreSQL)
     └─→ PGMQ → Slack Worker
```

## Platform Support

All images are built for **linux/amd64** by default to ensure compatibility across:
- Apple Silicon (M1/M2/M3) Macs
- Intel x86_64 machines
- Cloud Kubernetes clusters (AWS, GCP, Azure)

The `dev.sh` script handles cross-platform builds automatically using Docker BuildKit.

## Notes

### Why build Next.js locally?

The web service requires a local Next.js build before Docker build due to native dependencies (lightningcss, @tailwindcss/oxide) that don't work well in Docker multi-stage builds.

**Benefits:**
- ✅ Avoids native module issues
- ✅ Faster builds
- ✅ Smaller final image (~200MB)
- ✅ More reliable

The `dev.sh` script handles this automatically.

## Support

- Issues: https://github.com/slarops/slar/issues
- Root docs: [../../CLAUDE.md](../../CLAUDE.md)
- AI docs: [../../api/ai/CLAUDE.md](../../api/ai/CLAUDE.md)
