#!/bin/bash
# Fix Slow Startup - Clear All Caches and Rebuild

set -e

echo "🔧 Fixing slow startup issue..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "${YELLOW}Step 1: Stopping any running processes...${NC}"
# Kill any running Next.js or Python processes
pkill -f "next dev" 2>/dev/null || true
pkill -f "python start.py" 2>/dev/null || true
echo "${GREEN}✅ Processes stopped${NC}"
echo ""

echo "${YELLOW}Step 2: Clearing Next.js caches...${NC}"
rm -rf .next
rm -rf node_modules/.cache
rm -rf .swc
echo "${GREEN}✅ Next.js caches cleared${NC}"
echo ""

echo "${YELLOW}Step 3: Clearing Python caches...${NC}"
cd backend
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
cd ..
echo "${GREEN}✅ Python caches cleared${NC}"
echo ""

echo "${YELLOW}Step 4: Reinstalling node_modules (this may take a minute)...${NC}"
npm install
echo "${GREEN}✅ Dependencies reinstalled${NC}"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "${GREEN}🎉 Cache cleanup complete!${NC}"
echo ""
echo "📝 Next steps:"
echo "   1. Start backend:  cd backend && python start.py"
echo "   2. Start frontend: npm run dev"
echo ""
echo "Expected result: Dashboard loads in <3 seconds (not 20s!)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

