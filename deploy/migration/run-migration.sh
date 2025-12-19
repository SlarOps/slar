#!/bin/bash
set -e

echo "========================================="
echo "SLAR Database Migration Runner"
echo "========================================="

# Validate required environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable is required"
    exit 1
fi

if [ -z "$SUPABASE_URL" ]; then
    echo "ERROR: SUPABASE_URL environment variable is required"
    exit 1
fi

echo "[OK] Environment variables validated"

# Extract project reference from SUPABASE_URL
# Format: https://xxx.supabase.co -> xxx
PROJECT_REF=$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')

if [ -z "$PROJECT_REF" ]; then
    echo "WARNING: Could not extract project reference from SUPABASE_URL"
    echo "SUPABASE_URL: $SUPABASE_URL"
    # For self-hosted Supabase, we'll use the DATABASE_URL directly
    USE_DIRECT_DB=true
else
    echo "[OK] Project reference: $PROJECT_REF"
    USE_DIRECT_DB=false
fi

# Change to supabase directory
cd /app

# Count migration files
MIGRATION_COUNT=$(find supabase/migrations -name "*.sql" 2>/dev/null | wc -l || echo 0)
echo "Found $MIGRATION_COUNT migration files"

if [ "$MIGRATION_COUNT" -eq 0 ]; then
    echo "WARNING: No migration files found, skipping migration"
    exit 0
fi

# List migrations
echo ""
echo "Migration files:"
find supabase/migrations -name "*.sql" -type f | sort

echo ""
echo "Starting database migration..."
echo "----------------------------------------"

# Apply migrations using Supabase CLI
if [ "$USE_DIRECT_DB" = true ]; then
    # For self-hosted or custom DATABASE_URL, use db push with custom connection
    echo "Using direct database connection"
    export DB_URL="$DATABASE_URL"
    
    # Run migrations by applying SQL files directly
    echo "Applying migrations directly via psql..."
    
    for migration_file in $(find supabase/migrations -name "*.sql" -type f | sort); do
        echo "Applying: $(basename $migration_file)"
        psql "$DATABASE_URL" -f "$migration_file" || {
            echo "ERROR: Failed to apply migration: $migration_file"
            exit 1
        }
    done
else
    # For Supabase cloud, use the CLI
    echo "Using Supabase CLI"
    
    # Link to project (using project ref)
    supabase link --project-ref "$PROJECT_REF" || {
        echo "WARNING: Could not link to Supabase project, trying direct migration..."
        
        # Fallback to direct SQL execution
        for migration_file in $(find supabase/migrations -name "*.sql" -type f | sort); do
            echo "Applying: $(basename $migration_file)"
            psql "$DATABASE_URL" -f "$migration_file" || {
                echo "ERROR: Failed to apply migration: $migration_file"
                exit 1
            }
        done
        exit 0
    }
    
    # Push migrations
    supabase db push --db-url "$DATABASE_URL" || {
        echo "ERROR: Failed to push migrations"
        exit 1
    }
fi

echo "----------------------------------------"
echo "[OK] Database migrations completed successfully"
echo "========================================="

exit 0
