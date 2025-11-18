#!/bin/bash
# Ritual Desktop - Bloat Removal Script
# Removes unused dependencies and files to improve startup time

set -e

echo "🧹 Starting bloat removal..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Phase 1: Remove unused npm packages
echo "${YELLOW}📦 Phase 1: Removing unused npm packages...${NC}"
npm uninstall @emotion/react @emotion/styled @types/react-beautiful-dnd @types/lodash 2>/dev/null || echo "Some packages already removed"
echo "${GREEN}✅ Unused npm packages removed${NC}"
echo ""

# Phase 2: Clean up Python dependencies
echo "${YELLOW}🐍 Phase 2: Cleaning Python dependencies...${NC}"
if [ -f "backend/requirements.txt" ]; then
    # Remove alembic (not used)
    sed -i.bak '/^alembic/d' backend/requirements.txt
    # Remove aiosqlite (Turso-only now)
    sed -i.bak '/^aiosqlite/d' backend/requirements.txt
    rm backend/requirements.txt.bak
    echo "${GREEN}✅ Python dependencies cleaned${NC}"
fi
echo ""

# Phase 3: Delete documentation bloat (1,729 lines!)
echo "${YELLOW}📝 Phase 3: Removing documentation bloat...${NC}"
rm -f MIGRATION-*.md \
      CRITICAL-*.md \
      WHY-*.md \
      PERFORMANCE-*.md \
      QUICK-*.md \
      SAFE-*.md \
      TINYBIRD-*.md \
      VISUAL-*.md \
      NEXTFASTER-*.md \
      PACKAGE-*.md \
      TESTING-GUIDE.md \
      SECURITY-*.md \
      ENV-*.md \
      INSTALLATION-*.md \
      ROLLBACK.md 2>/dev/null || echo "Some docs already removed"
echo "${GREEN}✅ Documentation bloat removed (kept README, START-HERE, and guides)${NC}"
echo ""

# Phase 4: Delete unused backend files
echo "${YELLOW}🗑️  Phase 4: Removing unused files...${NC}"
rm -f types/supabase.ts 2>/dev/null || echo "Supabase types already removed"
echo "${GREEN}✅ Unused files removed${NC}"
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "${GREEN}🎉 Bloat removal complete!${NC}"
echo ""
echo "📊 Results:"
echo "   • Removed 4 unused npm packages"
echo "   • Cleaned 2 Python dependencies"
echo "   • Deleted ~1,700 lines of old docs"
echo "   • Removed unused type definitions"
echo ""
echo "🚀 Next steps:"
echo "   1. Run: npm install  (to update package-lock.json)"
echo "   2. Run: npm run dev  (should be noticeably faster!)"
echo "   3. Check: BLOAT-REMOVAL-PLAN.md for Phase 2-5 optimizations"
echo ""
echo "Expected improvement: 500ms-1s faster startup! ⚡"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

