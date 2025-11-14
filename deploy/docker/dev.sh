#!/bin/bash
set -e

# SLAR Development & Deployment Script
# Usage: ./dev.sh [command] [options]

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
REGISTRY=${REGISTRY:-ghcr.io/slarops}
TAG=${TAG:-1.0.1}

# Functions
print_usage() {
    cat << EOF
${BLUE}SLAR Development & Deployment Script${NC}

${GREEN}Usage:${NC}
  ./dev.sh [command] [options]

${GREEN}Commands:${NC}
  up              Start all services locally (build Next.js + docker compose up)
  down            Stop all services
  restart         Restart all services
  logs [service]  View logs (optional: specify service name)
  build           Build all Docker images for linux/amd64
  push [registry] Build and push to registry (default: $REGISTRY)
  deploy          Build, push, and restart K8s deployments
  status          Show service status
  clean           Clean up Docker resources
  help            Show this help message

${GREEN}Environment Variables:${NC}
  REGISTRY        Docker registry (default: ghcr.io/slarops)
  TAG             Image tag (default: 1.0.1)

${GREEN}Examples:${NC}
  ./dev.sh up                          # Start locally
  ./dev.sh logs ai                     # View AI service logs
  ./dev.sh build                       # Build all images
  ./dev.sh push                        # Push to default registry
  REGISTRY=ghcr.io/myorg ./dev.sh push # Push to custom registry
  ./dev.sh deploy                      # Full deployment to K8s

${GREEN}Quick Access:${NC}
  Frontend:  http://localhost:8000
  API:       http://localhost:8000/api
  AI Agent:  http://localhost:8002
  Kong:      http://localhost:8001

EOF
}

check_env() {
    if [ ! -f "../../.env" ]; then
        echo -e "${YELLOW}⚠️  Warning: .env file not found at repository root${NC}"
        echo -e "${YELLOW}   Create one from .env.example${NC}"
    fi
}

fix_line_endings() {
    echo -e "${BLUE}🔧 Fixing line endings...${NC}"
    cd ../../api/ai
    sed -i '' 's/\r$//' docker-entrypoint.sh 2>/dev/null || dos2unix docker-entrypoint.sh 2>/dev/null || true
    cd ../../deploy/docker
}

build_nextjs() {
    echo -e "${BLUE}📦 Building Next.js...${NC}"
    cd ../../web/slar

    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm ci
    fi

    npm run build

    if [ ! -d ".next/standalone" ]; then
        echo -e "${RED}❌ Next.js build failed${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ Next.js build completed${NC}"
    cd ../../deploy/docker
}

build_images() {
    echo -e "${BLUE}🐳 Building Docker images for linux/amd64...${NC}"

    # Create temp compose file with custom registry
    sed "s|ghcr.io/slarops/|$REGISTRY/|g" docker-compose.yaml > docker-compose.tmp.yaml

    docker compose -f docker-compose.tmp.yaml build

    rm docker-compose.tmp.yaml

    echo -e "${GREEN}✅ Images built${NC}"
    docker images | grep "$REGISTRY/slar-"
}

push_images() {
    echo -e "${BLUE}📤 Pushing images to $REGISTRY...${NC}"

    docker push $REGISTRY/slar-web:$TAG
    docker push $REGISTRY/slar-api:$TAG
    docker push $REGISTRY/slar-ai:$TAG
    docker push $REGISTRY/slar-slack-worker:$TAG

    echo -e "${GREEN}✅ Images pushed${NC}"
}

restart_k8s() {
    if ! command -v kubectl &> /dev/null; then
        echo -e "${YELLOW}⚠️  kubectl not found, skipping K8s restart${NC}"
        return
    fi

    echo -e "${BLUE}♻️  Restarting K8s deployments...${NC}"

    kubectl rollout restart deployment slar-web -n slar
    kubectl rollout restart deployment slar-api -n slar
    kubectl rollout restart deployment slar-ai -n slar
    kubectl rollout restart deployment slar-slack-worker -n slar

    echo -e "${GREEN}✅ Deployments restarted${NC}"
    echo ""
    echo "Check status:"
    kubectl get pods -n slar
}

# Commands
cmd_up() {
    check_env
    fix_line_endings
    build_nextjs

    echo -e "${BLUE}🚀 Starting services...${NC}"
    docker compose up -d

    echo ""
    echo -e "${GREEN}✅ Services started!${NC}"
    echo ""
    docker compose ps
    echo ""
    echo -e "${BLUE}Access URLs:${NC}"
    echo -e "  Frontend:  ${GREEN}http://localhost:8000${NC}"
    echo -e "  API:       ${GREEN}http://localhost:8000/api${NC}"
    echo -e "  AI Agent:  ${GREEN}http://localhost:8002${NC}"
    echo -e "  Kong:      ${GREEN}http://localhost:8001${NC}"
    echo ""
    echo -e "${YELLOW}View logs: ./dev.sh logs${NC}"
}

cmd_down() {
    echo -e "${BLUE}🛑 Stopping services...${NC}"
    docker compose down
    echo -e "${GREEN}✅ Services stopped${NC}"
}

cmd_restart() {
    echo -e "${BLUE}♻️  Restarting services...${NC}"
    docker compose restart
    echo -e "${GREEN}✅ Services restarted${NC}"
    docker compose ps
}

cmd_logs() {
    SERVICE=$1
    if [ -z "$SERVICE" ]; then
        docker compose logs -f
    else
        docker compose logs -f "$SERVICE"
    fi
}

cmd_build() {
    check_env
    fix_line_endings
    build_nextjs
    build_images
}

cmd_push() {
    if [ ! -z "$1" ]; then
        REGISTRY=$1
    fi

    check_env
    fix_line_endings
    build_nextjs
    build_images
    push_images
}

cmd_deploy() {
    if [ ! -z "$1" ]; then
        REGISTRY=$1
    fi

    check_env
    fix_line_endings
    build_nextjs
    build_images
    push_images
    restart_k8s
}

cmd_status() {
    echo -e "${BLUE}📊 Service Status${NC}"
    echo ""
    docker compose ps
    echo ""
    echo -e "${BLUE}Health Checks:${NC}"
    echo -n "  Frontend:  "
    curl -s http://localhost:8000 > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
    echo -n "  API:       "
    curl -s http://localhost:8000/api/health > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
    echo -n "  AI:        "
    curl -s http://localhost:8002/health > /dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
}

cmd_clean() {
    echo -e "${YELLOW}⚠️  This will remove unused Docker resources${NC}"
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}🧹 Cleaning up...${NC}"
        docker image prune -a -f
        docker volume prune -f
        docker container prune -f
        echo -e "${GREEN}✅ Cleanup complete${NC}"
    fi
}

# Main
COMMAND=${1:-help}

case $COMMAND in
    up)
        cmd_up
        ;;
    down)
        cmd_down
        ;;
    restart)
        cmd_restart
        ;;
    logs)
        cmd_logs $2
        ;;
    build)
        cmd_build
        ;;
    push)
        cmd_push $2
        ;;
    deploy)
        cmd_deploy $2
        ;;
    status)
        cmd_status
        ;;
    clean)
        cmd_clean
        ;;
    help|--help|-h)
        print_usage
        ;;
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        echo ""
        print_usage
        exit 1
        ;;
esac
