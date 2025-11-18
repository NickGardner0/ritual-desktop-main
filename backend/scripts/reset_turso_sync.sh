#!/bin/bash
# Reset Turso replica - forces a fresh sync from Turso Cloud
# Run this if your local replica gets out of sync

set -e

echo "🔄 Resetting Turso Cloud Replica..."
echo ""

cd "$(dirname "$0")/.."  # Go to backend directory

# Remove replica files if they exist
REPLICA_FILES=(
    ".turso_replica.db"
    ".turso_replica.db-shm"
    ".turso_replica.db-wal"
)

FOUND=0
for file in "${REPLICA_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "🗑️  Removing: $file"
        rm -f "$file"
        FOUND=1
    fi
done

if [ $FOUND -eq 0 ]; then
    echo "ℹ️  No replica files found (already clean)"
else
    echo ""
    echo "✅ Replica files removed"
fi

echo ""
echo "📝 Next steps:"
echo "   1. Restart your backend: python start.py"
echo "   2. The replica will automatically sync fresh data from Turso Cloud"
echo ""

