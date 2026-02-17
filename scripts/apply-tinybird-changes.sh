#!/bin/bash

# Apply Tinybird Migration Changes
# This script applies all the changes needed to migrate to Tinybird as the primary analytics store

echo "🚀 Starting Tinybird migration..."

# 1. Back up original files
echo "📦 Creating backups of original files..."
BACKUP_DIR="backups/$(date +%Y%m%d-%H%M%S)-tinybird-migration"
mkdir -p "$BACKUP_DIR"
cp apps/dashboard/app/api/chat/habits/route.ts "$BACKUP_DIR/route.ts.backup"
cp apps/dashboard/app/api/integrations/whoop/sync/route.ts "$BACKUP_DIR/whoop-sync-route.ts.backup"
cp apps/dashboard/app/\(dashboard\)/dashboard/page.tsx "$BACKUP_DIR/dashboard-page.tsx.backup"
echo "📁 Backups saved to: $BACKUP_DIR"

# 2. Replace API routes with Tinybird-only versions
echo "🔄 Updating API routes to use Tinybird..."
cp apps/dashboard/app/api/chat/habits/route-tinybird-only.ts apps/dashboard/app/api/chat/habits/route.ts
cp apps/dashboard/app/api/integrations/whoop/sync/route-tinybird-only.ts apps/dashboard/app/api/integrations/whoop/sync/route.ts

# 3. Replace dashboard page with Tinybird version (keeping EXACT original design)
echo "🔄 Updating dashboard to use Tinybird (keeping EXACT original design)..."
cp apps/dashboard/app/\(dashboard\)/dashboard/page-exact-layout.tsx apps/dashboard/app/\(dashboard\)/dashboard/page.tsx

# 4. Keep original AI chat component (already updated to use Tinybird)
echo "✅ Using original AI chat component with Tinybird integration..."
# No need to copy anything - original component already works with Tinybird

# 4. Rebuild native timer with direct Tinybird write
echo "🔨 Rebuilding native timer with direct Tinybird write..."
pushd apps/desktop/src-tauri >/dev/null
bash native-timer/build_widget.sh
popd >/dev/null

echo "✅ Migration complete! Restart your app with 'npm run dev' to see the changes."
echo ""
echo "📝 Note: If you encounter any issues, you can restore original files from: $BACKUP_DIR"
