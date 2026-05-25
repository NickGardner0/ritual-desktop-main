"""Run explicit Alembic database migrations."""

from __future__ import annotations

import json
from pathlib import Path
import sys

from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def run_migrations(revision: str = "head") -> dict[str, str]:
    config = Config(str(ROOT / "alembic.ini"))
    command.upgrade(config, revision)
    return {"status": "ok", "revision": revision}


def main() -> None:
    summary = run_migrations()
    print(json.dumps(summary, indent=2, sort_keys=True, default=str))


if __name__ == "__main__":
    main()
