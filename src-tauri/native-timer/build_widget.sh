#!/bin/bash

# Build script for minimal Swift timer widget (avoiding Cocoa framework conflicts)
echo "🔨 Building minimal Swift timer widget..."

# Create output directory
mkdir -p ../target/release

# Try full native Swift widget with Cocoa UI
echo "Attempting full native Swift widget compilation..."
swiftc -o ../target/release/NativeTimerWidget \
    -framework Cocoa \
    -framework Foundation \
    TimerWidgetApp.swift

if [ $? -eq 0 ]; then
    echo "✅ Native Swift timer widget built successfully!"
    echo "📍 Executable location: target/release/NativeTimerWidget"
    echo "🎯 This is a full native macOS widget with Cocoa UI!"
    echo "🚀 Ready to integrate with Tauri!"
else
    echo "❌ Native Swift compilation failed"
    exit 1
fi