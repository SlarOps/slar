#!/bin/bash
set -e

echo "🔨 Building Next.js app locally..."
npm run build

echo "🐳 Building Docker image..."
docker build -f Dockerfile.simple -t slar-web:latest .

echo "✅ Docker image slar-web:latest is ready!"
echo ""
echo "To run:"
echo "  docker run -p 3000:3000 \\"
echo "    -e NEXT_PUBLIC_SUPABASE_URL=your_url \\"
echo "    -e NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key \\"
echo "    slar-web:latest"
