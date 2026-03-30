#!/usr/bin/env python3
"""Operator CLI for per-user Turso provisioning and migration."""

from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

from database.connection import init_database
from services.turso_user_service import TursoProvisioningError, turso_user_service


def _ensure_local_operator_schema() -> None:
    replica_path = BACKEND_DIR / ".turso_replica.db"
    if not replica_path.exists():
        return

    required_user_columns = {
        "phone_number": "ALTER TABLE users ADD COLUMN phone_number TEXT",
        "linq_onboarding_welcome_sent_at": "ALTER TABLE users ADD COLUMN linq_onboarding_welcome_sent_at DATETIME",
        "turso_db_name": "ALTER TABLE users ADD COLUMN turso_db_name TEXT",
        "turso_db_url": "ALTER TABLE users ADD COLUMN turso_db_url TEXT",
        "turso_provisioned_at": "ALTER TABLE users ADD COLUMN turso_provisioned_at DATETIME",
        "turso_migrated_at": "ALTER TABLE users ADD COLUMN turso_migrated_at DATETIME",
    }

    conn = sqlite3.connect(replica_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        for column, sql in required_user_columns.items():
            if column not in columns:
                conn.execute(sql)
        conn.commit()
    finally:
        conn.close()


async def _run(args: argparse.Namespace) -> int:
    try:
        _ensure_local_operator_schema()
        await init_database(fast_startup=False)
        source_user_id = (args.source_user_id or "").strip() or None
        source_db_path = Path(args.source_db_path).expanduser().resolve() if args.source_db_path else None
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
            user = await turso_user_service.migrate_user(
                args.user_id,
                source_user_id=source_user_id,
                source_db_path=source_db_path,
                strategy=args.strategy,
            )
            print(
                json.dumps(
                    {
                        "action": "migrate",
                        "strategy": args.strategy,
                        "user_id": args.user_id,
                        "source_user_id": source_user_id or args.user_id,
                        "source_db_path": str(source_db_path) if source_db_path else None,
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

        status = await turso_user_service.get_user_migration_status(
            args.user_id,
            source_user_id=source_user_id,
            source_db_path=source_db_path,
        )
        print(json.dumps({"action": "status", **status}, indent=2))
        return 0
    except TursoProvisioningError as exc:
        print(json.dumps({"error": str(exc), "user_id": args.user_id}, indent=2), file=sys.stderr)
        return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision/migrate a per-user Turso activity database")
    parser.add_argument("--user-id", required=True, help="Clerk user id to provision/migrate")
    parser.add_argument(
        "--source-user-id",
        help="Optional historical source user id to copy from while writing rows to --user-id",
    )
    parser.add_argument(
        "--source-db-path",
        help="Optional SQLite source DB path for one-time backfill (for example ~/.ritual/activity.db)",
    )
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
    parser.add_argument(
        "--strategy",
        choices=("replica", "import"),
        default="replica",
        help="Migration strategy: replica row-copy or import whole filtered SQLite DB into a fresh Turso DB",
    )
    args = parser.parse_args()

    if not args.ensure_provisioned and not args.migrate:
        args.ensure_provisioned = True

    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
