#!/usr/bin/env python3
"""Export FastAPI OpenAPI JSON for typed dashboard client generation."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "apps" / "backend"

os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")
os.environ.setdefault("DATABASE_URL", "sqlite:///openapi-export.db")
os.environ.setdefault("ENABLE_STARTUP_MAINTENANCE_TASK", "0")

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from main import app  # noqa: E402


def main() -> None:
    output = BACKEND_ROOT / "openapi.json"
    output.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
