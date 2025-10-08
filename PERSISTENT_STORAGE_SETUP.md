# SLAR Persistent Storage Setup

This document outlines the changes made to support persistent storage for the AI component in both Docker Compose and Kubernetes (Helm) deployments.

## Problem Solved

The AI component uses ChromaDB for vector storage and downloads embedding models (all-MiniLM-L6-v2) during initialization. Without persistent storage:
- Models are re-downloaded on every container restart (~80MB download)
- Indexed documents and vector data are lost
- Chat functionality is unavailable until model download completes

## Changes Made

### 1. Docker Compose Updates

**File: `deploy/docker/docker-compose.yaml`**

Added volume mount and volume definition:

```yaml
services:
  ai:
    # ... existing configuration
    volumes:
      - slar-ai-data:/data
    # ... rest of config

volumes:
  slar-ai-data:
    driver: local
```

### 2. Helm Chart Updates

**Files Modified:**
- `deploy/helm/slar/values.yaml` - Added persistence configuration
- `deploy/helm/slar/templates/deployment.yaml` - Enhanced volume handling
- `deploy/helm/slar/templates/pvc.yaml` - New PVC template
- `deploy/helm/slar/README.md` - Added documentation

**Key Features:**
- Configurable persistent storage per component
- Dynamic PVC name generation
- Storage class and size configuration
- Proper volume mount handling

### 3. AI Application Updates

**File: `api/ai/main.py`**

Enhanced startup initialization:
- Added FastAPI lifespan events
- Pre-initialize ChromaDB during startup
- Trigger model download before accepting requests
- Added health check endpoint

## Usage

### Docker Compose

```bash
# Start with persistent storage
cd deploy/docker
docker-compose up -d

# Volume will be created automatically
docker volume ls | grep slar-ai-data
```

### Kubernetes/Helm

```bash
# Install with persistent storage
helm install slar . -f values-with-persistence.yaml

# Or configure inline
helm install slar . \
  --set components.ai.persistence.enabled=true \
  --set components.ai.persistence.size=20Gi
```

### Configuration Options

```yaml
components:
  ai:
    persistence:
      enabled: true
      storageClass: ""  # Use default or specify (e.g., "gp2", "standard")
      accessMode: ReadWriteOnce
      size: 10Gi  # Adjust based on needs
      mountPath: "/data"
```

## Storage Requirements

- **Minimum**: 5Gi for basic operation
- **Recommended**: 10-20Gi for production
- **Large deployments**: 50Gi+ for extensive document indexing

## What's Stored

The persistent volume contains:
- ChromaDB vector database files
- Downloaded embedding models (all-MiniLM-L6-v2, ~80MB)
- Indexed document chunks and metadata
- Application logs and state files
- JSON tracking of indexed sources

## Benefits

1. **Faster Startup**: No model re-download on restart
2. **Data Persistence**: Indexed documents survive pod restarts
3. **Better UX**: Chat functionality available immediately
4. **Cost Efficiency**: Reduced bandwidth usage
5. **Production Ready**: Suitable for production deployments

## Testing

### Docker Compose
```bash
# Test volume persistence
docker-compose up -d ai
docker-compose exec ai ls -la /data
docker-compose restart ai
docker-compose exec ai ls -la /data  # Data should persist
```

### Kubernetes
```bash
# Check PVC creation
kubectl get pvc

# Check volume mount
kubectl describe pod -l app.kubernetes.io/component=ai

# Test persistence
kubectl delete pod -l app.kubernetes.io/component=ai
# Pod will restart with data intact
```

## Troubleshooting

### Common Issues

1. **Storage Class Not Found**
   ```bash
   kubectl get storageclass
   # Use available storage class or set to ""
   ```

2. **Insufficient Permissions**
   ```bash
   # Check pod security context
   kubectl describe pod -l app.kubernetes.io/component=ai
   ```

3. **Volume Mount Failures**
   ```bash
   # Check PVC status
   kubectl get pvc
   kubectl describe pvc <pvc-name>
   ```

### Health Check

```bash
# Docker Compose
curl http://localhost:8002/health

# Kubernetes
kubectl port-forward svc/slar-ai 8002:8002
curl http://localhost:8002/health
```

Expected response:
```json
{
  "status": "healthy",
  "vector_store_ready": true,
  "timestamp": "2025-10-03T10:43:26.886546"
}
```
