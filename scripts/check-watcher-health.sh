#!/usr/bin/env bash

set -euo pipefail

DB_PATH="${RITUAL_ACTIVITY_DB:-$HOME/.ritual/activity.db}"
WATCHER_STATUS_URL="${RITUAL_BROWSER_HEARTBEAT_URL:-http://127.0.0.1:8766/api/status}"
RANGE_SPEC="${1:-60m}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but not installed."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but not installed."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not installed."
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "Activity database not found at: $DB_PATH"
  exit 1
fi

NOW_MS=$(( $(date +%s) * 1000 ))

read -r RANGE_MS RANGE_LABEL <<EOF
$(python3 - <<'PY' "$RANGE_SPEC"
import re
import sys

spec = sys.argv[1].strip().lower()
m = re.fullmatch(r"(\d+)([mhd])", spec)
if not m:
    print("ERROR")
    sys.exit(1)

value = int(m.group(1))
unit = m.group(2)
multiplier = {"m": 60_000, "h": 3_600_000, "d": 86_400_000}[unit]
labels = {"m": "minutes", "h": "hours", "d": "days"}
print(f"{value * multiplier} last {value} {labels[unit]}")
PY
)
EOF

if [[ "$RANGE_MS" == "ERROR" || -z "$RANGE_MS" ]]; then
  echo "Usage: $0 [range]"
  echo "Examples: $0 60m | $0 6h | $0 7d"
  exit 1
fi

START_MS=$(( NOW_MS - RANGE_MS ))

echo "Ritual Watcher Health"
echo "DB: $DB_PATH"
echo "Watcher status URL: $WATCHER_STATUS_URL"
echo "Recent window: $RANGE_LABEL"
echo

WATCHER_STATUS_RAW="$(curl -sf "$WATCHER_STATUS_URL" || true)"

if [[ -n "$WATCHER_STATUS_RAW" ]]; then
  python3 - <<'PY' "$WATCHER_STATUS_RAW" "$NOW_MS"
import json
import sys
from datetime import datetime

raw = sys.argv[1]
now_ms = int(sys.argv[2])
status = json.loads(raw)

def fmt_ms(ts_ms: int | None) -> str:
    if ts_ms is None:
        return "none"
    age_s = max(0, (now_ms - int(ts_ms)) // 1000)
    ts = datetime.fromtimestamp(int(ts_ms) / 1000).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    return f"{ts} ({age_s}s ago)"

print("Watcher heartbeat server: reachable")
print(f"Watcher process id: {status.get('process_id', 'unknown')}")
print(f"Listener port: {status.get('listener_port', 'unknown')}")
print(f"Heartbeat server uptime: {status.get('uptime_seconds', 'unknown')}s")
print(f"Extension active session: {status.get('active_session', False)}")
print(f"Total extension heartbeats: {status.get('total_heartbeats', 'unknown')}")
print(f"Last extension heartbeat: {fmt_ms(status.get('last_extension_heartbeat_ms'))}")
PY
else
  echo "Watcher heartbeat server: not reachable"
fi

echo
echo "Listener processes on port 8766"
lsof -nP -iTCP:8766 -sTCP:LISTEN 2>/dev/null || echo "No process listening on 8766"

echo
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode list
SELECT 'Last watcher heartbeat row: ' ||
       COALESCE(device_id, '(none)') || ' @ ' ||
       COALESCE(datetime(last_seen_ts / 1000, 'unixepoch', 'localtime'), 'none')
FROM watcher_heartbeat
ORDER BY last_seen_ts DESC
LIMIT 1;

SELECT 'Last local activity event: ' ||
       COALESCE(datetime(MAX(ts_end) / 1000, 'unixepoch', 'localtime'), 'none')
FROM activity_events;

SELECT 'Recent local activity events: ' || COUNT(*)
FROM activity_events
WHERE ts_end >= $START_MS;

SELECT 'Recent local active events (non-AFK): ' || COUNT(*)
FROM activity_events
WHERE ts_end >= $START_MS
  AND is_afk = 0;

SELECT 'Recent browser-extension events: ' || COUNT(*)
FROM activity_events
WHERE ts_end >= $START_MS
  AND source = 'browser_extension';

SELECT 'Recent watcher events: ' || COUNT(*)
FROM activity_events
WHERE ts_end >= $START_MS
  AND source != 'browser_extension';

SELECT 'Last context snapshot: ' ||
       COALESCE(datetime(MAX(ts) / 1000, 'unixepoch', 'localtime'), 'none')
FROM context_snapshots;

SELECT 'Recent context snapshots: ' || COUNT(*)
FROM context_snapshots
WHERE ts >= $START_MS;

SELECT 'Recorder frames total: ' || COALESCE(total_frames, 0) ||
       ', last capture: ' ||
       COALESCE(datetime(last_capture_time / 1000, 'unixepoch', 'localtime'), 'none')
FROM recorder_stats
WHERE id = 1;
SQL

echo
python3 - <<'PY' "$DB_PATH" "$START_MS"
import sqlite3
import sys

db_path = sys.argv[1]
start_ms = int(sys.argv[2])

conn = sqlite3.connect(db_path)
rows = conn.execute(
    """
    SELECT ts_start, ts_end
    FROM activity_events
    WHERE ts_end >= ?
      AND is_afk = 0
    ORDER BY ts_start ASC, ts_end ASC
    """,
    (start_ms,),
).fetchall()

merged = []
for start, end in rows:
    if start is None or end is None or end <= start:
        continue
    if not merged or start > merged[-1][1]:
        merged.append([start, end])
    else:
        merged[-1][1] = max(merged[-1][1], end)

total_ms = sum(end - start for start, end in merged)
print(f"Overlap-safe local active time in recent window: {total_ms / 3600000.0:.2f} hours")
print(f"Merged activity intervals in recent window: {len(merged)}")
PY

echo
echo "Recent source mix"
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode column
SELECT printf('%-24s %8d events', source, COUNT(*))
FROM activity_events
WHERE ts_end >= $START_MS
GROUP BY source
ORDER BY COUNT(*) DESC;
SQL

echo
echo "Recent top apps by event count"
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode column
SELECT printf('%-32s %6d events', app_name, COUNT(*))
FROM activity_events
WHERE ts_end >= $START_MS
GROUP BY app_name
ORDER BY COUNT(*) DESC, MAX(ts_end) DESC
LIMIT 12;
SQL

echo
echo "Recent top browser domains by event count"
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode column
SELECT printf('%-32s %6d events', browser_domain, COUNT(*))
FROM activity_events
WHERE ts_end >= $START_MS
  AND browser_domain IS NOT NULL
  AND browser_domain != ''
GROUP BY browser_domain
ORDER BY COUNT(*) DESC, MAX(ts_end) DESC
LIMIT 12;
SQL
