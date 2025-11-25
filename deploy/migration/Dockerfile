# Migration Container for SLAR
# This container runs database migrations using Supabase CLI
FROM debian:bookworm-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Supabase CLI
RUN curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \
    | tar -xz -C /usr/local/bin

# Create working directory
WORKDIR /app

# Copy migration files and config
# Build context is project root, so paths are relative to that
COPY supabase/migrations ./supabase/migrations
COPY supabase/config.toml ./supabase/config.toml

# Copy migration script
COPY deploy/migration/run-migration.sh /app/run-migration.sh
RUN chmod +x /app/run-migration.sh

# Run migrations
ENTRYPOINT ["/app/run-migration.sh"]
