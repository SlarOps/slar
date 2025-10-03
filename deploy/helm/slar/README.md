# SLAR Helm Chart

This Helm chart deploys the SLAR (Smart Live Alert & Response) application stack to Kubernetes, mirroring the architecture defined in `docker-compose.yaml`.

## Architecture

The chart deploys the following components:

### Services

1. **AI Service** (`ai`)
   - Port: 8002
   - Handles AI-related operations and WebSocket chat
   - Image: `ghcr.io/slarops/slar-ai`

2. **API Service** (`api`)
   - Port: 8080
   - Main backend API
   - Image: `ghcr.io/slarops/slar-api`

3. **Worker** (`worker`)
   - Background worker for processing tasks
   - Uses the same image as API with different command
   - Image: `ghcr.io/slarops/slar-api`

4. **Slack Worker** (`slack-worker`)
   - Handles Slack integration
   - Image: `ghcr.io/slarops/slar-slack-worker`

5. **Web Frontend** (`web`)
   - Port: 3000
   - Next.js frontend application
   - Image: `ghcr.io/slarops/slar-web`

6. **Kong API Gateway** (`kong`)
   - Ports: 8000 (HTTP), 8443 (HTTPS), 8001 (Admin)
   - Routes traffic to all services
   - Image: `kong:2.8.1`

## Installation

### Prerequisites

- Kubernetes cluster (1.19+)
- Helm 3.x
- kubectl configured to access your cluster

### Basic Installation

```bash
# Install with default values
helm install slar ./deploy/helm/slar

# Install with custom values
helm install slar ./deploy/helm/slar -f custom-values.yaml

# Install in a specific namespace
helm install slar ./deploy/helm/slar -n slar-system --create-namespace
```

### Configuration

Create a `custom-values.yaml` file to override default values:

```yaml
components:
  ai:
    env:
      - name: OPENAI_API_KEY
        value: "your-openai-api-key"
  
  api:
    env:
      - name: DATABASE_URL
        value: "postgres://user:pass@host:5432/db"
      - name: SUPABASE_URL
        value: "https://your-supabase-url.supabase.co"
      - name: SUPABASE_ANON_KEY
        value: "your-supabase-anon-key"
      - name: SUPABASE_JWT_SECRET
        value: "your-jwt-secret"
  
  slack-worker:
    env:
      - name: SLACK_BOT_TOKEN
        value: "xoxb-your-bot-token"
      - name: SLACK_APP_TOKEN
        value: "xapp-your-app-token"
  
  web:
    env:
      - name: NEXT_PUBLIC_SUPABASE_URL
        value: "https://your-supabase-url.supabase.co"
      - name: NEXT_PUBLIC_SUPABASE_ANON_KEY
        value: "your-supabase-anon-key"
  
  kong:
    service:
      type: LoadBalancer  # or NodePort for local clusters
```

### Using Secrets (Recommended)

For production, use Kubernetes secrets instead of plain text values:

```bash
# Create secrets
kubectl create secret generic slar-secrets \
  --from-literal=openai-api-key=your-key \
  --from-literal=database-url=your-db-url \
  --from-literal=supabase-anon-key=your-key \
  --from-literal=supabase-jwt-secret=your-secret \
  --from-literal=slack-bot-token=your-token \
  --from-literal=slack-app-token=your-token
```

Then reference them in your values:

```yaml
components:
  ai:
    env:
      - name: OPENAI_API_KEY
        valueFrom:
          secretKeyRef:
            name: slar-secrets
            key: openai-api-key
```

## Persistent Storage

The AI component requires persistent storage to preserve ChromaDB data, embedding models, and indexed documents across pod restarts. This is crucial for production deployments.

### Enabling Persistent Storage

```bash
# Install with persistent storage enabled
helm install slar . -f values-with-persistence.yaml

# Or enable via command line
helm install slar . \
  --set components.ai.persistence.enabled=true \
  --set components.ai.persistence.size=20Gi \
  --set components.ai.persistence.storageClass=gp2
```

