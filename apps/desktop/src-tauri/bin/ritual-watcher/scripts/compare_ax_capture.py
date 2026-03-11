#!/usr/bin/env python3
"""Compare Ritual AX dump output against macapptree for manual parity checks.

This is a non-production benchmark helper for the native capture upgrade plan.
It assumes `cargo run --bin ritual-ax-dump` is available from the watcher crate
and will use `macapptree` only if it is installed on the local machine.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _run_json(command: list[str], cwd: Path) -> dict[str, Any]:
    result = subprocess.run(
        command,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "command failed")
    return json.loads(result.stdout)


def _flatten_text_attributes(node: dict[str, Any]) -> list[str]:
    values = []
    for attribute in node.get("text_attributes") or []:
        value = str(attribute.get("value") or "").strip()
        if value:
            values.append(value)
    for child in node.get("children") or []:
        values.extend(_flatten_text_attributes(child))
    return values


def _ritual_summary(payload: dict[str, Any]) -> dict[str, Any]:
    focused = payload.get("focused") or {}
    focused_values = _flatten_text_attributes(focused)
    candidate_texts = [str(item.get("text") or "").strip() for item in payload.get("candidates") or []]
    candidate_texts = [item for item in candidate_texts if item]
    return {
        "focused_role": focused.get("role"),
        "document_hint": payload.get("document_hint"),
        "focused_text_attribute_count": len(focused_values),
        "candidate_count": len(candidate_texts),
        "top_candidates": candidate_texts[:8],
    }


def _macapptree_summary(payload: Any) -> dict[str, Any]:
    text_values: list[str] = []

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key.lower() in {"title", "value", "label", "description"} and isinstance(value, str):
                    trimmed = value.strip()
                    if trimmed:
                        text_values.append(trimmed)
                visit(value)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(payload)
    return {
        "node_count_estimate": len(text_values),
        "top_values": text_values[:12],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True, help="Target app PID")
    parser.add_argument("--bundle-id", default="", help="Optional bundle identifier")
    parser.add_argument("--window-title", default="", help="Optional window title hint")
    parser.add_argument(
        "--watcher-dir",
        default=str(Path(__file__).resolve().parents[1]),
        help="Path to the ritual-watcher crate",
    )
    args = parser.parse_args()

    watcher_dir = Path(args.watcher_dir).resolve()
    ritual_payload = _run_json(
        [
            "cargo",
            "run",
            "--quiet",
            "--bin",
            "ritual-ax-dump",
            "--",
            "--pid",
            str(args.pid),
            "--bundle-id",
            args.bundle_id,
            "--window-title",
            args.window_title,
        ],
        watcher_dir,
    )

    output = {
        "ritual": _ritual_summary(ritual_payload),
        "macapptree": None,
    }

    macapptree = shutil.which("macapptree")
    if macapptree:
        try:
            macapptree_payload = _run_json([macapptree, str(args.pid), "--json"], watcher_dir)
            output["macapptree"] = _macapptree_summary(macapptree_payload)
        except Exception as exc:  # pragma: no cover - diagnostic helper
            output["macapptree"] = {"error": str(exc)}
    else:
        output["macapptree"] = {"error": "macapptree not installed"}

    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
