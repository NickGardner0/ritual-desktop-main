#!/usr/bin/env bash

set -euo pipefail

DAY="${1:-2026-02-27}"
DB_PATH="${2:-/Users/nickgardner/.ritual/backups/activity.db.context-user-fix.20260331-133757.bak}"
OUT_DIR="${3:-/Users/nickgardner/Desktop/ritual-desktop-main/tmp/historical-ocr-demo-${DAY}}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required" >&2
  exit 1
fi

if [[ ! -f "${DB_PATH}" ]]; then
  echo "database not found: ${DB_PATH}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

sqlite3 "${DB_PATH}" <<SQL > "${OUT_DIR}/overview.txt"
.mode tabs
SELECT 'day', '${DAY}';
SELECT 'ocr_frames', COUNT(*)
FROM ocr_frames
WHERE date(datetime(timestamp/1000,'unixepoch','localtime'))='${DAY}';
SELECT 'ocr_chars', COALESCE(SUM(length(COALESCE(ocr_text,''))), 0)
FROM ocr_frames
WHERE date(datetime(timestamp/1000,'unixepoch','localtime'))='${DAY}';
SELECT 'apps_with_ocr', COUNT(DISTINCT COALESCE(app_name, ''))
FROM ocr_frames
WHERE date(datetime(timestamp/1000,'unixepoch','localtime'))='${DAY}';
SQL

sqlite3 "${DB_PATH}" <<SQL > "${OUT_DIR}/top_apps.tsv"
.headers on
.mode tabs
SELECT
  COALESCE(app_name, '') AS app_name,
  COUNT(*) AS frames,
  COALESCE(SUM(length(COALESCE(ocr_text,''))), 0) AS ocr_chars
FROM ocr_frames
WHERE date(datetime(timestamp/1000,'unixepoch','localtime'))='${DAY}'
GROUP BY COALESCE(app_name, '')
ORDER BY ocr_chars DESC, frames DESC
LIMIT 25;
SQL

sqlite3 "${DB_PATH}" <<SQL > "${OUT_DIR}/top_window_titles.tsv"
.headers on
.mode tabs
SELECT
  COALESCE(window_title, '') AS window_title,
  COUNT(*) AS frames,
  COALESCE(SUM(length(COALESCE(ocr_text,''))), 0) AS ocr_chars
FROM ocr_frames
WHERE date(datetime(timestamp/1000,'unixepoch','localtime'))='${DAY}'
  AND COALESCE(window_title, '') <> ''
GROUP BY COALESCE(window_title, '')
ORDER BY ocr_chars DESC, frames DESC
LIMIT 25;
SQL

sqlite3 "${DB_PATH}" <<SQL > "${OUT_DIR}/sample_frames.tsv"
.headers on
.mode tabs
SELECT
  time(datetime(timestamp/1000,'unixepoch','localtime')) AS local_time,
  COALESCE(app_name, '') AS app_name,
  COALESCE(window_title, '') AS window_title,
  substr(replace(replace(COALESCE(ocr_text, ''), char(10), ' '), char(13), ' '), 1, 240) AS ocr_excerpt
FROM ocr_frames
WHERE date(datetime(timestamp/1000,'unixepoch','localtime'))='${DAY}'
  AND length(COALESCE(ocr_text, '')) > 300
ORDER BY length(COALESCE(ocr_text, '')) DESC, timestamp ASC
LIMIT 60;
SQL

sqlite3 -json "${DB_PATH}" "
SELECT
  id,
  datetime(timestamp/1000,'unixepoch','localtime') AS timestamp_local,
  COALESCE(app_name, '') AS app_name,
  COALESCE(window_title, '') AS window_title,
  COALESCE(summary, '') AS summary,
  COALESCE(activity_type, '') AS activity_type,
  text_quality,
  ocr_confidence,
  COALESCE(ocr_text, '') AS ocr_text
FROM ocr_frames
WHERE date(datetime(timestamp/1000,'unixepoch','localtime'))='${DAY}'
ORDER BY timestamp;
" > "${OUT_DIR}/ocr_frames.json"

echo "Exported historical OCR day to ${OUT_DIR}"