### Storage Configuration Options

```yaml
components:
  ai:
    persistence:
      enabled: true
      storageClass: ""  # Use default storage class
      accessMode: ReadWriteOnce
      size: 10Gi  # Adjust based on your data needs
      mountPath: "/data"
```

### Storage Requirements

- **Minimum**: 5Gi for basic operation
- **Recommended**: 10-20Gi for production workloads
- **Large deployments**: 50Gi+ for extensive document indexing

The persistent volume stores:
- ChromaDB vector database files
- Downloaded embedding models (all-MiniLM-L6-v2, ~80MB)
- Indexed document chunks and metadata
- Application logs and state files

## Accessing the Application

### Via Kong Gateway (Recommended)

Once deployed, Kong acts as the main entry point:

```bash
# Get Kong service external IP/hostname
kubectl get svc -l app.kubernetes.io/component=kong

# Access the application
# Web UI: http://<KONG_IP>:8000/
# API: http://<KONG_IP>:8000/api/
# AI Service: http://<KONG_IP>:8000/ai/
# WebSocket: ws://<KONG_IP>:8000/ws/chat
```

### Port Forwarding (Development)

```bash
# Forward Kong proxy port
kubectl port-forward svc/slar-kong 8000:8000

# Access locally
# Web: http://localhost:8000/
# API: http://localhost:8000/api/
```

## Upgrading

```bash
# Upgrade with new values
helm upgrade slar ./deploy/helm/slar -f custom-values.yaml

# Upgrade with specific image tags
helm upgrade slar ./deploy/helm/slar \
  --set components.api.image.tag=v1.2.3 \
  --set components.web.image.tag=v1.2.3
```

## Uninstalling

```bash
helm uninstall slar
```

## Comparison with Docker Compose

This Helm chart mirrors the `docker-compose.yaml` structure:

| Docker Compose | Helm Chart | Notes |
|----------------|------------|-------|
| `services.ai` | `components.ai` | Same configuration |
| `services.api` | `components.api` | Same configuration |
| `services.worker` | `components.worker` | Same configuration |
| `services.slack-worker` | `components.slack-worker` | Same configuration |
| `services.web` | `components.web` | Same configuration |
| `services.kong` | `components.kong` | Kong config via ConfigMap |
| `networks.slar-network` | Kubernetes networking | Automatic service discovery |
| `volumes.api.kong.yaml` | ConfigMap | Kong declarative config |

## Advanced Configuration

### Enable Ingress for Web UI

```yaml
components:
  web:
    ingress:
      enabled: true
      className: nginx
      hosts:
        - host: slar.example.com
          paths:
            - path: /
              pathType: Prefix
      tls:
        - secretName: slar-tls
          hosts:
            - slar.example.com
```

### Resource Limits

```yaml
components:
  api:
    resources:
      limits:
        cpu: 1000m
        memory: 1Gi
      requests:
        cpu: 500m
        memory: 512Mi
```

### Autoscaling

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -l app.kubernetes.io/name=slar
```

### View Logs

```bash
# API logs
kubectl logs -l app.kubernetes.io/component=api

# Worker logs
kubectl logs -l app.kubernetes.io/component=worker

# Kong logs
kubectl logs -l app.kubernetes.io/component=kong
```

### Verify Kong Configuration

```bash
# Port forward to Kong admin API
kubectl port-forward svc/slar-kong 8001:8001

# Check Kong status
curl http://localhost:8001/status

# List configured services
curl http://localhost:8001/services
```

## Development

### Testing Locally with Minikube

```bash
# Start Minikube
minikube start

# Install the chart
helm install slar ./deploy/helm/slar

# Get Minikube IP
minikube service slar-kong --url

# Access the application
open $(minikube service slar-kong --url | head -n1)
```

### Debugging

```bash
# Dry run to see generated manifests
helm install slar ./deploy/helm/slar --dry-run --debug

# Template rendering
helm template slar ./deploy/helm/slar > rendered.yaml
```

## License

See the main project LICENSE file.

