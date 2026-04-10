#!/usr/bin/env python3
"""Operator CLI for per-user Turso provisioning, verification, and cleanup."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import libsql_experimental as libsql
from dotenv import load_dotenv
from libsql_client import create_client

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

from services.turso_user_service import TursoProvisioningError, turso_user_service

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
MAIN_DB_OPERATOR_REPLICA = BACKEND_DIR / ".turso_operator_main.db"

AUDIT_TABLES = {
    "activity_events": "ts_end",
    "context_snapshots": "ts",
    "session_retrieval_docs": "chunk_end_ts",
}

CLEANUP_PARITY_TABLES = {
    "activity_events": "ts_end",
    "afk_events": "ts_end",
    "context_sessions": "end_ts",
    "context_snapshots": "ts",
    "session_retrieval_docs": "chunk_end_ts",
}

MAIN_DB_ARCHIVE_DELETE_TABLES = (
    "session_retrieval_docs",
    "context_snapshots",
    "afk_events",
    "activity_events",
    "context_sessions",
)

ARCHIVE_BATCH_SIZE = 5000


def _iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _jsonable_record(record: dict) -> dict:
    normalized = {}
    for key, value in record.items():
        if isinstance(value, datetime):
            normalized[key] = value.astimezone(timezone.utc).isoformat()
        elif hasattr(value, "isoformat"):
            normalized[key] = value.isoformat()
        else:
            normalized[key] = value
    return normalized


def _require_main_database_details() -> tuple[str, str]:
    if not DATABASE_URL.startswith("libsql://"):
        raise TursoProvisioningError("DATABASE_URL must point to the main ritual Turso database")

    parsed = urlparse(DATABASE_URL)
    auth_token = (parse_qs(parsed.query).get("authToken", [""])[0] or "").strip()
    if not parsed.hostname or not auth_token:
        raise TursoProvisioningError("DATABASE_URL must include a Turso hostname and authToken")

    return (f"libsql://{parsed.hostname}", auth_token)


def _connect_main_db():
    sync_url, auth_token = _require_main_database_details()
    conn = libsql.connect(str(MAIN_DB_OPERATOR_REPLICA), sync_url=sync_url, auth_token=auth_token)
    conn.sync()
    return conn


def _query_main_db(sql: str, params: tuple | list = ()) -> list[dict]:
    conn = _connect_main_db()
    try:
        cursor = conn.execute(sql, params)
        columns = [column[0] for column in (cursor.description or [])]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        conn.close()


def _execute_main_db(sql: str, params: tuple | list = ()) -> int:
    conn = _connect_main_db()
    try:
        before = int(getattr(conn, "total_changes", 0) or 0)
        conn.execute(sql, params)
        conn.commit()
        conn.sync()
        after = int(getattr(conn, "total_changes", before) or before)
        return max(0, after - before)
    finally:
        conn.close()


def _get_user_record(user_id: str) -> dict | None:
    rows = _query_main_db(
        """
        SELECT
            id AS user_id,
            email,
            turso_db_name,
            turso_db_url,
            turso_provisioned_at,
            turso_migrated_at,
            created_at
        FROM users
        WHERE id = ?
        LIMIT 1
        """,
        (user_id,),
    )
    return rows[0] if rows else None


async def _list_users() -> list[dict]:
    rows = _query_main_db(
        """
        SELECT
            id AS user_id,
            email,
            turso_db_name,
            turso_db_url,
            turso_provisioned_at,
            turso_migrated_at,
            created_at
        FROM users
        ORDER BY created_at ASC, id ASC
        """
    )

    return [
        {
            "user_id": row["user_id"],
            "email": row["email"],
            "turso_db_name": row["turso_db_name"],
            "turso_db_url": row["turso_db_url"],
            "turso_provisioned_at": _iso(row["turso_provisioned_at"]),
            "turso_migrated_at": _iso(row["turso_migrated_at"]),
            "created_at": _iso(row["created_at"]),
        }
        for row in rows
    ]


async def _verify_db_name(database_name: str) -> dict:
    users = _query_main_db(
        """
        SELECT
            id AS user_id,
            email,
            turso_db_name,
            turso_provisioned_at,
            turso_migrated_at,
            created_at
        FROM users
        WHERE turso_db_name = ?
        ORDER BY created_at ASC
        """,
        (database_name,),
    )

    return {
        "database_name": database_name,
        "referenced_by": [
            {
                "user_id": user["user_id"],
                "email": user["email"],
                "turso_db_name": user["turso_db_name"],
                "turso_provisioned_at": _iso(user["turso_provisioned_at"]),
                "turso_migrated_at": _iso(user["turso_migrated_at"]),
            }
            for user in users
        ],
        "safe_to_delete": len(users) == 0,
    }


async def _fetch_main_db_stats(user_id: str, table_name: str, max_column: str) -> dict:
    rows = _query_main_db(
        f"""
        SELECT COUNT(*) AS row_count, MAX({max_column}) AS max_value
        FROM {table_name}
        WHERE user_id = ?
        """,
        (user_id,),
    )
    row = rows[0] if rows else {}
    return {
        "count": int((row.get("row_count") if row else 0) or 0),
        "max_timestamp": row.get("max_value") if row else None,
    }


async def _fetch_remote_db_stats(user: dict, table_name: str, max_column: str) -> dict:
    database_name = (user.get("turso_db_name") or "").strip()
    database_url = (user.get("turso_db_url") or "").strip()
    if not database_name or not database_url:
        return {
            "count": 0,
            "max_timestamp": None,
            "source": "legacy_fallback",
            "expected_remote": False,
            "error": "no_per_user_turso_metadata",
        }

    if not turso_user_service.is_platform_configured():
        return {
            "count": 0,
            "max_timestamp": None,
            "source": "sync_pending",
            "expected_remote": True,
            "error": "turso_platform_api_not_configured",
        }

    token, _ = await turso_user_service.get_cached_database_token(
        database_name,
        expiration=turso_user_service.server_token_ttl,
        authorization="full-access",
        reuse_window_seconds=600,
    )
    client = create_client(
        turso_user_service.client_url_for_sync_url(database_url),
        auth_token=token,
    )
    try:
        result_set = await client.execute(
            f"""
            SELECT COUNT(*) AS row_count, MAX({max_column}) AS max_value
            FROM {table_name}
            WHERE user_id = ?
            """,
            [user["user_id"]],
        )
        row_count = 0
        max_value = None
        if result_set.rows:
            first = result_set.rows[0]
            row_count = int((first[0] if len(first) > 0 else 0) or 0)
            max_value = first[1] if len(first) > 1 else None

        return {
            "count": row_count,
            "max_timestamp": max_value,
            "source": "turso_remote",
            "expected_remote": True,
            "error": None,
        }
    except Exception as exc:
        return {
            "count": 0,
            "max_timestamp": None,
            "source": "sync_pending",
            "expected_remote": True,
            "error": str(exc),
        }
    finally:
        await client.close()


async def _audit_user_tables(user_id: str, tables: dict[str, str]) -> dict:
    user = _get_user_record(user_id)
    if user is None:
        raise TursoProvisioningError(f"User {user_id} not found")

    table_audits = {}
    for table_name, max_column in tables.items():
        main_stats, remote_stats = await asyncio.gather(
            _fetch_main_db_stats(user_id, table_name, max_column),
            _fetch_remote_db_stats(user, table_name, max_column),
        )
        table_audits[table_name] = {
            "main_db": main_stats,
            "per_user_turso": remote_stats,
            "count_match": main_stats["count"] == remote_stats["count"],
            "max_timestamp_match": main_stats["max_timestamp"] == remote_stats["max_timestamp"],
        }

    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "turso_db_name": user["turso_db_name"],
        "turso_db_url": user["turso_db_url"],
        "turso_provisioned_at": _iso(user["turso_provisioned_at"]),
        "turso_migrated_at": _iso(user["turso_migrated_at"]),
        "tables": table_audits,
    }


async def _audit_user(user_id: str) -> dict:
    return await _audit_user_tables(user_id, AUDIT_TABLES)


async def _archive_main_db_table(user_id: str, table_name: str, output_path: Path) -> dict:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    archived = 0
    last_id = 0

    with output_path.open("w", encoding="utf-8") as handle:
        while True:
            rows = _query_main_db(
                f"""
                SELECT *
                FROM {table_name}
                WHERE user_id = ? AND id > ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (user_id, last_id, ARCHIVE_BATCH_SIZE),
            )

            if not rows:
                break

            for row in rows:
                payload = _jsonable_record(dict(row))
                handle.write(json.dumps(payload, ensure_ascii=True))
                handle.write("\n")
                archived += 1
                last_id = int(payload["id"])

    return {"table": table_name, "archived_rows": archived, "path": str(output_path)}


