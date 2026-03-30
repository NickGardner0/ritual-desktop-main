#!/usr/bin/env bash
set -euo pipefail

OUT_ROOT="${1:-$PWD/tmp/ritual-freeze-captures}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$OUT_ROOT/$STAMP"
mkdir -p "$OUT_DIR"

RITUAL_PID="$(pgrep -x Ritual | head -n1 || true)"
WATCHER_PID="$(pgrep -x ritual-watcher | head -n1 || true)"

echo "Writing freeze capture to $OUT_DIR"

{
  echo "timestamp=$STAMP"
  echo "ritual_pid=${RITUAL_PID:-}"
  echo "watcher_pid=${WATCHER_PID:-}"
} > "$OUT_DIR/metadata.txt"

ps auxww | rg "Ritual|ritual-watcher|WebKit" > "$OUT_DIR/processes.txt" || true
pgrep -fl "Ritual|ritual-watcher|WebKit" > "$OUT_DIR/pgrep.txt" || true

if [[ -n "${RITUAL_PID:-}" ]]; then
  sample "$RITUAL_PID" 5 1 -file "$OUT_DIR/ritual.sample.txt" || true
  spindump "$RITUAL_PID" 3 1 -file "$OUT_DIR/ritual.spindump.txt" || true
fi

if [[ -n "${WATCHER_PID:-}" ]]; then
  sample "$WATCHER_PID" 5 1 -file "$OUT_DIR/watcher.sample.txt" || true
fi

log show --style compact --last 5m \
  --predicate 'process == "Ritual" OR process == "ritual-watcher" OR process == "com.apple.WebKit.WebContent" OR process == "com.apple.WebKit.Networking" OR process == "com.apple.WebKit.GPU"' \
  > "$OUT_DIR/system.log" || true

echo "$OUT_DIR"
