"""Shared local watcher DB helper functions."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import List, Tuple


def _allow_legacy_reads() -> bool:
    return (os.environ.get("RITUAL_ALLOW_LEGACY_DB_READS") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _has_table(path: str, table_name: str) -> bool:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1.0)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type='table' AND name=?
            LIMIT 1
            """,
            (table_name,),
        )
        exists = cursor.fetchone() is not None
        conn.close()
        return exists
    except Exception:
        return False


def _resolve_db_path(
    *,
    override_env: str,
    preferred_path: str,
    fallback_path: str,
    required_table: str,
    legacy_candidates: List[str],
) -> str:
    override_path = os.environ.get(override_env)
    if override_path and os.path.exists(override_path):
        return override_path

    if os.path.exists(preferred_path):
        try:
            if os.path.getsize(preferred_path) > 0 and _has_table(preferred_path, required_table):
                return preferred_path
        except OSError:
            pass

    if os.path.exists(fallback_path):
        try:
            if os.path.getsize(fallback_path) > 0 and _has_table(fallback_path, required_table):
                return fallback_path
        except OSError:
            pass

    if _allow_legacy_reads():
        for path in legacy_candidates:
            if not os.path.exists(path):
                continue
            try:
                if os.path.getsize(path) == 0:
                    continue
            except OSError:
                continue
            if _has_table(path, required_table):
                return path

        for path in legacy_candidates:
            if os.path.exists(path):
                return path

    return preferred_path


def get_local_activity_db_path_impl() -> str:
    """Resolve the local activity DB path (watcher + sync queue)."""
    home = os.environ.get("HOME") or str(Path.home())
    ritual_dir = os.path.join(home, ".ritual")
    return _resolve_db_path(
        override_env="RITUAL_ACTIVITY_DB_PATH",
        preferred_path=os.path.join(ritual_dir, "activity.db"),
        fallback_path=os.path.join(ritual_dir, "ritual.db"),
        required_table="activity_events",
        legacy_candidates=[
            os.path.join(ritual_dir, "watcher.db"),
            os.path.join(ritual_dir, "watcher.db.migrated"),
        ],
    )


def get_local_memory_db_path_impl() -> str:
    """Resolve the local memory DB path (OCR/chunks/embeddings/outbox)."""
    home = os.environ.get("HOME") or str(Path.home())
    ritual_dir = os.path.join(home, ".ritual")
    return _resolve_db_path(
        override_env="RITUAL_MEMORY_DB_PATH",
        preferred_path=os.path.join(ritual_dir, "memory.db"),
        fallback_path=os.path.join(ritual_dir, "ritual.db"),
        required_table="search_chunks",
        legacy_candidates=[
            os.path.join(ritual_dir, "frames.db"),
            os.path.join(ritual_dir, "frames.db.migrated"),
        ],
    )


def get_local_watcher_db_path_impl() -> str:
    """
    Back-compat alias for existing activity-oriented call sites.
    """
    return get_local_activity_db_path_impl()


def merge_time_intervals_impl(intervals: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """Merge overlapping (start_ms, end_ms) intervals."""
    if not intervals:
        return []

    sorted_intervals = sorted(intervals, key=lambda interval: interval[0])
    merged: List[Tuple[int, int]] = []
    current_start, current_end = sorted_intervals[0]

    for start, end in sorted_intervals[1:]:
        if start <= current_end:
            current_end = max(current_end, end)
            continue
        merged.append((current_start, current_end))
        current_start, current_end = start, end

    merged.append((current_start, current_end))
    return merged
