# SLAR Kubernetes Architecture

## Overview

This document describes the Kubernetes architecture deployed by the SLAR Helm chart.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Traffic                             │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   LoadBalancer/Ingress │
                    │   (Kong API Gateway)   │
                    │   Ports: 8000, 8443    │
                    └────────────┬───────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 │               │               │
                 ▼               ▼               ▼
        ┌────────────┐  ┌────────────┐  ┌────────────┐
        │  Web (/)   │  │ API (/api) │  │ AI (/ai)   │
        │  Port 3000 │  │ Port 8080  │  │ Port 8002  │
        └────────────┘  └─────┬──────┘  └─────┬──────┘
                              │                │
                              │                │
                              ▼                ▼
                    ┌──────────────────────────────┐
                    │      Internal Services       │
                    │  - Worker (background)       │
                    │  - Slack Worker (background) │
                    └──────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   External Services    │
                    │   - PostgreSQL DB      │
                    │   - Supabase           │
                    │   - OpenAI API         │
                    │   - Slack API          │
                    └────────────────────────┘
```

## Components

### 1. Kong API Gateway

**Type:** LoadBalancer Service + Deployment
**Ports:**
- 8000 (HTTP Proxy)
- 8443 (HTTPS Proxy)
- 8001 (Admin API)

**Responsibilities:**
- Route external traffic to internal services
- CORS handling
- Request transformation
- WebSocket support
- Centralized access point

**Routes:**
- `/*` → Web Frontend
- `/api/*` → API Service
- `/ai/*` → AI Service
- `/ws/chat` → AI WebSocket

### 2. Web Frontend

**Type:** ClusterIP Service + Deployment
**Port:** 3000
**Technology:** Next.js

**Responsibilities:**
- User interface
- Client-side rendering
- Static asset serving

**Environment Variables:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. API Service

**Type:** ClusterIP Service + Deployment
**Port:** 8080
**Technology:** Go/Node.js (backend)

**Responsibilities:**
- Business logic
- Database operations
- Authentication/Authorization
- RESTful API endpoints

**Environment Variables:**
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`

### 4. AI Service

**Type:** ClusterIP Service + Deployment
**Port:** 8002
**Technology:** Python/FastAPI

**Responsibilities:**
- AI/ML processing
- OpenAI integration
- WebSocket chat server
- Real-time AI responses

**Environment Variables:**
- `ANTHROPIC_API_KEY`

### 5. Worker

**Type:** Deployment (no service)
**Technology:** Go/Node.js

**Responsibilities:**
- Background job processing
- Async task execution
- Queue management

**Environment Variables:**
- `DATABASE_URL`
- `POLL_INTERVAL`
- `BATCH_SIZE`
- `MAX_RETRIES`
- `LOG_LEVEL`

### 6. Slack Worker

**Type:** Deployment (no service)
**Technology:** Python/Go

**Responsibilities:**
- Slack event handling
- Slack bot operations
- Slack API integration
- Message processing

**Environment Variables:**
- `DATABASE_URL`
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `API_BASE_URL`

## Network Flow

### User Request Flow

```
User Browser
    │
    ▼
Kong Gateway (LoadBalancer)
    │
    ├─── / ──────────────────────▶ Web Service (3000)
    │
    ├─── /api/* ─────────────────▶ API Service (8080)
    │                                    │
    │                                    ├─▶ Database
    │                                    └─▶ Supabase
    │
    └─── /ai/* ──────────────────▶ AI Service (8002)
         /ws/chat                        │
                                         └─▶ OpenAI API
```

### Internal Communication

```
API Service ◀──────────▶ Database
     │
     ├──────────────────▶ Supabase
     │
     └──────────────────▶ Worker (via DB queue)

Worker ◀───────────────▶ Database

Slack Worker ◀─────────▶ Database
     │
     ├──────────────────▶ API Service (HTTP)
     │
     └──────────────────▶ Slack API

AI Service ◀───────────▶ OpenAI API
```

## Kubernetes Resources

### Per Component

Each component (except workers) creates:
- **Deployment:** Manages pod replicas
- **Service:** Internal networking (ClusterIP)
- **ConfigMap:** Configuration data (Kong only)

Workers create:
- **Deployment:** Manages pod replicas (no service needed)

### Shared Resources

- **ServiceAccount:** Kubernetes API access
- **HorizontalPodAutoscaler:** Auto-scaling (optional)
- **Ingress:** External access (optional, alternative to Kong)

## Resource Allocation

### Development (values-development.yaml)

| Component | Replicas | CPU Request | Memory Request | CPU Limit | Memory Limit |
|-----------|----------|-------------|----------------|-----------|--------------|
| AI | 1 | 100m | 128Mi | 500m | 512Mi |
| API | 1 | 100m | 128Mi | 500m | 512Mi |
| Worker | 1 | 100m | 128Mi | 500m | 512Mi |
| Slack Worker | 1 | 100m | 128Mi | 500m | 512Mi |
| Web | 1 | 100m | 128Mi | 500m | 512Mi |
| Kong | 1 | 100m | 128Mi | 500m | 512Mi |

**Total:** ~600m CPU, ~768Mi Memory

### Production (values-production.yaml)

| Component | Replicas | CPU Request | Memory Request | CPU Limit | Memory Limit |
|-----------|----------|-------------|----------------|-----------|--------------|
| AI | 2 | 500m | 512Mi | 1000m | 1Gi |
| API | 3 | 1000m | 1Gi | 2000m | 2Gi |
| Worker | 2 | 500m | 512Mi | 1000m | 1Gi |
| Slack Worker | 2 | 500m | 512Mi | 1000m | 1Gi |
| Web | 2 | 500m | 512Mi | 1000m | 1Gi |
| Kong | 2 | 1000m | 1Gi | 2000m | 2Gi |

**Total:** ~8000m CPU (8 cores), ~10Gi Memory

## High Availability Features

### Production Configuration

1. **Multiple Replicas**
   - Each service runs 2+ replicas
   - Distributes load across pods
   - Survives single pod failures

2. **Pod Anti-Affinity**
   - Spreads pods across different nodes
   - Prevents single point of failure
   - Improves resilience

3. **Horizontal Pod Autoscaling**
   - Automatically scales based on CPU/Memory
   - Min: 2 replicas
   - Max: 10 replicas
   - Target: 70% CPU utilization

4. **Pod Disruption Budget**
   - Ensures minimum availability during updates
   - Prevents all pods from being down simultaneously

5. **Health Checks**
   - Liveness probes: Restart unhealthy pods
   - Readiness probes: Remove unhealthy pods from service

## Security

### Network Security

- **ClusterIP Services:** Internal-only access
- **LoadBalancer:** Controlled external access via Kong
- **Network Policies:** (Optional) Restrict pod-to-pod communication

### Pod Security

- **Security Context:**
  - Run as non-root user (UID 1000)
  - Drop all capabilities
  - Read-only root filesystem (where possible)

- **Secrets Management:**
  - Kubernetes Secrets for sensitive data
  - Environment variable injection
  - No secrets in values files

### RBAC

- **ServiceAccount:** Dedicated service account per deployment
- **Minimal Permissions:** Only necessary API access

## Scaling Strategies

### Horizontal Scaling

```bash
# Manual scaling
kubectl scale deployment slar-api --replicas=5

# Auto-scaling (HPA)
# Configured in values-production.yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
```

### Vertical Scaling

```yaml
# Update resource limits in values file
components:
  api:
    resources:
      limits:
        cpu: 4000m
        memory: 4Gi
      requests:
        cpu: 2000m
        memory: 2Gi
```

## Monitoring & Observability

### Logs

```bash
# View logs by component
kubectl logs -l app.kubernetes.io/component=api -f

# View logs by pod
kubectl logs <pod-name> -f

# View logs from all containers
kubectl logs -l app.kubernetes.io/name=slar --all-containers=true
```

### Metrics

- CPU and Memory usage via Kubernetes metrics
- Custom application metrics (if implemented)
- Kong metrics via admin API

### Health Checks

- Liveness probes: `/health` endpoint
- Readiness probes: `/health` endpoint
- Startup probes: (Optional) for slow-starting apps

## Deployment Strategies

### Rolling Update (Default)

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

- Zero-downtime deployments
- Gradual rollout
- Automatic rollback on failure

### Blue-Green Deployment

```bash
# Deploy new version with different label
helm install slar-v2 ./slar --set version=v2

# Switch traffic
kubectl patch service slar-kong -p '{"spec":{"selector":{"version":"v2"}}}'

# Remove old version
helm uninstall slar-v1
```

## Disaster Recovery

### Backup

- Database backups (external)
- ConfigMaps and Secrets backup
- Helm values backup

### Recovery

```bash
# Restore from backup
kubectl apply -f backup/

# Reinstall chart
helm install slar ./slar -f backup/values.yaml

# Restore database
# (Database-specific commands)
```

## Performance Optimization

1. **Resource Tuning:** Adjust CPU/Memory based on actual usage
2. **Caching:** Implement Redis for API caching
3. **CDN:** Use CDN for static assets
4. **Database:** Connection pooling, read replicas
5. **Kong:** Enable caching plugins

## Troubleshooting

### Common Issues

1. **Pods CrashLooping**
   - Check logs: `kubectl logs <pod-name>`
   - Check events: `kubectl describe pod <pod-name>`
   - Verify environment variables and secrets

2. **Service Unreachable**
   - Check service: `kubectl get svc`
   - Check endpoints: `kubectl get endpoints`
   - Test from within cluster

3. **High Resource Usage**
   - Check metrics: `kubectl top pods`
   - Adjust resource limits
   - Enable autoscaling

## Best Practices

1. Use specific image tags in production
2. Store secrets in Kubernetes Secrets
3. Enable resource limits and requests
4. Configure health checks
5. Use multiple replicas for HA
6. Implement monitoring and alerting
7. Regular backups
8. Test disaster recovery procedures
9. Use namespaces for isolation
10. Implement network policies

## References

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [Kong Documentation](https://docs.konghq.com/)
- [SLAR Project Repository](https://github.com/slarops/slar)

