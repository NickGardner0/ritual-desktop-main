#!/bin/bash
# Script to reset Tauri window size by clearing cached window state

echo "🔄 Resetting Ritual app window size..."

# Kill any running instances
echo "Stopping any running instances..."
pkill -f "ritual-desktop" 2>/dev/null || true
pkill -f "app" 2>/dev/null || true

# Clear Tauri window state cache
APP_SUPPORT_DIR="$HOME/Library/Application Support/com.ritual.desktop"
if [ -d "$APP_SUPPORT_DIR" ]; then
    echo "Clearing Tauri app support cache..."
    rm -rf "$APP_SUPPORT_DIR"
    echo "✓ Cleared Tauri cache"
fi

# Clear macOS Saved Application State (window restoration)
SAVED_STATE_DIR="$HOME/Library/Saved Application State/com.ritual.desktop.savedState"
if [ -d "$SAVED_STATE_DIR" ]; then
    echo "Clearing macOS saved window state..."
    rm -rf "$SAVED_STATE_DIR"
    echo "✓ Cleared saved state"
fi

# Clear any WebKit/WebView caches
WEBKIT_DIR="$HOME/Library/WebKit/com.ritual.desktop"
if [ -d "$WEBKIT_DIR" ]; then
    echo "Clearing WebKit cache..."
    rm -rf "$WEBKIT_DIR"
    echo "✓ Cleared WebKit cache"
fi

# Clear Caches
CACHE_DIR="$HOME/Library/Caches/com.ritual.desktop"
if [ -d "$CACHE_DIR" ]; then
    echo "Clearing app caches..."
    rm -rf "$CACHE_DIR"
    echo "✓ Cleared caches"
fi

echo ""
echo "✅ Done! All cached state has been cleared."
echo ""
echo "Current window settings:"
echo "  Width: 1100px"
echo "  Height: 800px"
echo ""
echo "To start the app again, run: npm run desktop"
