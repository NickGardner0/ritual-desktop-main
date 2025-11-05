#!/bin/bash

echo "🧹 Cleaning up Ritual project directory..."

# Create docs directory and move documentation
mkdir -p docs
mv ARCHITECTURE_DIAGRAM.md docs/ 2>/dev/null
mv ENABLE_TINYBIRD.md docs/ 2>/dev/null
mv PERFORMANCE_OPTIMIZATION_GUIDE.md docs/ 2>/dev/null
mv TINYBIRD_DASHBOARD_UPDATE.md docs/ 2>/dev/null
mv TINYBIRD_IMPLEMENTATION_SUMMARY.md docs/ 2>/dev/null
mv TINYBIRD_MIGRATION_GUIDE.md docs/ 2>/dev/null
mv WHOOP_AUTO_SYNC_SETUP.md docs/ 2>/dev/null
mv WHOOP_INTEGRATION_GUIDE.md docs/ 2>/dev/null
mv migration.md docs/ 2>/dev/null
mv tinybird*.md docs/ 2>/dev/null

# Create scripts directory and move scripts
mkdir -p scripts
mv apply-tinybird-changes.sh scripts/ 2>/dev/null

# Remove temporary files
rm -f .DS_Store
rm -f .tinyb
rm -rf target/ 2>/dev/null

# Clean up empty directories
find . -type d -empty -delete 2>/dev/null

echo "✅ Project cleanup complete!"
echo "📁 Documentation moved to docs/"
echo "📁 Scripts moved to scripts/"
echo "🗑️  Temporary files removed"
