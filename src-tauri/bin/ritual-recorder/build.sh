#!/bin/bash
# Build script for ritual-recorder

set -e

echo "Building ritual-recorder..."

# Check for required dependencies
if ! command -v ffmpeg &> /dev/null; then
    echo "Warning: FFmpeg not found. Install with: brew install ffmpeg"
fi

# Build in release mode
cargo build --release

echo "Build complete!"
echo "Binary location: target/release/ritual-recorder"

# Copy to standard location if needed
if [ "$1" == "--install" ]; then
    mkdir -p ~/.ritual/bin
    cp target/release/ritual-recorder ~/.ritual/bin/
    echo "Installed to ~/.ritual/bin/ritual-recorder"
fi
