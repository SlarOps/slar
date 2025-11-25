# Database Migration Guide

## Overview

SLAR uses automatic database migrations that run before deploying the application. The database schema is always automatically updated.

## How It Works

### Docker Compose

When running `docker compose up`:

1. **Migration service** starts first
2. Applies all SQL files from `supabase/migrations`
3. Exits with success status
4. Other services (api, ai, slack-worker) start afterwards

### Kubernetes/Helm

When running `helm install` or `helm upgrade`:

1. Migration job runs with `pre-install`/`pre-upgrade` hooks
2. Applies migrations
3. Job automatically cleans up after success
4. Application pods are created

## Viewing Logs

### Docker Compose
```bash
# View migration logs
docker compose -f deploy/docker/docker-compose.yaml logs migration

# Follow logs in real-time
docker compose -f deploy/docker/docker-compose.yaml logs -f migration
```

### Kubernetes
```bash
# List migration jobs
kubectl get jobs -l app.kubernetes.io/component=migration

# View logs
kubectl logs -l app.kubernetes.io/component=migration
```

## Environment Variables

Required for migration:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

## Creating New Migrations

```bash
# Create migration file
supabase migration new migration_name

# Edit file
vim supabase/migrations/YYYYMMDDHHMMSS_migration_name.sql

# Test locally
supabase db reset

# Commit and deploy - runs automatically!
git add supabase/migrations/
git commit -m "feat: add migration"
docker compose up -d
```

## Best Practices

### 1. Idempotent Migrations
```sql
-- Good
CREATE TABLE IF NOT EXISTS my_table (...);

-- Bad
CREATE TABLE my_table (...);
```

### 2. Backward Compatible
```sql
-- Good: Add column with default value
ALTER TABLE users ADD COLUMN phone VARCHAR(20) DEFAULT '';

-- Bad: Breaking change
ALTER TABLE users DROP COLUMN email;
```

## Troubleshooting

### Migration Failed
```bash
# View logs
docker compose logs migration

# Fix migration file
vim supabase/migrations/xxx.sql

# Retry
docker compose down
docker compose up -d
```

### Connection Refused
```bash
# Test database
psql "$DATABASE_URL" -c "SELECT version();"
```

## Disabling Migrations (if needed)

### Docker Compose
```bash
# Start without migration
docker compose up -d ai api web kong slack-worker
```

### Helm
```yaml
# values.yaml
migration:
  enabled: false
```

## Adding New Migrations

When you add a new migration file:

```bash
# Rebuild migration container to include new files
docker compose -f deploy/docker/docker-compose.yaml up -d --build migration

# Or rebuild all services
docker compose -f deploy/docker/docker-compose.yaml up -d --build
```

**Note**: The migration container needs to be rebuilt because migration files are copied into the Docker image during build time.

## Migration Idempotency

When running migrations multiple times:

- ✅ **First run**: Creates tables, indexes, columns
- ✅ **Second run**: Skips existing objects (no errors)
- ✅ **Safe**: Can run migrations repeatedly without breaking the database

Example output on second run:
```
NOTICE: relation "users" already exists, skipping
ERROR: column "email" of relation "users" already exists
```

These "errors" are **normal** and **safe** - they indicate the migration is idempotent and skipping already-applied changes.
