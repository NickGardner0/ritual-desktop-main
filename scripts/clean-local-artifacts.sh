#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

apply=false
include_deps=false

show_help() {
  cat >&2 <<'EOF'
Usage: npm run repo:clean-local -- [--apply] [--include-deps] [--help]

Deletes known local generated artifacts only.

Options:
  --apply         Delete the listed artifacts. Without this, the script is a dry run.
  --include-deps  Also include dependency environments such as node_modules and .venv.
  --help, -h      Show this help.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --apply)
      apply=true
      ;;
    --include-deps)
      include_deps=true
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      show_help
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
  "apps/desktop/src-tauri/crates/ritual-db/target"
  "apps/backend/.memory_cloud.db"
  "apps/backend/.memory_cloud.db-shm"
  "apps/backend/.memory_cloud.db-wal"
  "apps/backend/.tmp_patch_test.db"
  "apps/backend/.tmp_verify_shared_turso.db"
  "apps/backend/.turso_activity_replica.db"
  "apps/backend/.turso_import_seeds"
  "apps/backend/.turso_operator_main.db"
  "apps/backend/.turso_operator_main.db-info"
  "apps/backend/.turso_replica.db"
  "apps/backend/.turso_replica.db-shm"
  "apps/backend/.turso_replica.db-wal"
  "apps/backend/.turso_replica.db-info"
  "apps/backend/.turso_user_replicas"
)

glob_patterns=(
  "apps/backend/.turso_replica.db.corrupt-"*
  "apps/backend/.turso_replica.db-info.corrupt-"*
  "apps/backend/.turso_replica.db-shm.corrupt-"*
  "apps/backend/.turso_replica.db-wal.corrupt-"*
)

for path in "${glob_patterns[@]}"; do
  if [ -e "$path" ]; then
    paths+=("$path")
  fi
done

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

total_kb=0
deleted_count=0
seen_paths="
"

format_kb() {
  local kb="$1"
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec --from-unit=1024 "${kb}"
  else
    awk -v kb="$kb" 'BEGIN {
      split("K M G T", units, " ");
      value = kb;
      unit = 1;
      while (value >= 1024 && unit < 4) {
        value = value / 1024;
        unit++;
      }
      if (unit == 1) {
        printf "%d%s", value, units[unit];
      } else {
        printf "%.1f%s", value, units[unit];
      }
    }'
  fi
}

for path in "${paths[@]}"; do
  case "$seen_paths" in
    *"
$path
"*)
      continue
      ;;
  esac
  seen_paths="${seen_paths}${path}
"

  if [ -e "$path" ]; then
    size_kb="$(du -sk "$path" 2>/dev/null | awk '{print $1}')"
    size_kb="${size_kb:-0}"
    total_kb=$((total_kb + size_kb))
    du -sh "$path" 2>/dev/null || true
    if [ "$apply" = true ]; then
      rm -rf "$path"
      deleted_count=$((deleted_count + 1))
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

if [ "$apply" = true ]; then
  echo "Deleted $deleted_count whitelisted artifact path(s), reclaiming approximately $(format_kb "$total_kb")."
else
  echo "Estimated reclaim from whitelisted artifact paths: $(format_kb "$total_kb")."
fi
