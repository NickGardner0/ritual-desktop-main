#!/bin/bash
# Build script for Ritual Watcher sidecar

set -e

echo "🔨 Building Ritual Watcher for macOS..."

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Build in release mode
cargo build --release

# Cargo workspace puts the binary in the workspace root's target/ directory,
# not in the subcrate's local target/. Detect the correct location.
WORKSPACE_TARGET="$SCRIPT_DIR/../../target/release/ritual-watcher"
LOCAL_TARGET="$SCRIPT_DIR/target/release/ritual-watcher"
if [ -f "$WORKSPACE_TARGET" ]; then
    BINARY_PATH="$WORKSPACE_TARGET"
elif [ -f "$LOCAL_TARGET" ]; then
    BINARY_PATH="$LOCAL_TARGET"
else
    echo "❌ Could not find ritual-watcher binary in target/release/"
    echo "   Checked: $WORKSPACE_TARGET"
    echo "   Checked: $LOCAL_TARGET"
    exit 1
fi

# Create ~/.ritual/bin if it doesn't exist
INSTALL_DIR="$HOME/.ritual/bin"
mkdir -p "$INSTALL_DIR"

# Copy the binary
cp "$BINARY_PATH" "$INSTALL_DIR/"

# Also copy to Tauri sidecar bundle location
TARGET_TRIPLE="$(rustc -vV | awk '/host:/ {print $2}')"
TAURI_BIN_DIR="$SCRIPT_DIR/../../binaries"
mkdir -p "$TAURI_BIN_DIR"
cp "$BINARY_PATH" "$TAURI_BIN_DIR/ritual-watcher-$TARGET_TRIPLE"

echo "✅ Ritual Watcher built successfully!"
echo "📍 Installed to: $INSTALL_DIR/ritual-watcher"
echo "📍 Bundled sidecar prepared at: $TAURI_BIN_DIR/ritual-watcher-$TARGET_TRIPLE"
echo ""
echo "To test manually:"
echo "  $INSTALL_DIR/ritual-watcher --device-id test-device --user-id test-user --title-mode off --foreground"
