#!/usr/bin/env python3
"""Export FastAPI OpenAPI JSON for typed dashboard client generation."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import argparse
from collections import defaultdict


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "apps" / "backend"

os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")
os.environ.setdefault("DATABASE_URL", "sqlite:///openapi-export.db")
os.environ.setdefault("ENABLE_STARTUP_MAINTENANCE_TASK", "0")

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from main import app  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Destination for the deterministic OpenAPI JSON document.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    duplicate_routes: dict[tuple[str, str], list[str]] = defaultdict(list)
    for route in app.routes:
        path = getattr(route, "path", None)
        endpoint = getattr(route, "endpoint", None)
        if not path or endpoint is None:
            continue
        label = f"{endpoint.__module__}.{endpoint.__name__}"
        for method in sorted(getattr(route, "methods", set()) or set()):
            duplicate_routes[(method, path)].append(label)
    conflicts = {
        key: labels for key, labels in duplicate_routes.items() if len(labels) > 1
    }
    if conflicts:
        lines = [
            f"{method} {path}: {', '.join(labels)}"
            for (method, path), labels in sorted(conflicts.items())
        ]
        raise RuntimeError("Duplicate FastAPI routes cannot be generated:\n" + "\n".join(lines))

    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        label = output.relative_to(ROOT)
    except ValueError:
        label = output
    print(f"Wrote {label}")


if __name__ == "__main__":
    main()
