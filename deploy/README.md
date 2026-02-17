# SLAR Deployment Guide

## Choose Your Setup

| Option | When to Use |
|--------|-------------|
| [Docker Compose](#docker-compose-local--staging) | Local development, small teams, quick start |
| [Kubernetes / Helm](#kubernetes--helm-production) | Production, high availability, scaling |

---

## Docker Compose (Local / Staging)

### What's included

| Service | Port | Description |
|---------|------|-------------|
| Kong | `8000` | API gateway — single entry point for everything |
| Web | `3001` | Next.js frontend |
| API | `8081` | Go backend |
| AI Agent | `8002` | Claude AI agent |
| Dex IDP | `5556` | Built-in OIDC provider (supports Google, GitHub, LDAP...) |
| PostgreSQL | `5432` | Database with PGMQ extension |

All traffic from the browser goes through Kong on port `8000`.

---

### Step 1 — Configure authentication

SLAR uses Dex as a built-in OIDC provider. You need to connect it to at least one identity source.

**Option A: Google OAuth (most common)**

1. Go to [Google Cloud Console → APIs & Credentials](https://console.cloud.google.com/apis/credentials)
2. Create **OAuth 2.0 Client ID** (Web application type)
3. Add redirect URI: `http://localhost:5556/dex/callback`
4. Copy Client ID and Client Secret

Edit `volumes/config/dex-config.yaml` — uncomment and fill in the Google connector:

```yaml
connectors:
  - type: google
    id: google
    name: Google
    config:
      clientID: YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
      clientSecret: YOUR_GOOGLE_CLIENT_SECRET
      redirectURI: http://localhost:5556/dex/callback
      # Optional: restrict to your company domain
      hostedDomains:
        - yourcompany.com
```

**Option B: GitHub OAuth**

1. Go to [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Create new OAuth App, set callback to: `http://localhost:5556/dex/callback`
3. Copy Client ID and Client Secret

```yaml
connectors:
  - type: github
    id: github
    name: GitHub
    config:
      clientID: YOUR_GITHUB_CLIENT_ID
      clientSecret: YOUR_GITHUB_CLIENT_SECRET
      redirectURI: http://localhost:5556/dex/callback
```

**Option C: External OIDC (Okta, Auth0, Keycloak...)**

Skip Dex entirely — set environment variables in `.env`:
```bash
OIDC_ISSUER=https://your-org.okta.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
```

---

### Step 2 — Create config file

Copy the example config:
```bash
cd deploy/docker
cp volumes/config/cfg.ex.yaml volumes/config/dev.config.yaml
```

Edit `volumes/config/dev.config.yaml` — at minimum set:
```yaml
anthropic_api_key: "sk-ant-..."  # Required for AI features
```

Everything else has working defaults for local development.

---

### Step 3 — Set environment variables

```bash
cd deploy/docker
cp .env.example .env
```

Edit `.env` — the only value you must change:
```bash
# Generate a random 32+ char secret:
openssl rand -base64 32

NEXTAUTH_SECRET=<paste-the-output-above>
```

If using Google/GitHub connectors, also set:
```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# or
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

---

### Step 4 — Start

```bash
cd deploy/docker
docker compose up -d
```

Check all services are healthy:
```bash
docker compose ps
```

Open **http://localhost:8000** → Sign in → Done.

---

### Troubleshooting Docker

**Services won't start:**
```bash
docker compose logs -f
```

**Dex fails to start — "no connectors configured":**
→ Make sure you uncommented at least one connector in `dex-config.yaml`

**Can't log in — redirect error:**
→ Verify the redirect URI in your OAuth app matches exactly:
`http://localhost:5556/dex/callback`

**AI agent not responding:**
→ Check `anthropic_api_key` is set in `dev.config.yaml`
→ Check agent logs: `docker compose logs -f ai`

**Database connection error:**
→ Wait 20-30 seconds for PostgreSQL to initialize on first start

---

## Kubernetes / Helm (Production)

### Prerequisites

- Kubernetes cluster (1.24+)
- `kubectl` configured for your cluster
- `helm` 3.x installed
- External PostgreSQL (recommended: [CloudNativePG](https://cloudnative-pg.io/) operator)
- A domain name with DNS configured

### Step 1 — Prepare secrets

Create a Kubernetes secret with your configuration:

```bash
kubectl create secret generic slar-config \
  --from-file=config.yaml=your-config.yaml
```

Your `config.yaml` should be based on `helm/slar/config.dev.yaml` (use as template).

### Step 2 — Configure values

```bash
cd deploy/helm/slar
cp config.dev.yaml config.local.yaml   # Your actual config (gitignored)
```

Edit `values.yaml` for your environment:
```yaml
image:
  repository: ghcr.io/slarops/
  tag: "latest"

# Enable Dex if not using external OIDC
dex:
  enabled: true
  config:
    issuer: "https://auth.your-domain.com/dex"
    connectors:
      google:
        enabled: true
        clientID: "YOUR_GOOGLE_CLIENT_ID"
        clientSecret: "YOUR_GOOGLE_CLIENT_SECRET"
```

### Step 3 — Install

```bash
helm install slar . -f values.yaml
```

Upgrade after changes:
```bash
helm upgrade slar . -f values.yaml
```

---

## Using the SLAR CLI

The `slar-cli` tool helps with building and deploying custom images.

```bash
cd deploy/slar-cli

# Build all services
./slar build

# Build and push to registry
./slar push --registry ghcr.io/your-org --tag v1.0.0

# Build specific services only
./slar push web api

# Run database migrations
./slar migrate
```

See [slar-cli/README.md](slar-cli/README.md) for full documentation.

---

## Directory Structure

```
deploy/
├── docker/                          # Docker Compose setup
│   ├── docker-compose.yaml          # Service definitions
│   ├── .env.example                 # Environment template (copy to .env)
│   └── volumes/
│       ├── api/kong.yaml            # Kong API gateway routing
│       └── config/
│           ├── cfg.ex.yaml          # Config template (copy to dev.config.yaml)
│           └── dex-config.yaml      # Dex IDP connector config
│
├── helm/slar/                       # Kubernetes Helm chart
│   ├── values.yaml                  # Default values (edit for your env)
│   ├── config.dev.yaml              # Config template (copy to config.local.yaml)
│   └── templates/                   # Kubernetes resource templates
│
└── slar-cli/                        # Build & deployment CLI tool
    └── README.md
```
