# syntax=docker/dockerfile:1

# Alternative Dockerfile using Debian for better native module compatibility

# 1) Dependencies - Install only production dependencies
FROM node:22-slim AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else echo "Lockfile not found." && exit 1; \
  fi

# 2) Builder - Build the Next.js application
FROM node:22-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Copy package files
COPY package.json package-lock.json* ./

# Install ALL dependencies in builder stage
# This ensures native bindings are downloaded for the correct platform
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Copy all source files
COPY . .

# Build the application
RUN npm run build

# 3) Runner - Production runtime with minimal footprint
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 nextjs

# Copy public assets with proper ownership
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy standalone server and static files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

CMD ["node", "server.js"]
