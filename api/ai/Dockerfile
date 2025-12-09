# Multi-stage build for AI Agent Service
# Stage 1: Builder
FROM python:3.11-slim AS builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies including Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    zip \
    unzip \
    ca-certificates \
    gnupg \
    apt-transport-https \
    git \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install kubectl
RUN curl -fsSL https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

# Install awscli
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install

# Install Google Cloud SDK
RUN curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update && apt-get install -y google-cloud-cli \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally (required by claude-agent-sdk)
RUN npm install -g @anthropic-ai/claude-code

# Copy installed packages from builder
COPY --from=builder /root/.local /root/.local

# Copy application code
COPY . .

# Set PATH to include user-installed packages and npm global bin
ENV PATH=/root/.local/bin:/usr/local/bin:$PATH

# Environment variables with defaults
ENV PYTHONUNBUFFERED=1
ENV PORT=8002
ENV USER_WORKSPACES_DIR=/app/workspaces
ENV HOST=0.0.0.0
ENV HOME=/root

# Node.js environment variables for memory limits
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Expose port
EXPOSE 8002

# Run the application
CMD ["uvicorn", "claude_agent_api_v1:app", \
     "--host", "0.0.0.0", \
     "--port", "8002", \
     "--workers", "1", \
     "--loop", "uvloop", \
     "--log-level", "info"]
