<p align="center">
  <img src="./images/banner.png" alt="SLAR Banner">
</p>

<h1 align="center">SLAR - Smart Live Alert & Response</h1>

<p align="center">
  <strong>Open-source on-call management with AI-powered incident response</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/status-beta-yellow.svg" alt="Status">
</p>

---

## 🚀 Deployment Guide

This guide focuses on deploying SLAR in your environment. For development instructions, please refer to [CLAUDE.md](CLAUDE.md).

### Prerequisites

1.  **Supabase Account**: You need a [Supabase](https://supabase.com) project for Database and Authentication.
2.  **Anthropic API Key**: Required for AI features. Get it from [console.anthropic.com](https://console.anthropic.com).
3.  **Infrastructure**:
    *   **Local/Staging**: Docker & Docker Compose
    *   **Production**: Kubernetes Cluster (v1.19+) & Helm 3

---

### 1. Environment Configuration

Regardless of your deployment method, you need to configure the following environment variables.

**Required Variables:**

| Variable | Description | Source |
|----------|-------------|--------|
| `DATABASE_URL` | PostgreSQL connection string | Supabase Settings → Database |
| `SUPABASE_URL` | Your Supabase project URL | Supabase Settings → API |
| `SUPABASE_ANON_KEY` | Public API key | Supabase Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Private Service Role key | Supabase Settings → API |
| `SUPABASE_JWT_SECRET` | JWT Secret for auth verification | Supabase Settings → API → JWT Settings |
| `ANTHROPIC_API_KEY` | Claude API Key | Anthropic Console |

**Optional Integration Variables:**

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack Bot Token (xoxb-...) |
| `SLACK_APP_TOKEN` | Slack App Token (xapp-...) |
| `SLAR_CLOUD_URL` | URL for SLAR Cloud sync |
| `SLAR_CLOUD_TOKEN` | Token for SLAR Cloud sync |

> **Important**: If your `DATABASE_URL` password contains special characters like `?`, `&`, `@`, you must URL-encode them (e.g., `?` → `%3F`).

### 2. Configuration via Config File (Advanced)

For more granular control, especially in production or when managing multiple services, you can use a `config.yaml` file instead of (or alongside) environment variables.

1.  Create a file named `config.yaml` (you can use `api/config.dev.yaml` as a template).
2.  Mount it to `/app/config/config.yaml` in your container.
3.  Set the `SLAR_CONFIG_PATH=/app/config/config.yaml` environment variable.

**Example `config.yaml` Structure:**

```yaml
# =============================================================================
# DATABASE & SERVER
# =============================================================================
database_url: "postgresql://user:pass@host:5432/db"
port: "8080"
redis_url: ""

# =============================================================================
# URL CONFIGURATION
# =============================================================================
# slar_api_url: internal API URL for AI agent tools
slar_api_url: "http://slar-api:8080"

# slar_web_url: internal frontend URL
slar_web_url: "http://slar-web:3000"

# public_url: external URL for mobile/clients
public_url: "https://api.your-domain.com"

# agent_url: AI Agent service URL
agent_url: "https://agent.your-domain.com"

# backend_url: Zero-Trust verifier URL
backend_url: "http://slar-api:8080"

data_dir: "./data"

# =============================================================================
# SUPABASE & AUTH
# =============================================================================
supabase_url: "https://your-project.supabase.co"
supabase_anon_key: "eyJ..."
supabase_service_role_key: "eyJ..."
supabase_jwt_secret: "your-secret..."

# =============================================================================
# NOTIFICATION GATEWAY (Cloudflare Worker)
# Optional: Only required for Mobile Push Notifications
# =============================================================================
notification_gateway:
  url: "https://your-worker.workers.dev"
  instance_id: "inst_..."
  api_token: "slar_tok_..."

# =============================================================================
# EXTERNAL INTEGRATIONS
# =============================================================================
anthropic_api_key: "sk-ant-..."
slack_bot_token: "xoxb-..."
slack_app_token: "xapp-..."
```

---

### 2. Docker Compose (Local / Staging)

The easiest way to get started. Migrations are applied automatically.

#### Step 1: Clone and Configure

```bash
git clone https://github.com/slarops/slar.git
cd slar

# Setup environment variables
cp deploy/docker/.env.example deploy/docker/.env
vim deploy/docker/.env
```

#### Step 2: Start Services

```bash
# Start all services
docker compose -f deploy/docker/docker-compose.yaml up -d
```

#### Step 3: Verify

```bash
# Check status
docker compose -f deploy/docker/docker-compose.yaml ps

# View migration logs (to ensure DB is ready)
docker compose -f deploy/docker/docker-compose.yaml logs -f migration
```

**Access Points:**
*   **Web Dashboard**: http://localhost:3000
*   **API**: http://localhost:8080
*   **AI Agent**: http://localhost:8002

---

### 3. Kubernetes (Production)

We provide a specialized Helm chart for production deployments.

#### Step 1: Create Secrets

Avoid putting sensitive data in `values.yaml`. Use Kubernetes Secrets:

```bash
kubectl create secret generic slar-secrets \
  --from-literal=anthropic-api-key=YourAnthropicKey \
  --from-literal=database-url=YourPostgresURL \
  --from-literal=supabase-url=https://your-project.supabase.co \
  --from-literal=supabase-anon-key=YourAnonKey \
  --from-literal=supabase-service-role-key=YourServiceRoleKey \
  --from-literal=supabase-jwt-secret=YourJWTSecret \
  --from-literal=slack-bot-token=xoxb-YourSlackBotToken \
  --from-literal=slack-app-token=xapp-YourSlackAppToken
```

#### Step 2: Deploy with Helm

```bash
# Navigate to chart directory
cd deploy/helm/slar

# Install the chart
helm install slar . -f values.yaml
```

*Migrations are automatically run via a pre-install/pre-upgrade hook.*

#### Step 3: Verify & Access

```bash
# Check pods
kubectl get pods -l app.kubernetes.io/name=slar

# Get Kong Gateway External IP
kubectl get svc -l app.kubernetes.io/component=kong
```

**Access Points (via Kong):**
*   **Web Dashboard**: `http://<KONG_IP>:8000/`
*   **API**: `http://<KONG_IP>:8000/api/`

For advanced configuration (Ingress, Persistent Storage, Resources), see [deploy/helm/slar/README.md](deploy/helm/slar/README.md).

---

### Troubleshooting

**Migration Failed?**
Check the migration container logs:
```bash
# Docker
docker compose -f deploy/docker/docker-compose.yaml logs migration

# Kubernetes
kubectl logs -l app.kubernetes.io/component=migration
```
*Common Cause*: Incorrect `DATABASE_URL` format. Ensure special characters in the password are URL-encoded.

**Application Errors?**
Ensure all environment variables are correctly set. Missing `SUPABASE_JWT_SECRET` will cause authentication failures.

---

## Community & Support

- **Issues**: [GitHub Issues](https://github.com/slarops/slar/issues)
- **Discussions**: [GitHub Discussions](https://github.com/slarops/slar/discussions)
- **Security**: Report vulnerabilities to `security@slar.dev`

---

## License

AGPLv3 License - see [LICENSE](LICENSE) for details.
