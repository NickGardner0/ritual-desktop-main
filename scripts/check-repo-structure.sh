#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

required_dirs=(
  "apps/dashboard"
  "apps/backend"
  "apps/desktop"
  "apps/desktop-ui"
  "apps/browser-extension"
  "apps/ios-companion"
  "apps/tinybird"
  "packages/shared-contracts"
  "packages/ui"
)

for dir in "${required_dirs[@]}"; do
  if [ ! -d "$dir" ]; then
    echo "Missing required directory: $dir"
    exit 1
  fi
done

legacy_paths=(
  "app"
  "backend"
  "browser-extension"
  "components"
  "contexts"
  "data"
  "hooks"
  "jobs"
  "lib"
  "public"
  "src"
  "types"
  "src-tauri"
  "ritual-icon"
  "tinybird"
)

for path in "${legacy_paths[@]}"; do
  if [ -e "$path" ]; then
    echo "Legacy root path should not exist: $path"
    exit 1
  fi
done

if find . -maxdepth 1 -type l | grep -q .; then
  echo "Root-level symlinks found; expected none."
  exit 1
fi

echo "Repo structure check passed."
