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

SLAR uses standard OIDC — bring your own provider, no bundled IDP required.

**Register a new OIDC application** with any provider below, then set the redirect URI to:
```
http://localhost:8000/api/auth/callback/oidc
```

| Provider | Sign-up / App creation |
|----------|------------------------|
| Cloudflare Access | [dash.cloudflare.com → Access → Applications](https://dash.cloudflare.com) |
| Google | [console.cloud.google.com → APIs & Credentials](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 Client ID |
| Zitadel | [zitadel.com](https://zitadel.com) → New Project → New Application |
| Auth0 | [manage.auth0.com](https://manage.auth0.com) → Applications → Create Application |
| Okta | [developer.okta.com](https://developer.okta.com) → Applications → Create App Integration |
| Keycloak | Admin console → Clients → Create |

Once you have the credentials, set them in `.env` (Step 3):
```bash
OIDC_ISSUER=https://your-provider.example.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret   # leave empty if using PKCE
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

Edit `.env` — fill in your OIDC credentials (from Step 1) and generate a secret:
```bash
OIDC_ISSUER=https://your-provider.example.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret

# Generate a random 32+ char secret:
NEXTAUTH_SECRET=$(openssl rand -base64 32)
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

**Can't log in — redirect error:**
→ Verify the redirect URI registered with your OIDC provider matches exactly:
`http://localhost:8000/api/auth/callback/oidc`

**Can't log in — OIDC discovery failed:**
→ Check `OIDC_ISSUER` in `.env` is correct and reachable from the container
→ Test: `curl ${OIDC_ISSUER}/.well-known/openid-configuration`

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
