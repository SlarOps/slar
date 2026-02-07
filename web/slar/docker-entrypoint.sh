#!/bin/sh
set -e

# Next.js Runtime Configuration Entrypoint
#
# Environment variables are now exposed via /api/config endpoint
# No more sed replacement needed - the same Docker image works everywhere!
#
# Required environment variables:
#   - NEXT_PUBLIC_API_URL: Backend API URL (e.g., https://api.slar.io)
#   - NEXT_PUBLIC_AI_API_URL: AI service URL (e.g., https://ai.slar.io)
#   - NEXT_PUBLIC_AI_WS_URL: WebSocket URL (e.g., wss://ai.slar.io/ws/chat)
#
# Optional:
#   - NEXT_PUBLIC_SUPABASE_URL: Supabase URL (for storage features)
#   - NEXT_PUBLIC_SUPABASE_ANON_KEY: Supabase anon key

echo "=== SLAR Web Starting ==="
echo "Runtime config will be served via /api/config"
echo ""
echo "Environment:"
echo "  API_URL: ${NEXT_PUBLIC_API_URL:-<not set>}"
echo "  AI_API_URL: ${NEXT_PUBLIC_AI_API_URL:-<not set>}"
echo "  AI_WS_URL: ${NEXT_PUBLIC_AI_WS_URL:-<not set>}"
echo "  NODE_ENV: ${NODE_ENV:-production}"
echo ""

# Execute the main command (node server.js)
exec "$@"