async def _delete_main_db_table_rows(user_id: str, table_name: str) -> int:
    return _execute_main_db(
        f"DELETE FROM {table_name} WHERE user_id = ?",
        (user_id,),
    )


async def _cleanup_user_main_db(
    user_id: str,
    *,
    archive_root: Path,
    execute: bool,
) -> dict:
    audit = await _audit_user_tables(user_id, CLEANUP_PARITY_TABLES)
    parity_checks = []
    remote_sources = []
    for table_name, table_audit in audit["tables"].items():
        remote_source = table_audit["per_user_turso"].get("source")
        remote_sources.append(remote_source)
        parity_checks.append(
            bool(
                table_audit["count_match"]
                and table_audit["max_timestamp_match"]
                and remote_source == "turso_remote"
                and not table_audit["per_user_turso"].get("error")
            )
        )

    archive_dir = archive_root / user_id
    dry_run_plan = [
        {
            "table": table_name,
            "row_count": audit["tables"][table_name]["main_db"]["count"],
            "archive_path": str(archive_dir / f"{table_name}.jsonl"),
        }
        for table_name in MAIN_DB_ARCHIVE_DELETE_TABLES
    ]

    result = {
        "user_id": audit["user_id"],
        "email": audit["email"],
        "turso_db_name": audit["turso_db_name"],
        "turso_db_url": audit["turso_db_url"],
        "parity_ok": all(parity_checks),
        "remote_sources": remote_sources,
        "tables": audit["tables"],
        "planned_tables": dry_run_plan,
    }

    total_main_rows = sum(item["row_count"] for item in dry_run_plan)
    if total_main_rows == 0:
        result["parity_ok"] = True
        result["status"] = "already_clean"
        result["reason"] = "no_main_db_rows_found_for_user"
        result["archive_dir"] = str(archive_dir)
        return result

    if not result["parity_ok"]:
        result["status"] = "blocked"
        result["reason"] = "per-user Turso parity verification failed"
        return result

    if not execute:
        result["status"] = "ready"
        result["archive_dir"] = str(archive_dir)
        return result

    archive_dir.mkdir(parents=True, exist_ok=True)
    archived = []
    deleted = []
    for table_name in MAIN_DB_ARCHIVE_DELETE_TABLES:
        archived_meta = await _archive_main_db_table(
            user_id,
            table_name,
            archive_dir / f"{table_name}.jsonl",
        )
        deleted_rows = await _delete_main_db_table_rows(user_id, table_name)
        archived.append(archived_meta)
        deleted.append({"table": table_name, "deleted_rows": deleted_rows})

    manifest = {
        "user_id": audit["user_id"],
        "email": audit["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tables": archived,
    }
    manifest_path = archive_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    result["status"] = "deleted"
    result["archive_dir"] = str(archive_dir)
    result["manifest_path"] = str(manifest_path)
    result["archived"] = archived
    result["deleted"] = deleted
    return result


async def _delete_orphan_database(database_name: str, *, execute: bool) -> dict:
    verification = await _verify_db_name(database_name)
    result = {
        "database_name": database_name,
        "safe_to_delete": verification["safe_to_delete"],
        "referenced_by": verification["referenced_by"],
    }

    if "-import-" not in database_name:
        result["status"] = "blocked"
        result["reason"] = "only import databases may be deleted with this command"
        return result

    if not verification["safe_to_delete"]:
        result["status"] = "blocked"
        result["reason"] = "database is still referenced by active user metadata"
        return result

    if not execute:
        result["status"] = "ready"
        return result

    deleted = await turso_user_service.delete_database(database_name)
    result["status"] = "deleted" if deleted else "already_missing"
    result["deleted"] = deleted
    return result


async def _run(args: argparse.Namespace) -> int:
    try:
        if args.list_users:
            print(json.dumps({"action": "list_users", "users": await _list_users()}, indent=2))
            if not args.user_id and not args.verify_db_name and not args.audit_users and not args.cleanup_user_data and not args.delete_orphan_db:
                return 0

        if args.verify_db_name:
            print(
                json.dumps(
                    {"action": "verify_db_name", **(await _verify_db_name(args.verify_db_name))},
                    indent=2,
                )
            )
            if not args.user_id and not args.audit_users and not args.cleanup_user_data and not args.delete_orphan_db:
                return 0

        if args.audit_users:
            audits = []
            for audit_user_id in args.audit_users:
                audits.append(await _audit_user(audit_user_id))
            print(json.dumps({"action": "audit_users", "audits": audits}, indent=2))
            if not args.user_id and not args.cleanup_user_data and not args.delete_orphan_db:
                return 0

        if args.cleanup_user_data:
            archive_root = Path(args.archive_dir).expanduser().resolve()
            cleanup_results = []
            for cleanup_user_id in args.cleanup_user_data:
                cleanup_results.append(
                    await _cleanup_user_main_db(
                        cleanup_user_id,
                        archive_root=archive_root,
                        execute=args.execute,
                    )
                )
            print(json.dumps({"action": "cleanup_user_data", "results": cleanup_results}, indent=2))
            if not args.user_id and not args.delete_orphan_db:
                return 0

        if args.delete_orphan_db:
            delete_result = await _delete_orphan_database(
                args.delete_orphan_db,
                execute=args.execute,
            )
            print(json.dumps({"action": "delete_orphan_db", **delete_result}, indent=2))
            if not args.user_id:
                return 0

        if not args.user_id:
            raise TursoProvisioningError("--user-id is required for provisioning/migration actions")

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
    parser.add_argument("--user-id", help="Clerk user id to provision/migrate")
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
    parser.add_argument(
        "--list-users",
        action="store_true",
        help="Print all users with their assigned per-user Turso DB metadata",
    )
    parser.add_argument(
        "--verify-db-name",
        help="Print which users reference a given Turso database name and whether it is safe to delete",
    )
    parser.add_argument(
        "--audit-users",
        nargs="+",
        help="Audit activity/context table counts and max timestamps in main ritual DB vs assigned per-user Turso DB",
    )
    parser.add_argument(
        "--cleanup-user-data",
        nargs="+",
        help="Dry-run or execute archival/deletion of duplicated main ritual DB activity/context rows after parity verification",
    )
    parser.add_argument(
        "--delete-orphan-db",
        help="Dry-run or delete an unreferenced import Turso DB after metadata verification",
    )
    parser.add_argument(
        "--archive-dir",
        default=str(BACKEND_DIR / ".turso_cleanup_archives"),
        help="Archive directory for cleanup-user-data JSONL exports",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually perform destructive cleanup actions instead of printing a dry run",
    )
    args = parser.parse_args()

    if (
        not args.ensure_provisioned
        and not args.migrate
        and not args.list_users
        and not args.verify_db_name
        and not args.audit_users
        and not args.cleanup_user_data
        and not args.delete_orphan_db
    ):
        args.ensure_provisioned = True

    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
