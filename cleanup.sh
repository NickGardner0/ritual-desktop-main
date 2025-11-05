#!/bin/bash
# Ritual Desktop - Cleanup Script
# Removes duplicate files, unused dependencies, and backup files
# Run before production deployment

set -e  # Exit on error

echo "🧹 Starting cleanup process..."

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "${RED}❌ Error: package.json not found. Run this script from the project root.${NC}"
    exit 1
fi

echo ""
echo "${YELLOW}📦 Removing unused npm dependencies...${NC}"
npm uninstall @alloc/quick-lru 2>/dev/null || true
npm uninstall ai-stream 2>/dev/null || true
npm uninstall react-beautiful-dnd 2>/dev/null || true
npm uninstall react-chartjs-2 2>/dev/null || true
npm uninstall dlv 2>/dev/null || true
npm uninstall @nodelib/fs.walk 2>/dev/null || true

echo ""
echo "${YELLOW}🗑️  Removing duplicate context files...${NC}"
rm -f contexts/HabitsContext-Old-Backup.tsx
rm -f contexts/HabitsContext-ReactQuery.tsx
echo "  ✓ Removed HabitsContext backups"

echo ""
echo "${YELLOW}🗑️  Removing backup files...${NC}"
rm -f app/page-backup.tsx
rm -rf components/backup/
echo "  ✓ Removed backup files"

echo ""
echo "${YELLOW}🗑️  Removing empty directories...${NC}"
rmdir app/test-backend/ 2>/dev/null || true
rmdir app/test-enhanced-chat/ 2>/dev/null || true
rmdir app/home/ 2>/dev/null || true
rmdir app/api/chat/enhanced/ 2>/dev/null || true
rmdir app/api/clear-metrics-cache/ 2>/dev/null || true
echo "  ✓ Removed empty directories"

echo ""
echo "${YELLOW}🔐 Removing database from git tracking...${NC}"
if git ls-files --error-unmatch backend/ritual.db > /dev/null 2>&1; then
    git rm --cached backend/ritual.db
    echo "  ✓ Removed ritual.db from git"
else
    echo "  ℹ️  ritual.db not tracked by git (good!)"
fi

echo ""
echo "${YELLOW}📝 Updating .gitignore...${NC}"
# Remove the exception that allows ritual.db
if grep -q "!backend/ritual.db" .gitignore; then
    # Use sed to remove the line (compatible with both macOS and Linux)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' '/!backend\/ritual.db/d' .gitignore
    else
        sed -i '/!backend\/ritual.db/d' .gitignore
    fi
    echo "  ✓ Removed database exception from .gitignore"
else
    echo "  ℹ️  .gitignore already correct"
fi

echo ""
echo "${YELLOW}🔍 Running linter...${NC}"
npm run lint --fix || echo "  ⚠️  Some lint errors remain - check manually"

echo ""
echo "${GREEN}✅ Cleanup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Run: ${YELLOW}npm install${NC} (to update package-lock.json)"
echo "  2. Run: ${YELLOW}./setup-db.sh${NC} (to add database indexes)"
echo "  3. Review: ${YELLOW}PRE_PRODUCTION_AUDIT_REPORT.md${NC}"
echo "  4. Commit changes: ${YELLOW}git add . && git commit -m 'Pre-production cleanup'${NC}"
echo ""

