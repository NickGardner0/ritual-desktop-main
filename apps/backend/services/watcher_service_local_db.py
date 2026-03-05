"""Shared local watcher DB helper functions."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import List, Tuple


def get_local_watcher_db_path_impl() -> str:
    """
    Resolve the local activity SQLite database path.

    Preferred order:
    1) Explicit override path
    2) Unified ritual.db (canonical)
    3) Legacy watcher.db / watcher.db.migrated (only if explicitly allowed)
    """
    home = os.environ.get("HOME") or str(Path.home())
    ritual_dir = os.path.join(home, ".ritual")
    override_path = os.environ.get("RITUAL_ACTIVITY_DB_PATH")

    def has_activity_events_table(path: str) -> bool:
        try:
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1.0)
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT 1
                FROM sqlite_master
                WHERE type='table' AND name='activity_events'
                LIMIT 1
                """
            )
            exists = cursor.fetchone() is not None
            conn.close()
            return exists
        except Exception:
            return False

    if override_path and os.path.exists(override_path):
        return override_path

    canonical_path = os.path.join(ritual_dir, "ritual.db")
    if os.path.exists(canonical_path):
        try:
            if os.path.getsize(canonical_path) > 0 and has_activity_events_table(canonical_path):
                return canonical_path
        except OSError:
            pass

    allow_legacy_reads = (os.environ.get("RITUAL_ALLOW_LEGACY_DB_READS") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    if allow_legacy_reads:
        legacy_candidates = [
            os.path.join(ritual_dir, "watcher.db"),
            os.path.join(ritual_dir, "watcher.db.migrated"),
        ]

        for path in legacy_candidates:
            if not os.path.exists(path):
                continue
            try:
                if os.path.getsize(path) == 0:
                    continue
            except OSError:
                continue
            if has_activity_events_table(path):
                return path

        for path in legacy_candidates:
            if os.path.exists(path):
                return path

    return canonical_path


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
