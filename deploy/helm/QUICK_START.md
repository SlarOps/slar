# SLAR Helm Quick Start Guide

## Prerequisites

```bash
# Check prerequisites
helm version    # Should be v3.x
kubectl version # Should be v1.19+
kubectl cluster-info # Verify cluster access
```

## 1. Quick Install (Development)

```bash
# Navigate to helm directory
cd deploy/helm

# Install with default development settings
helm install slar ./slar

# Or use the helper script
chmod +x install.sh
./install.sh -e development
```

## 2. Access the Application

```bash
# Option A: Port Forward (Recommended for local)
kubectl port-forward svc/slar-kong 8000:8000

# Then open in browser
open http://localhost:8000

# Option B: Get LoadBalancer IP (if using cloud)
kubectl get svc slar-kong
# Access via the EXTERNAL-IP shown
```

## 3. Check Status

```bash
# View all pods
kubectl get pods -l app.kubernetes.io/name=slar

# View all services
kubectl get svc -l app.kubernetes.io/name=slar

# View logs
kubectl logs -l app.kubernetes.io/component=api -f
kubectl logs -l app.kubernetes.io/component=web -f
```

## 4. Production Install

```bash
# Step 1: Create secrets
kubectl create secret generic slar-secrets \
  --from-literal=openai-api-key="sk-..." \
  --from-literal=database-url="postgres://..." \
  --from-literal=supabase-url="https://..." \
  --from-literal=supabase-anon-key="..." \
  --from-literal=supabase-jwt-secret="..." \
  --from-literal=slack-bot-token="xoxb-..." \
  --from-literal=slack-app-token="xapp-..." \
  --from-literal=dashboard-username="admin" \
  --from-literal=dashboard-password="secure-password"

# Step 2: Install with production values
helm install slar ./slar -f ./slar/values-production.yaml -n slar-prod --create-namespace

# Or use the helper script
./install.sh -e production -n slar-prod
```

## 5. Common Operations

### Upgrade

```bash
# Upgrade with new values
helm upgrade slar ./slar -f custom-values.yaml

# Upgrade with new image version
helm upgrade slar ./slar --set components.api.image.tag=v1.2.3
```

### Rollback

```bash
# View history
helm history slar

# Rollback to previous version
helm rollback slar

# Rollback to specific revision
helm rollback slar 2
```

### Uninstall

```bash
helm uninstall slar
```

### Scale

```bash
# Scale API service
kubectl scale deployment slar-api --replicas=5

# Or update values and upgrade
helm upgrade slar ./slar --set components.api.replicaCount=5
```

## 6. Troubleshooting

### Pods not starting

```bash
# Describe pod to see events
kubectl describe pod <pod-name>

# Check logs
kubectl logs <pod-name>

# Check events
kubectl get events --sort-by='.lastTimestamp'
```

### Can't access application

```bash
# Check services
kubectl get svc

# Check endpoints
kubectl get endpoints

# Test from within cluster
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- sh
curl http://slar-api:8080/health
```

### Kong issues

```bash
# Check Kong ConfigMap
kubectl get configmap slar-kong-config -o yaml

# Check Kong logs
kubectl logs -l app.kubernetes.io/component=kong

# Access Kong admin API
kubectl port-forward svc/slar-kong 8001:8001
curl http://localhost:8001/status
```

## 7. Customization

### Create custom values file

```yaml
# custom-values.yaml
components:
  api:
    image:
      tag: "v1.2.3"
    replicaCount: 3
    env:
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: my-secrets
            key: db-url
```

### Use custom values

```bash
helm install slar ./slar -f custom-values.yaml
```

## 8. Monitoring

### View all resources

```bash
kubectl get all -l app.kubernetes.io/name=slar
```

### Watch pod status

```bash
kubectl get pods -l app.kubernetes.io/name=slar -w
```

### Stream logs from all components

```bash
# API
kubectl logs -l app.kubernetes.io/component=api -f --tail=100

# Web
kubectl logs -l app.kubernetes.io/component=web -f --tail=100

# Worker
kubectl logs -l app.kubernetes.io/component=worker -f --tail=100

# All at once (requires stern or kubetail)
stern -l app.kubernetes.io/name=slar
```

## 9. Testing Locally

### With Minikube

```bash
# Start Minikube
minikube start

# Install chart
helm install slar ./slar -f ./slar/values-development.yaml

# Get service URL
minikube service slar-kong --url

# Access application
open $(minikube service slar-kong --url | head -n1)
```

### With Kind

```bash
# Create cluster
kind create cluster

# Install chart
helm install slar ./slar -f ./slar/values-development.yaml

# Port forward
kubectl port-forward svc/slar-kong 8000:8000

# Access
open http://localhost:8000
```

## 10. Endpoints

Once deployed, access these endpoints via Kong:

| Endpoint | URL | Description |
|----------|-----|-------------|
| Web UI | `http://<KONG_IP>:8000/` | Main web interface |
| API | `http://<KONG_IP>:8000/api/` | Backend API |
| AI Service | `http://<KONG_IP>:8000/ai/` | AI endpoints |
| WebSocket | `ws://<KONG_IP>:8000/ws/chat` | Chat WebSocket |
| Kong Admin | `http://<KONG_IP>:8001/` | Kong admin API |

## 11. Environment Variables

### Required Secrets

- `OPENAI_API_KEY` - OpenAI API key for AI service
- `DATABASE_URL` - PostgreSQL connection string
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_JWT_SECRET` - Supabase JWT secret
- `SLACK_BOT_TOKEN` - Slack bot token
- `SLACK_APP_TOKEN` - Slack app token

### Optional

- `DASHBOARD_USERNAME` - Kong dashboard username (default: admin)
- `DASHBOARD_PASSWORD` - Kong dashboard password (default: admin)

## 12. Next Steps

1. ✅ Install the chart
2. ✅ Verify all pods are running
3. ✅ Access the application via Kong
4. 📝 Configure your domain and TLS (production)
5. 📝 Set up monitoring and alerting
6. 📝 Configure backups
7. 📝 Set up CI/CD pipeline

## 13. Useful Commands Cheat Sheet

```bash
# Install
helm install slar ./slar

# Upgrade
helm upgrade slar ./slar

# Rollback
helm rollback slar

# Uninstall
helm uninstall slar

# Status
helm status slar

# Get values
helm get values slar

# Get manifest
helm get manifest slar

# Dry run
helm install slar ./slar --dry-run --debug

# Template
helm template slar ./slar > output.yaml

# Lint
helm lint ./slar

# List releases
helm list

# History
helm history slar
```

## 14. Support

- 📖 Full documentation: `deploy/helm/README.md`
- 🔄 Migration guide: `deploy/helm/MIGRATION.md`
- 📋 Chart README: `deploy/helm/slar/README.md`
- 🔍 Refactoring details: `deploy/helm/REFACTORING_SUMMARY.md`

## 15. Tips

- Always use `--dry-run --debug` to preview changes
- Use `helm diff` plugin to see what will change before upgrading
- Keep your values files in version control
- Use Kubernetes Secrets for sensitive data
- Test in development environment before production
- Monitor resource usage and adjust limits accordingly
- Enable autoscaling for production workloads

---

**Happy deploying! 🚀**

