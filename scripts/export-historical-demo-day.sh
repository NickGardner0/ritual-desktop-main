#!/usr/bin/env bash

set -euo pipefail

DAY="${1:-2026-03-19}"
DB_PATH="${2:-/Users/nickgardner/.ritual/activity.db}"
OUT_DIR="${3:-/Users/nickgardner/Desktop/ritual-desktop-main/tmp/historical-demo-${DAY}}"

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
SELECT 'context_snapshots', COUNT(*)
FROM context_snapshots
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}';
SELECT 'session_retrieval_docs', COUNT(*)
FROM session_retrieval_docs
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}';
SELECT 'context_chars', COALESCE(SUM(length(COALESCE(visible_text_raw,''))), 0)
FROM context_snapshots
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}';
SELECT 'retrieval_chars', COALESCE(SUM(length(COALESCE(contextual_retrieval_text,''))), 0)
FROM session_retrieval_docs
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}';
SQL

sqlite3 "${DB_PATH}" <<SQL > "${OUT_DIR}/source_type_counts.tsv"
.headers on
.mode tabs
SELECT
  source_type,
  COUNT(*) AS rows
FROM context_snapshots
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}'
GROUP BY source_type
ORDER BY rows DESC;
SQL

sqlite3 "${DB_PATH}" <<SQL > "${OUT_DIR}/top_apps.tsv"
.headers on
.mode tabs
SELECT
  app_name,
  COUNT(*) AS rows,
  COALESCE(SUM(length(COALESCE(visible_text_raw,''))), 0) AS visible_chars
FROM context_snapshots
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}'
GROUP BY app_name
ORDER BY visible_chars DESC, rows DESC
LIMIT 25;
SQL

sqlite3 "${DB_PATH}" <<SQL > "${OUT_DIR}/top_domains.tsv"
.headers on
.mode tabs
SELECT
  COALESCE(browser_domain, '') AS browser_domain,
  COUNT(*) AS rows,
  COALESCE(SUM(length(COALESCE(visible_text_raw,''))), 0) AS visible_chars
FROM context_snapshots
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}'
  AND COALESCE(browser_domain, '') <> ''
GROUP BY browser_domain
ORDER BY visible_chars DESC, rows DESC
LIMIT 25;
SQL

sqlite3 -json "${DB_PATH}" "
SELECT
  id,
  session_id,
  datetime(chunk_start_ts/1000,'unixepoch','localtime') AS chunk_start_local,
  datetime(chunk_end_ts/1000,'unixepoch','localtime') AS chunk_end_local,
  app_name,
  COALESCE(browser_domain, '') AS browser_domain,
  COALESCE(window_title, '') AS window_title,
  COALESCE(document_title, '') AS document_title,
  capture_quality,
  contextual_retrieval_text
FROM session_retrieval_docs
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}'
ORDER BY chunk_start_ts;
" > "${OUT_DIR}/session_retrieval_docs.json"

sqlite3 -json "${DB_PATH}" "
SELECT
  id,
  datetime(created_at/1000,'unixepoch','localtime') AS created_local,
  source_type,
  app_name,
  COALESCE(browser_domain, '') AS browser_domain,
  COALESCE(window_title, '') AS window_title,
  COALESCE(browser_url, '') AS browser_url,
  length(COALESCE(visible_text_raw, '')) AS visible_chars,
  COALESCE(visible_text_raw, '') AS visible_text_raw,
  COALESCE(semantic_summary, '') AS semantic_summary
FROM context_snapshots
WHERE date(datetime(created_at/1000,'unixepoch','localtime'))='${DAY}'
ORDER BY created_at;
" > "${OUT_DIR}/context_snapshots.json"

echo "Exported historical demo day to ${OUT_DIR}"
