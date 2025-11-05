#!/bin/bash

# Apply Tinybird Migration Changes
# This script applies all the changes needed to migrate to Tinybird as the primary analytics store

echo "🚀 Starting Tinybird migration..."

# 1. Back up original files
echo "📦 Creating backups of original files..."
mkdir -p backups
cp app/api/chat/habits/route.ts backups/route.ts.backup
cp app/api/integrations/whoop/sync/route.ts backups/whoop-sync-route.ts.backup
cp app/\(dashboard\)/dashboard/page.tsx backups/dashboard-page.tsx.backup

# 2. Replace API routes with Tinybird-only versions
echo "🔄 Updating API routes to use Tinybird..."
cp app/api/chat/habits/route-tinybird-only.ts app/api/chat/habits/route.ts
cp app/api/integrations/whoop/sync/route-tinybird-only.ts app/api/integrations/whoop/sync/route.ts

# 3. Replace dashboard page with Tinybird version (keeping EXACT original design)
echo "🔄 Updating dashboard to use Tinybird (keeping EXACT original design)..."
cp app/\(dashboard\)/dashboard/page-exact-layout.tsx app/\(dashboard\)/dashboard/page.tsx

# 4. Keep original AI chat component (already updated to use Tinybird)
echo "✅ Using original AI chat component with Tinybird integration..."
# No need to copy anything - original component already works with Tinybird

# 4. Rebuild native timer with direct Tinybird write
echo "🔨 Rebuilding native timer with direct Tinybird write..."
cd src-tauri && bash native-timer/build_widget.sh
cd ..

echo "✅ Migration complete! Restart your app with 'npm run dev' to see the changes."
echo ""
echo "📝 Note: If you encounter any issues, you can restore the original files from the backups folder."
