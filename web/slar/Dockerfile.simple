# syntax=docker/dockerfile:1

# Simple approach: Build locally then copy to Docker
# Usage:
#   1. npm run build (locally)
#   2. docker build -f Dockerfile.simple -t slar-web .

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 nextjs

# Copy built files from local build
COPY --chown=nextjs:nodejs public ./public
COPY --chown=nextjs:nodejs .next/standalone ./
COPY --chown=nextjs:nodejs .next/static ./.next/static

USER nextjs

EXPOSE 3000

# HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
#   CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

CMD ["node", "server.js"]
