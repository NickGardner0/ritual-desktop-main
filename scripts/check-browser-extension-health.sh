#!/usr/bin/env bash

set -euo pipefail

DB_PATH="${RITUAL_ACTIVITY_DB:-$HOME/.ritual/activity.db}"
WATCHER_STATUS_URL="${RITUAL_BROWSER_HEARTBEAT_URL:-http://127.0.0.1:8766/api/status}"
RECENT_MINUTES="${1:-15}"

if ! [[ "$RECENT_MINUTES" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 [recent_minutes]"
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but not installed."
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

RECENT_SECONDS=$((RECENT_MINUTES * 60))
RECENT_MS=$((RECENT_SECONDS * 1000))
NOW_MS=$(( $(date +%s) * 1000 ))

echo "Ritual Browser Extension Diagnostics"
echo "DB: $DB_PATH"
echo "Watcher status URL: $WATCHER_STATUS_URL"
echo "Recent window: last $RECENT_MINUTES minutes"
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

last = status.get("last_extension_heartbeat_ms")
age = None if last is None else max(0, (now_ms - int(last)) // 1000)
print("Watcher heartbeat server: reachable")
print(f"Watcher process id: {status.get('process_id', 'unknown')}")
print(f"Listener port: {status.get('listener_port', 'unknown')}")
print(f"Heartbeat server uptime: {status.get('uptime_seconds', 'unknown')}s")
print(f"Extension total heartbeats: {status.get('total_heartbeats', 'unknown')}")
print(f"Extension active session: {status.get('active_session', False)}")
if last is not None:
    ts = datetime.fromtimestamp(int(last) / 1000).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    print(f"Last extension heartbeat: {ts} ({age}s ago)")
else:
    print("Last extension heartbeat: none reported")
PY
else
  echo "Watcher heartbeat server: not reachable"
fi

echo

python3 - <<'PY' "$DB_PATH" "$NOW_MS" "$RECENT_MS"
import sqlite3
import sys

db_path = sys.argv[1]
now_ms = int(sys.argv[2])
recent_ms = int(sys.argv[3])

conn = sqlite3.connect(db_path)
rows = conn.execute(
    """
    SELECT ts_start, ts_end
    FROM activity_events
    WHERE source = 'browser_extension'
      AND ts_end >= ?
    ORDER BY ts_start ASC, ts_end ASC
    """,
    (now_ms - recent_ms,),
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
print(f"Overlap-safe active time in recent window: {total_ms / 60000.0:.1f} min")
print(f"Merged active intervals in recent window: {len(merged)}")
PY

echo

sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode list
SELECT 'Recent browser_extension events: ' || COUNT(*)
FROM activity_events
WHERE source = 'browser_extension'
  AND ts_end >= $NOW_MS - $RECENT_MS;

SELECT 'Last browser_extension event: ' ||
       COALESCE(datetime(MAX(ts_end) / 1000, 'unixepoch', 'localtime'), 'none')
FROM activity_events
WHERE source = 'browser_extension';

SELECT 'Distinct domains in recent window: ' || COUNT(DISTINCT browser_domain)
FROM activity_events
WHERE source = 'browser_extension'
  AND browser_domain IS NOT NULL
  AND browser_domain != ''
  AND ts_end >= $NOW_MS - $RECENT_MS;
SQL

echo
echo "Top domains by event count in recent window"
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode column
SELECT printf('%-32s %6d events', browser_domain, COUNT(*))
FROM activity_events
WHERE source = 'browser_extension'
  AND browser_domain IS NOT NULL
  AND browser_domain != ''
  AND ts_end >= $NOW_MS - $RECENT_MS
GROUP BY browser_domain
ORDER BY COUNT(*) DESC, MAX(ts_end) DESC
LIMIT 10;
SQL

echo
echo "Top browser apps by event count in recent window"
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode column
SELECT printf('%-32s %6d events', app_name, COUNT(*))
FROM activity_events
WHERE source = 'browser_extension'
  AND ts_end >= $NOW_MS - $RECENT_MS
GROUP BY app_name
ORDER BY COUNT(*) DESC, MAX(ts_end) DESC
LIMIT 10;
SQL

echo
echo "Recent browser_extension samples"
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode column
SELECT datetime(ts_end / 1000, 'unixepoch', 'localtime'),
       app_name,
       COALESCE(browser_domain, '(none)'),
       substr(COALESCE(browser_url, ''), 1, 90)
FROM activity_events
WHERE source = 'browser_extension'
ORDER BY ts_end DESC
LIMIT 12;
SQL
