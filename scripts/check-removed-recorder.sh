#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

pattern='native-recorder|ritual-recorder|screen-recorder|use-recorder|reconcile_recorder_config_user_cmd|RITUAL_ENABLE_RECORDER_AUTOSTART'

if rg -n "$pattern" apps package.json scripts \
  --glob '!node_modules' \
  --glob '!target' \
  --glob '!.next' \
  --glob '!dist' \
  --glob '!scripts/check-removed-recorder.sh'; then
  echo "Legacy recorder surface was reintroduced. Keep desktop context capture on ritual-watcher."
  exit 1
fi

echo "Removed recorder guard passed."
