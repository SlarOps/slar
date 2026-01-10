#!/bin/sh
set -e

# Runtime environment variable injection for Next.js
# This script replaces placeholder values in the built JS files with actual runtime values

# Function to replace placeholder in files
replace_env() {
  local VAR_NAME="$1"
  local VAR_VALUE="$2"
  local PLACEHOLDER="__${VAR_NAME}__"

  if [ -n "$VAR_VALUE" ]; then
    echo "Injecting $VAR_NAME..."
    find /app/.next -type f -name "*.js" -exec sed -i "s|${PLACEHOLDER}|${VAR_VALUE}|g" {} \; 2>/dev/null || true
  fi
}

# Inject NEXT_PUBLIC_* variables at runtime
replace_env "NEXT_PUBLIC_API_URL" "${NEXT_PUBLIC_API_URL}"
replace_env "NEXT_PUBLIC_AI_API_URL" "${NEXT_PUBLIC_AI_API_URL}"
replace_env "NEXT_PUBLIC_AI_WS_URL" "${NEXT_PUBLIC_AI_WS_URL}"
replace_env "NEXT_PUBLIC_SUPABASE_URL" "${NEXT_PUBLIC_SUPABASE_URL}"
replace_env "NEXT_PUBLIC_SUPABASE_ANON_KEY" "${NEXT_PUBLIC_SUPABASE_ANON_KEY}"

echo "Environment variables injected successfully"

# Execute the main command
exec "$@"
