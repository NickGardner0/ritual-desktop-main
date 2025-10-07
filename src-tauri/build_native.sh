#!/bin/bash

# Build script for native Swift timer widget

set -e

echo "🔨 Building native Swift timer widget..."

# Create output directory
mkdir -p target/native

# Clean previous builds
rm -f target/native/*.o target/native/*.a

# Get SDK path
SDK_PATH=$(xcrun --show-sdk-path)
echo "📱 Using SDK: $SDK_PATH"

# Compile Swift to object file with minimal flags to avoid module conflicts
swiftc -c native-timer/NativeTimer.swift \
    -o target/native/NativeTimer.o \
    -target arm64-apple-macosx10.15 \
    -sdk "$SDK_PATH" \
    -import-objc-header native-timer/bridge.h \
    -module-name NativeTimer \
    -Xfrontend -disable-implicit-concurrency-module-import \
    -Xfrontend -disable-implicit-string-processing-module-import

# Create static library
ar rcs target/native/libNativeTimer.a target/native/NativeTimer.o

# Verify the library was created
if [ -f "target/native/libNativeTimer.a" ]; then
    echo "✅ Native Swift timer widget built successfully!"
    echo "📦 Library: target/native/libNativeTimer.a"
    echo "📏 Size: $(ls -lh target/native/libNativeTimer.a | awk '{print $5}')"
else
    echo "❌ Failed to create static library"
    exit 1
fi