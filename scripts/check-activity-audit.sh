#!/usr/bin/env bash

set -euo pipefail

DB_PATH="${RITUAL_ACTIVITY_DB:-$HOME/.ritual/activity.db}"
RANGE_SPEC="${1:-30d}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but not installed."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but not installed."
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
  echo "Examples: $0 6h | $0 1d | $0 30d"
  exit 1
fi

START_MS=$(( NOW_MS - RANGE_MS ))
START_DATE="$(date -r $(( START_MS / 1000 )) '+%Y-%m-%d')"

echo "Ritual Activity Accuracy Audit"
echo "DB: $DB_PATH"
echo "Audit window: $RANGE_LABEL"
echo "Starting date: $START_DATE"
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

naive_ms = 0
merged = []
for start, end in rows:
    if start is None or end is None or end <= start:
        continue
    naive_ms += end - start
    if not merged or start > merged[-1][1]:
        merged.append([start, end])
    else:
        merged[-1][1] = max(merged[-1][1], end)

merged_ms = sum(end - start for start, end in merged)
overlap_ms = max(0, naive_ms - merged_ms)

print(f"Raw event rows in window: {len(rows)}")
print(f"Naive summed active time: {naive_ms / 3600000.0:.2f} hours")
print(f"Overlap-safe active time: {merged_ms / 3600000.0:.2f} hours")
print(f"Inflation from overlaps: {overlap_ms / 3600000.0:.2f} hours")
if merged_ms > 0:
    print(f"Naive / overlap-safe ratio: {naive_ms / merged_ms:.2f}x")
print(f"Merged activity intervals: {len(merged)}")
PY

echo
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode list
SELECT 'Daily rollup cached total_active_ms: ' ||
       printf('%.2f hours', COALESCE(SUM(total_active_ms), 0) / 3600000.0)
FROM daily_rollup_cache
WHERE date >= '$START_DATE';

SELECT 'Recent non-AFK events: ' || COUNT(*)
FROM activity_events
WHERE ts_end >= $START_MS
  AND is_afk = 0;

SELECT 'Recent AFK events: ' || COUNT(*)
FROM activity_events
WHERE ts_end >= $START_MS
  AND is_afk = 1;

SELECT 'Recent browser-extension events: ' || COUNT(*)
FROM activity_events
WHERE ts_end >= $START_MS
  AND source = 'browser_extension';

SELECT 'Recent watcher events: ' || COUNT(*)
FROM activity_events
WHERE ts_end >= $START_MS
  AND source != 'browser_extension';
SQL

echo
echo "Top apps by raw active duration"
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode column
SELECT printf('%-28s %9.2f h', app_name, SUM(ts_end - ts_start) / 3600000.0)
FROM activity_events
WHERE ts_end >= $START_MS
  AND is_afk = 0
GROUP BY app_name
ORDER BY SUM(ts_end - ts_start) DESC, MAX(ts_end) DESC
LIMIT 15;
SQL

echo
echo "Top browser domains by raw active duration"
sqlite3 -readonly "$DB_PATH" <<SQL
.headers off
.mode column
SELECT printf('%-28s %9.2f h', browser_domain, SUM(ts_end - ts_start) / 3600000.0)
FROM activity_events
WHERE ts_end >= $START_MS
  AND is_afk = 0
  AND browser_domain IS NOT NULL
  AND browser_domain != ''
GROUP BY browser_domain
ORDER BY SUM(ts_end - ts_start) DESC, MAX(ts_end) DESC
LIMIT 15;
SQL

echo
echo "Worst overlap days in range"
python3 - <<'PY' "$DB_PATH" "$START_MS"
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone

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

by_day = defaultdict(list)
for start, end in rows:
    if start is None or end is None or end <= start:
        continue
    day = datetime.fromtimestamp(end / 1000, tz=timezone.utc).astimezone().strftime("%Y-%m-%d")
    by_day[day].append((start, end))

results = []
for day, intervals in by_day.items():
    naive_ms = sum(end - start for start, end in intervals)
    merged = []
    for start, end in sorted(intervals):
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    merged_ms = sum(end - start for start, end in merged)
    overlap_ms = max(0, naive_ms - merged_ms)
    results.append((overlap_ms, day, naive_ms, merged_ms))

for overlap_ms, day, naive_ms, merged_ms in sorted(results, reverse=True)[:10]:
    print(f"{day} | overlap={overlap_ms / 3600000.0:8.2f}h | merged={merged_ms / 3600000.0:8.2f}h | naive={naive_ms / 3600000.0:8.2f}h")
PY
