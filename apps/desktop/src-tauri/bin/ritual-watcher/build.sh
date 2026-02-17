#!/bin/bash
# Build script for Ritual Watcher sidecar

set -e

echo "🔨 Building Ritual Watcher for macOS..."

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Build in release mode
cargo build --release

# Create ~/.ritual/bin if it doesn't exist
INSTALL_DIR="$HOME/.ritual/bin"
mkdir -p "$INSTALL_DIR"

# Copy the binary
cp target/release/ritual-watcher "$INSTALL_DIR/"

echo "✅ Ritual Watcher built successfully!"
echo "📍 Installed to: $INSTALL_DIR/ritual-watcher"
echo ""
echo "To test manually:"
echo "  $INSTALL_DIR/ritual-watcher --device-id test-device --user-id test-user --title-mode off --foreground"

