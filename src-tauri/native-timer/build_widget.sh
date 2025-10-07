#!/bin/bash
set -e

# Always execute relative to this script's directory so Swift sources resolve
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building native Swift timer widget from $SCRIPT_DIR ..."

# Ensure output directory exists (relative to src-tauri)
mkdir -p ../target/release

echo "Attempting full native Swift widget compilation with microphone permissions and speech recognition..."
swiftc -o ../target/release/NativeTimerWidget \
    -framework Cocoa \
    -framework Foundation \
    -framework AVFoundation \
    -framework Speech \
    TimerWidgetApp.swift \
    MicrophonePermission.swift \
    SpeechRecognition.swift

echo "Native Swift timer widget built successfully!"
echo "Executable location: src-tauri/target/release/NativeTimerWidget"
echo "This is a full native macOS widget with Cocoa UI!"
echo "Ready to integrate with Tauri!"