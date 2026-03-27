#!/usr/bin/env python3
"""Operator CLI for per-user Turso provisioning and migration."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

from services.turso_user_service import TursoProvisioningError, turso_user_service


async def _run(args: argparse.Namespace) -> int:
    try:
        if args.ensure_provisioned:
            user = await turso_user_service.ensure_user_activity_database(args.user_id)
            print(
                json.dumps(
                    {
                        "action": "ensure_provisioned",
                        "user_id": args.user_id,
                        "database_name": getattr(user, "turso_db_name", None),
                        "sync_url": getattr(user, "turso_db_url", None),
                        "provisioned_at": (
                            user.turso_provisioned_at.isoformat()
                            if getattr(user, "turso_provisioned_at", None)
                            else None
                        ),
                    },
                    indent=2,
                )
            )

        if args.migrate:
            user = await turso_user_service.migrate_user(args.user_id)
            print(
                json.dumps(
                    {
                        "action": "migrate",
                        "user_id": args.user_id,
                        "database_name": getattr(user, "turso_db_name", None),
                        "migrated_at": (
                            user.turso_migrated_at.isoformat()
                            if getattr(user, "turso_migrated_at", None)
                            else None
                        ),
                    },
                    indent=2,
                )
            )

        status = await turso_user_service.get_user_migration_status(args.user_id)
        print(json.dumps({"action": "status", **status}, indent=2))
        return 0
    except TursoProvisioningError as exc:
        print(json.dumps({"error": str(exc), "user_id": args.user_id}, indent=2), file=sys.stderr)
        return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision/migrate a per-user Turso activity database")
    parser.add_argument("--user-id", required=True, help="Clerk user id to provision/migrate")
    parser.add_argument(
        "--ensure-provisioned",
        action="store_true",
        help="Ensure the per-user Turso DB exists and schema is initialized",
    )
    parser.add_argument(
        "--migrate",
        action="store_true",
        help="Copy this user's rows into the per-user Turso DB and apply migration gate checks",
    )
    args = parser.parse_args()

    if not args.ensure_provisioned and not args.migrate:
        args.ensure_provisioned = True

    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
