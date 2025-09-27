# syntax=docker/dockerfile:1

# Build stage
FROM golang:1.24-alpine AS build
WORKDIR /src

ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN apk add --no-cache git

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build both binaries (server and worker)
COPY . .
RUN go build -o /out/server ./cmd/server && \
    go build -o /out/worker ./cmd/worker

# Runtime stage
FROM alpine:3.20
RUN adduser -D -H -u 10001 appuser && apk add --no-cache ca-certificates tzdata
WORKDIR /app

# Copy binaries
COPY --from=build /out/server /app/server
COPY --from=build /out/worker /app/worker

USER appuser
EXPOSE 8080
# Default to API server; docker-compose will override for worker
CMD ["./server"]

