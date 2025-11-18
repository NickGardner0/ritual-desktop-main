#!/bin/bash
# Fix Tauri Desktop App - Clear ALL Caches

set -e

echo "🖥️  Fixing Tauri Desktop App Caches..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "${YELLOW}Step 1: Stopping all processes...${NC}"
pkill -f "next dev" 2>/dev/null || true
pkill -f "tauri dev" 2>/dev/null || true
pkill -f "python start.py" 2>/dev/null || true
sleep 2
echo "${GREEN}✅ All processes stopped${NC}"
echo ""

echo "${YELLOW}Step 2: Clearing Next.js caches...${NC}"
rm -rf .next
rm -rf node_modules/.cache
rm -rf .swc
echo "${GREEN}✅ Next.js caches cleared${NC}"
echo ""

echo "${YELLOW}Step 3: Clearing Tauri/Rust build cache...${NC}"
if [ -d "src-tauri/target" ]; then
    echo "   Removing src-tauri/target/ (this may take a moment)..."
    rm -rf src-tauri/target
    echo "${GREEN}✅ Tauri build cache cleared${NC}"
else
    echo "   No Tauri cache found (skip)"
fi
echo ""

echo "${YELLOW}Step 4: Clearing Python caches...${NC}"
cd backend
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
cd ..
echo "${GREEN}✅ Python caches cleared${NC}"
echo ""

echo "${YELLOW}Step 5: Reinstalling dependencies...${NC}"
npm install
echo "${GREEN}✅ Dependencies reinstalled${NC}"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "${GREEN}🎉 All caches cleared!${NC}"
echo ""
echo "📝 To start your Tauri desktop app:"
echo ""
echo "${YELLOW}Terminal 1:${NC}"
echo "   cd backend"
echo "   python start.py"
echo ""
echo "${YELLOW}Terminal 2:${NC}"
echo "   npm run dev:webpack"
echo ""
echo "${YELLOW}Terminal 3 (wait for Terminal 2 to say 'Ready'):${NC}"
echo "   npm run desktop"
echo ""
echo "Expected result:"
echo "   • First launch: 5-10s (compiling Rust + Next.js)"
echo "   • Subsequent launches: 2-3s (cached)"
echo "   • Dashboard load: <3s (not 20s!)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

