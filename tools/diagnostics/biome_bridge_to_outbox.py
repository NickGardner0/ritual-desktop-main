#!/usr/bin/env python3
"""Append a Biome JSONL export into the current user's Ritual desktop outbox.

Intended flow:
1. Run `ritual-watcher --biome-export-jsonl /Users/Shared/ritual-biome-iphone-export.jsonl`
   from the macOS account that has the iPhone Biome data.
2. Run this script from the macOS account that normally runs Ritual.

The existing authenticated Tauri desktop app will drain the outbox to the backend.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

IGNORED_BIOME_BUNDLE_IDS = {
    "com.apple.carplaysplashscreen",
    "com.apple.control-center",
    "com.apple.screenshotservicesservice",
    "com.apple.sleeplockscreen",
}
IGNORED_BIOME_BUNDLE_PREFIXES = ("com.apple.springboard",)


def default_outbox_path() -> Path:
    return Path.home() / "Library" / "Application Support" / "Ritual" / "biome_iphone_events.jsonl"


def default_cursor_path() -> Path:
    return Path.home() / "Library" / "Application Support" / "Ritual" / "biome_committed_cursors.json"


def event_key(event: dict[str, Any]) -> str:
    return f"biome:{event.get('device_id')}:{event.get('app_bundle_id')}:{event.get('ts_start')}"


def is_ignored_biome_bundle(bundle_id: str) -> bool:
    normalized = (bundle_id or "").strip().lower()
    return normalized in IGNORED_BIOME_BUNDLE_IDS or any(
        normalized == prefix or normalized.startswith(prefix + ".")
        for prefix in IGNORED_BIOME_BUNDLE_PREFIXES
    )


def read_jsonl(path: Path) -> tuple[list[dict[str, Any]], list[str], list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    malformed: list[str] = []
    ignored: list[dict[str, Any]] = []
    if not path.exists():
        return events, malformed, ignored
    for line_no, line in enumerate(path.read_text(errors="replace").splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            event = json.loads(stripped)
            if not isinstance(event, dict):
                raise ValueError("line is not an object")
            for field in ("device_id", "app_bundle_id", "ts_start", "ts_end"):
                if event.get(field) in (None, ""):
                    raise ValueError(f"missing {field}")
            if is_ignored_biome_bundle(str(event.get("app_bundle_id") or "")):
                ignored.append(event)
            else:
                events.append(event)
        except Exception as exc:
            malformed.append(json.dumps({"line": line_no, "error": str(exc), "raw": stripped}))
    return events, malformed, ignored


def merge_events(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int, int]:
    merged: dict[str, dict[str, Any]] = {}
    for event in existing:
        merged[event_key(event)] = event

    added = 0
    updated = 0
    for event in incoming:
        key = event_key(event)
        current = merged.get(key)
        if current is None:
            merged[key] = event
            added += 1
            continue

        changed = False
        if int(event.get("ts_end") or 0) > int(current.get("ts_end") or 0):
            current["ts_end"] = event["ts_end"]
            changed = True
        if current.get("biome_is_provisional") and not event.get("biome_is_provisional"):
            current["biome_is_provisional"] = False
            changed = True
        for field in (
            "event_uid",
            "app_name",
            "window_title",
            "browser_url",
            "browser_domain",
            "source_file",
            "app_version",
            "app_build",
            "transition_reason",
        ):
            if not current.get(field) and event.get(field):
                current[field] = event[field]
                changed = True
        if changed:
            updated += 1

    output = list(merged.values())
    output.sort(key=lambda item: (int(item.get("ts_start") or 0), int(item.get("ts_end") or 0)))
    return output, added, updated


def read_committed_cursors(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text())
    except Exception:
        return {}
    if isinstance(raw, dict) and isinstance(raw.get("devices"), dict):
        raw = raw["devices"]
    if not isinstance(raw, dict):
        return {}
    cursors: dict[str, int] = {}
    for device_id, value in raw.items():
        try:
            cursors[str(device_id)] = int(value)
        except Exception:
            continue
    return cursors


def filter_committed(events: list[dict[str, Any]], cursors: dict[str, int]) -> tuple[list[dict[str, Any]], int]:
    if not cursors:
        return events, 0
    pending: list[dict[str, Any]] = []
    skipped = 0
    for event in events:
        device_id = str(event.get("device_id") or "")
        committed_end = cursors.get(device_id)
        if committed_end is not None and int(event.get("ts_end") or 0) <= committed_end:
            skipped += 1
        else:
            pending.append(event)
    return pending, skipped


def write_jsonl(path: Path, events: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(json.dumps(event, separators=(",", ":")) + "\n" for event in events)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(body)
        Path(tmp_name).replace(path)
    finally:
        tmp = Path(tmp_name)
        if tmp.exists():
            tmp.unlink()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "export_jsonl",
        nargs="?",
        default="/Users/Shared/ritual-biome-iphone-export.jsonl",
        help="Biome export JSONL produced by ritual-watcher --biome-export-jsonl.",
    )
    parser.add_argument(
        "--outbox",
        default=str(default_outbox_path()),
        help="Current user's Ritual Biome outbox path.",
    )
    parser.add_argument(
        "--cursors",
        default=str(default_cursor_path()),
        help="Current user's committed cursor path.",
    )
    parser.add_argument(
        "--ignore-cursors",
        action="store_true",
        help="Queue all export rows even if committed cursors say they were already uploaded.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    export_path = Path(args.export_jsonl)
    outbox_path = Path(args.outbox)
    cursor_path = Path(args.cursors)
    cursors = {} if args.ignore_cursors else read_committed_cursors(cursor_path)
    incoming, malformed_incoming, ignored_incoming = read_jsonl(export_path)
    incoming, skipped_committed = filter_committed(incoming, cursors)
    existing, malformed_existing, ignored_existing = read_jsonl(outbox_path)
    merged, added, updated = merge_events(existing, incoming)

    if not args.dry_run:
        write_jsonl(outbox_path, merged)
        if malformed_incoming or malformed_existing:
            quarantine = outbox_path.with_name(f"{outbox_path.name}.bridge-malformed.jsonl")
            quarantine.write_text("\n".join([*malformed_existing, *malformed_incoming]) + "\n")

    print(
        json.dumps(
            {
                "export_path": str(export_path),
                "outbox_path": str(outbox_path),
                "cursor_path": str(cursor_path),
                "committed_cursor_devices": len(cursors),
                "incoming_events": len(incoming),
                "existing_events": len(existing),
                "added": added,
                "updated": updated,
                "final_outbox_events": len(merged),
                "skipped_already_committed": skipped_committed,
                "malformed_incoming": len(malformed_incoming),
                "malformed_existing": len(malformed_existing),
                "ignored_system_ui_incoming": len(ignored_incoming),
                "ignored_system_ui_existing": len(ignored_existing),
                "dry_run": args.dry_run,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
