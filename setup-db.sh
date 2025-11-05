#!/bin/bash
# Ritual Desktop - Database Setup Script
# Adds performance indexes to SQLite database
# IMPORTANT: Run this before production deployment!

set -e  # Exit on error

echo "🗄️  Setting up database indexes..."

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if database exists
if [ ! -f "backend/ritual.db" ]; then
    echo "${RED}❌ Error: backend/ritual.db not found${NC}"
    echo "   Run the backend at least once to create the database"
    exit 1
fi

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "${RED}❌ Error: python3 not found${NC}"
    exit 1
fi

# Check if add_indexes.py exists
if [ ! -f "backend/add_indexes.py" ]; then
    echo "${RED}❌ Error: backend/add_indexes.py not found${NC}"
    exit 1
fi

echo ""
echo "${YELLOW}📊 Adding database indexes...${NC}"
cd backend
python3 add_indexes.py

echo ""
echo "${GREEN}✅ Database setup complete!${NC}"
echo ""
echo "Database is now optimized for production!"
echo ""

