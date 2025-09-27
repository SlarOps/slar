FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Minimal OS deps; psycopg2-binary should use wheels on Debian-based images
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates build-essential libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . /app

CMD ["python", "-m", "slack_worker"]
