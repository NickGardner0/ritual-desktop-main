#!/bin/bash
set -e

# Always execute relative to this script's directory so Swift sources resolve
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building native Swift timer widget from $SCRIPT_DIR ..."

# Ensure output directory exists (relative to src-tauri)
mkdir -p ../target/release
mkdir -p .build/module-cache .build/clang-module-cache

# Keep Swift/Clang module caches local to the project.
export SWIFTPM_MODULECACHE_OVERRIDE="$SCRIPT_DIR/.build/module-cache"
export CLANG_MODULE_CACHE_PATH="$SCRIPT_DIR/.build/clang-module-cache"
export SWIFT_BUILD_FLAGS="-Xswiftc -module-cache-path -Xswiftc $SWIFTPM_MODULECACHE_OVERRIDE"

echo "Building NativeTimerWidget via Swift Package Manager (DynamicNotchKit enabled)..."
swift build -c release $SWIFT_BUILD_FLAGS

BIN_PATH=".build/release/NativeTimerWidget"
if [ ! -f "$BIN_PATH" ]; then
  echo "❌ Expected binary not found at $BIN_PATH"
  exit 1
fi

cp "$BIN_PATH" ../target/release/NativeTimerWidget
chmod +x ../target/release/NativeTimerWidget

# Wrap in a .app bundle so macOS uses the embedded Info.plist for permission prompts
APP_BUNDLE="../target/release/NativeTimerWidget.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

cp "$BIN_PATH" "$APP_BUNDLE/Contents/MacOS/NativeTimerWidget"
chmod +x "$APP_BUNDLE/Contents/MacOS/NativeTimerWidget"

if [ -f "Resources/Info.plist" ]; then
  cp "Resources/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
  echo "Embedded Info.plist into app bundle"
fi

echo "Native Swift timer widget built successfully!"
echo "Executable location: src-tauri/target/release/NativeTimerWidget"
echo "App bundle location: src-tauri/target/release/NativeTimerWidget.app"
echo "Ready to integrate with Tauri!"
