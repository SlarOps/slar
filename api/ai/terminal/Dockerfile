FROM python:3.11-slim

WORKDIR /app

# Install system dependencies, including Node.js and npm for geminicli
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    git \
    curl \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install geminicli globally
RUN npm install -g @google/gemini-cli@latest

# Copy only requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy terminal-specific files
COPY terminal.py .
COPY terminal_server.py .

# Expose terminal server port
EXPOSE 8003

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV TERMINAL_PORT=8003
ENV TERMINAL_HOST=0.0.0.0

# Run terminal server
CMD ["python", "terminal_server.py"]