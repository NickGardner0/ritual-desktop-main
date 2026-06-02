#!/usr/bin/env python3
"""Inspect the current macOS user's Apple Biome App.InFocus source state.

Run this from the macOS account that is signed into the same iCloud account as
the iPhone. It writes a JSON report to /Users/Shared by default so another local
account can inspect the result without needing direct access to ~/Library/Biome.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any


def _sqlite_count(db_path: Path, query: str) -> tuple[int | None, str | None]:
    if not db_path.exists():
        return 0, None
    try:
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
        try:
            row = conn.execute(query).fetchone()
            return int(row[0] or 0), None
        finally:
            conn.close()
    except Exception as exc:
        return None, str(exc)


def _source_file_stats(remote_path: Path) -> tuple[list[dict[str, Any]], int, int]:
    if not remote_path.exists():
        return [], 0, 0

    devices: list[dict[str, Any]] = []
    total_files = 0
    total_bytes = 0

    for folder in sorted(remote_path.iterdir(), key=lambda item: item.name):
        if not folder.is_dir():
            continue
        file_count = 0
        byte_count = 0
        newest_mtime_ms: int | None = None
        oldest_mtime_ms: int | None = None
        sample_files: list[str] = []

        try:
            children = sorted(folder.iterdir(), key=lambda item: item.name)
        except Exception as exc:
            devices.append(
                {
                    "device_id": folder.name,
                    "path": str(folder),
                    "path_exists": folder.exists(),
                    "error": str(exc),
                    "source_file_count": 0,
                    "source_file_bytes": 0,
                    "newest_source_file_mtime_ms": None,
                    "oldest_source_file_mtime_ms": None,
                    "sample_files": [],
                }
            )
            continue

        for child in children:
            if not child.is_file() or child.name.startswith(".") or child.name == "lock":
                continue
            try:
                stat = child.stat()
            except Exception:
                continue
            mtime_ms = int(stat.st_mtime * 1000)
            file_count += 1
            byte_count += int(stat.st_size)
            newest_mtime_ms = mtime_ms if newest_mtime_ms is None else max(newest_mtime_ms, mtime_ms)
            oldest_mtime_ms = mtime_ms if oldest_mtime_ms is None else min(oldest_mtime_ms, mtime_ms)
            if len(sample_files) < 5:
                sample_files.append(child.name)

        total_files += file_count
        total_bytes += byte_count
        devices.append(
            {
                "device_id": folder.name,
                "path": str(folder),
                "path_exists": folder.exists(),
                "source_file_count": file_count,
                "source_file_bytes": byte_count,
                "newest_source_file_mtime_ms": newest_mtime_ms,
                "oldest_source_file_mtime_ms": oldest_mtime_ms,
                "sample_files": sample_files,
            }
        )

    return devices, total_files, total_bytes


def build_report() -> dict[str, Any]:
    home = Path.home()
    sync_db = home / "Library" / "Biome" / "sync" / "sync.db"
    remote = home / "Library" / "Biome" / "streams" / "restricted" / "App.InFocus" / "remote"
    outbox = home / "Library" / "Application Support" / "Ritual" / "biome_iphone_events.jsonl"
    cursors = home / "Library" / "Application Support" / "Ritual" / "biome_committed_cursors.json"

    ios_count, ios_error = _sqlite_count(
        sync_db,
        "SELECT count(DISTINCT device_identifier) FROM DevicePeer WHERE platform = 2",
    )
    all_device_count, all_device_error = _sqlite_count(
        sync_db,
        "SELECT count(DISTINCT device_identifier) FROM DevicePeer",
    )
    devices, source_file_count, source_file_bytes = _source_file_stats(remote)

    notes: list[str] = []
    if not sync_db.exists():
        notes.append("Biome sync.db is missing for this macOS user.")
    elif ios_count == 0:
        notes.append("sync.db exists, but has no iOS DevicePeer rows.")
    if not remote.exists():
        notes.append("App.InFocus remote directory is missing.")
    elif source_file_count == 0:
        notes.append("App.InFocus remote directory exists, but contains no readable source files.")
    if source_file_count > 0:
        notes.append("This account has local Biome App.InFocus source files that Ritual can parse.")

    return {
        "generated_at_ms": int(time.time() * 1000),
        "macos_user": os.environ.get("USER"),
        "home": str(home),
        "sync_db_path": str(sync_db),
        "sync_db_exists": sync_db.exists(),
        "ios_device_peer_count": ios_count,
        "ios_device_peer_error": ios_error,
        "all_device_peer_count": all_device_count,
        "all_device_peer_error": all_device_error,
        "app_in_focus_remote_path": str(remote),
        "app_in_focus_remote_exists": remote.exists(),
        "device_folder_count": len(devices),
        "source_file_count": source_file_count,
        "source_file_bytes": source_file_bytes,
        "devices": devices,
        "ritual_biome_outbox_path": str(outbox),
        "ritual_biome_outbox_exists": outbox.exists(),
        "ritual_biome_committed_cursors_path": str(cursors),
        "ritual_biome_committed_cursors_exists": cursors.exists(),
        "notes": notes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="/Users/Shared/ritual-biome-diagnostic.json",
        help="Where to write the JSON diagnostic report.",
    )
    args = parser.parse_args()

    report = build_report()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2, sort_keys=True))
    print(f"\nWrote {output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
