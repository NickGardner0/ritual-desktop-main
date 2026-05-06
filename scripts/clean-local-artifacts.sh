#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

apply=false
include_deps=false

for arg in "$@"; do
  case "$arg" in
    --apply)
      apply=true
      ;;
    --include-deps)
      include_deps=true
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: npm run repo:clean-local -- [--apply] [--include-deps]" >&2
      exit 2
      ;;
  esac
done

paths=(
  ".fastembed_cache"
  "apps/dashboard/.next"
  "apps/desktop/src-tauri/.fastembed_cache"
  "apps/desktop/src-tauri/target"
  "apps/desktop/src-tauri/bin/ritual-watcher/target"
  "apps/desktop/src-tauri/bin/ritual-recorder/target"
  "apps/desktop/src-tauri/crates/ritual-db/target"
  "apps/backend/.memory_cloud.db"
  "apps/backend/.memory_cloud.db-shm"
  "apps/backend/.memory_cloud.db-wal"
  "apps/backend/.turso_import_seeds"
  "apps/backend/.turso_operator_main.db"
  "apps/backend/.turso_replica.db"
  "apps/backend/.turso_replica.db-shm"
  "apps/backend/.turso_replica.db-wal"
  "apps/backend/.turso_replica.db-info"
  "apps/backend/.turso_user_replicas"
)

if [ "$include_deps" = true ]; then
  paths+=(
    "apps/backend/.venv"
    "apps/dashboard/node_modules"
    "apps/chat-api/node_modules"
    "apps/desktop/node_modules"
    "packages/chat-runtime/node_modules"
    "packages/shared-contracts/node_modules"
  )
fi

echo "Ritual local artifact cleanup"
if [ "$apply" = true ]; then
  echo "Mode: apply"
else
  echo "Mode: dry run. Re-run with --apply to delete these artifacts."
fi

for path in "${paths[@]}"; do
  if [ -e "$path" ]; then
    du -sh "$path" 2>/dev/null || true
    if [ "$apply" = true ]; then
      rm -rf "$path"
    fi
  fi
done

find_targets=(apps packages scripts)
find_prunes=(
  -path "*/node_modules"
  -o -path "*/target"
  -o -path "*/.next"
  -o -path "*/.venv"
  -o -path "*/venv"
  -o -path "*/.fastembed_cache"
)

if [ "$apply" = true ]; then
  find "${find_targets[@]}" \( "${find_prunes[@]}" \) -prune -o -name ".DS_Store" -type f -delete 2>/dev/null || true
  find "${find_targets[@]}" \( "${find_prunes[@]}" \) -prune -o -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true
  find "${find_targets[@]}" \( "${find_prunes[@]}" \) -prune -o -name "*.pyc" -type f -delete 2>/dev/null || true
else
  find "${find_targets[@]}" \( "${find_prunes[@]}" \) -prune -o -name ".DS_Store" -type f -print 2>/dev/null | sed 's/^/would delete /' || true
  find "${find_targets[@]}" \( "${find_prunes[@]}" \) -prune -o -name "__pycache__" -type d -prune -print 2>/dev/null | sed 's/^/would delete /' || true
  find "${find_targets[@]}" \( "${find_prunes[@]}" \) -prune -o -name "*.pyc" -type f -print 2>/dev/null | sed 's/^/would delete /' || true
fi
