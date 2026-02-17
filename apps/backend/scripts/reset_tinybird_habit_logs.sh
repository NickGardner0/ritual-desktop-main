#!/bin/bash

# Reset Tinybird habit_logs datasource and reload from Turso
# This script deletes duplicates by recreating the datasource

set -e

echo "🔄 Resetting Tinybird habit_logs datasource..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Navigate to repo Tinybird directory
cd "$REPO_ROOT/apps/tinybird"

echo "1️⃣ Truncating habit_logs datasource in Tinybird Cloud..."
/Users/nickgardner/.local/bin/tb --cloud datasource truncate habit_logs --yes

echo "2️⃣ Reloading all habit logs from Turso..."
cd "$REPO_ROOT/apps/backend"
python scripts/reload_tinybird_from_turso.py

echo ""
echo "✅ Reset complete! Tinybird habit_logs datasource is now clean and reloaded from Turso."
