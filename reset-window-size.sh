#!/bin/bash
# Script to reset Tauri window size by clearing cached window state

echo "🔄 Resetting Ritual app window size..."

# Kill any running instances
echo "Stopping any running instances..."
pkill -f "ritual-desktop" 2>/dev/null || true

# Clear Tauri window state cache (if it exists)
# Tauri stores window state in ~/Library/Application Support/com.ritual.desktop
APP_SUPPORT_DIR="$HOME/Library/Application Support/com.ritual.desktop"
if [ -d "$APP_SUPPORT_DIR" ]; then
    echo "Clearing cached window state..."
    rm -rf "$APP_SUPPORT_DIR"
    echo "✓ Cleared cache"
else
    echo "ℹ️  No cache found (this is normal for first run)"
fi

echo ""
echo "✅ Done! The app will now use the new window size from tauri.conf.json"
echo ""
echo "Current settings:"
echo "  Width: 900px"
echo "  Height: 550px"
echo ""
echo "To start the app again, run: npm run desktop"
