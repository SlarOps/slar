# SLAR CLI

A command-line tool for building and deploying SLAR services.

## Installation

### Build from source

```bash
cd deploy/slar-cli
go build -o slar .
```

### Add to PATH (optional)

```bash
# Linux/macOS
sudo mv slar /usr/local/bin/

# Or add to your shell profile
export PATH="$PATH:/path/to/slar-cli"
```

## Available Services

| Service | Description |
|---------|-------------|
| `web` | Next.js frontend application |
| `api` | Go API server |
| `ai` | Python AI agent service |
| `slack-worker` | Slack notification worker |

## Commands

### `build`

Build Docker images without pushing to registry.

```bash
slar build [services...] [flags]
```

**Flags:**
- `--registry` - Docker registry (default: `ghcr.io/slarops`)
- `--tag` - Image tag (default: `1.0.1`)

**Examples:**

```bash
# Build all services
slar build

# Build only AI service
slar build ai

# Build multiple specific services
slar build api ai

# Build with custom tag
slar build --tag=2.0.0 web api
```

### `push`

Build Docker images and push to registry.

```bash
slar push [services...] [flags]
```

**Flags:**
- `--registry` - Docker registry (default: `ghcr.io/slarops`)
- `--tag` - Image tag (default: `1.0.1`)

**Examples:**

```bash
# Build and push all services
slar push

# Build and push only AI service
slar push ai

# Build and push to custom registry
slar push --registry=myregistry.io/myorg --tag=2.0.0 api ai

# Push only web service with new tag
slar push --tag=1.2.0 web
```

## Workflow

The CLI performs the following steps:

### For `build`:
1. Check environment (.env file)
2. Fix line endings in scripts
3. Build Next.js (only if `web` is selected)
4. Build Docker images using docker-compose
5. Tag images with registry and version

### For `push`:
1. All steps from `build`
2. Push tagged images to registry

## Directory Structure

The CLI expects to be run from the `deploy/slar-cli` directory with the following structure:

```
slar-oss/
├── api/
│   └── ai/
│       └── docker-entrypoint.sh
├── web/
│   └── slar/
│       └── package.json
└── deploy/
    ├── docker/
    │   └── docker-compose.yaml
    └── slar-cli/
        ├── main.go
        ├── cmd/
        │   ├── root.go
        │   └── push.go
        └── slar (binary)
```

## Prerequisites

- Go 1.21+ (for building)
- Docker with Compose v2
- Node.js and npm (for web service)
- Access to target Docker registry (for push)

## Authentication

Before pushing to a registry, ensure you're authenticated:

```bash
# GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Docker Hub
docker login

# Custom registry
docker login myregistry.io
```

## Troubleshooting

### "Next.js build failed: .next/standalone not found"

Ensure your `next.config.js` has output set to standalone:

```js
module.exports = {
  output: 'standalone',
}
```

### "Unknown service" warning

Check that the service name matches one of: `web`, `api`, `ai`, `slack-worker`

### Docker build fails

1. Ensure Docker daemon is running
2. Check docker-compose.yaml exists in `deploy/docker/`
3. Verify sufficient disk space for images

## License

Part of the SLAR project.
