#!/bin/bash

# Reset Tinybird habit_logs datasource and reload from Turso
# This script deletes duplicates by recreating the datasource

set -e

echo "🔄 Resetting Tinybird habit_logs datasource..."

# Navigate to tinybird directory
cd "$(dirname "$0")/../../tinybird"

echo "1️⃣ Truncating habit_logs datasource in Tinybird Cloud..."
/Users/nickgardner/.local/bin/tb --cloud datasource truncate habit_logs --yes

echo "2️⃣ Reloading all habit logs from Turso..."
cd ../backend
python scripts/reload_tinybird_from_turso.py

echo ""
echo "✅ Reset complete! Tinybird habit_logs datasource is now clean and reloaded from Turso."

