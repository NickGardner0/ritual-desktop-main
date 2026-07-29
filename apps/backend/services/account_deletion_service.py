"""Coordinated, idempotent account deletion across Ritual data stores."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from sqlalchemy import Table, delete, exists, or_, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from database.connection import get_db_session
from database.models import AccountDeletionJobDB, Base, UserDB
from services.privacy_external_erasure import (
    SUPPORTED_EXTERNAL_ERASURE_TARGETS,
    execute_external_erasure,
)
from services.turso_user_service import turso_user_service


logger = logging.getLogger(__name__)

_FINAL_JOB_STATUSES = {"completed", "completed_with_follow_up"}
_CLAIM_TIMEOUT = timedelta(minutes=10)


def _now() -> datetime:
    return datetime.utcnow()


def _email_hash(email: Optional[str]) -> Optional[str]:
    normalized = (email or "").strip().lower()
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _receipt_from_row(row: AccountDeletionJobDB) -> Dict[str, Any]:
    try:
        receipt = json.loads(row.receipt_json or "{}")
    except (TypeError, ValueError):
        receipt = {}
    return {
        "user_id": row.user_id,
        "status": row.status,
        "attempts": int(row.attempts or 0),
        "receipt": receipt,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


async def _claim_job(
    user_id: str,
    *,
    source: str,
    event_id: Optional[str],
) -> tuple[bool, Dict[str, Any]]:
    now = _now()
    stale_before = now - _CLAIM_TIMEOUT

    async with get_db_session() as session:
        await session.execute(
            sqlite_insert(AccountDeletionJobDB)
            .values(
                user_id=user_id,
                event_id=event_id,
                source=source,
                status="pending",
                attempts=0,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(index_elements=["user_id"])
        )
        claim = await session.execute(
            update(AccountDeletionJobDB)
            .where(AccountDeletionJobDB.user_id == user_id)
            .where(
                or_(
                    AccountDeletionJobDB.status.in_(["pending", "partial", "failed"]),
                    (
                        (AccountDeletionJobDB.status == "processing")
                        & (AccountDeletionJobDB.updated_at < stale_before)
                    ),
                )
            )
            .values(
                status="processing",
                attempts=AccountDeletionJobDB.attempts + 1,
                event_id=event_id or AccountDeletionJobDB.event_id,
                source=source,
                last_error=None,
                updated_at=now,
            )
        )
        await session.commit()

        result = await session.execute(
            select(AccountDeletionJobDB).where(AccountDeletionJobDB.user_id == user_id)
        )
        job = result.scalar_one()
        return int(claim.rowcount or 0) == 1, _receipt_from_row(job)


async def _load_user_context(user_id: str) -> Dict[str, Optional[str]]:
    async with get_db_session() as session:
        result = await session.execute(
            select(UserDB.email, UserDB.turso_db_name).where(UserDB.id == user_id)
        )
        row = result.first()
        return {
            "email": row[0] if row else None,
            "turso_db_name": row[1] if row else None,
        }


async def _update_job(
    user_id: str,
    *,
    status: str,
    receipt: Dict[str, Any],
    email_hash: Optional[str] = None,
    last_error: Optional[str] = None,
) -> None:
    now = _now()
    async with get_db_session() as session:
        await session.execute(
            update(AccountDeletionJobDB)
            .where(AccountDeletionJobDB.user_id == user_id)
            .values(
                status=status,
                email_hash=email_hash,
                receipt_json=json.dumps(receipt, sort_keys=True, default=str),
                last_error=last_error,
                updated_at=now,
                completed_at=now if status in _FINAL_JOB_STATUSES else None,
            )
        )
        await session.commit()


def _user_ownership_predicate(
    table: Table,
    user_id: str,
    *,
    memo: Dict[str, Any],
    visiting: set[str],
):
    cached = memo.get(table.name)
    if cached is not None:
        return cached
    if table.name in visiting:
        return None

    visiting.add(table.name)
    terms = []

    if table.name == UserDB.__tablename__:
        terms.append(table.c.id == user_id)
    elif "user_id" in table.c:
        terms.append(table.c.user_id == user_id)

    for foreign_key in table.foreign_keys:
        parent_table = foreign_key.column.table
        local_column = foreign_key.parent
        parent_column = foreign_key.column

        if parent_table.name == UserDB.__tablename__ and parent_column.name == "id":
            terms.append(local_column == user_id)
            continue

        parent_predicate = _user_ownership_predicate(
            parent_table,
            user_id,
            memo=memo,
            visiting=visiting,
        )
        if parent_predicate is None:
            continue
        terms.append(
            exists(
                select(1)
                .select_from(parent_table)
                .where(parent_column == local_column)
                .where(parent_predicate)
            )
        )

    visiting.remove(table.name)
    predicate = or_(*terms) if terms else None
    if predicate is not None:
        memo[table.name] = predicate
    return predicate


async def delete_shared_user_rows(user_id: str) -> Dict[str, Any]:
    """Delete every shared-database row transitively owned by ``user_id``."""

    memo: Dict[str, Any] = {}
    deleted_by_table: Dict[str, int] = {}

    async with get_db_session() as session:
        for table in _account_deletion_table_order():
            if table.name == AccountDeletionJobDB.__tablename__:
                continue
            predicate = _user_ownership_predicate(
                table,
                user_id,
                memo=memo,
                visiting=set(),
            )
            if predicate is None:
                continue
            result = await session.execute(delete(table).where(predicate))
            count = int(result.rowcount or 0)
            if count:
                deleted_by_table[table.name] = count
        await session.commit()

    return {
        "status": "completed",
        "deleted_count": sum(deleted_by_table.values()),
        "tables": deleted_by_table,
    }


def _account_deletion_table_order() -> list[Table]:
    """Return child-first table order while tolerating nullable FK cycles."""

    tables = sorted(Base.metadata.tables.values(), key=lambda item: item.name)
    children: Dict[str, set[Table]] = {table.name: set() for table in tables}
    for child in tables:
        for foreign_key in child.foreign_keys:
            children.setdefault(foreign_key.column.table.name, set()).add(child)

    ordered: list[Table] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(table: Table) -> None:
        if table.name in visited:
            return
        if table.name in visiting:
            return
        visiting.add(table.name)
        for child in sorted(children.get(table.name, set()), key=lambda item: item.name):
            visit(child)
        visiting.remove(table.name)
        visited.add(table.name)
        ordered.append(table)

    for table in tables:
        visit(table)
    return ordered


def _remove_replica_files(replica_path: Path) -> int:
    removed = 0
    for suffix in ("", "-wal", "-shm", "-journal", "-info"):
        candidate = Path(f"{replica_path}{suffix}")
        try:
            candidate.unlink()
            removed += 1
        except FileNotFoundError:
            continue
    return removed


async def _delete_per_user_database(
    user_id: str,
    database_name: Optional[str],
) -> Dict[str, Any]:
    resolved_name = database_name or turso_user_service.build_database_name(user_id)
    replica_path = turso_user_service.replica_path_for_user(user_id)
    try:
        deleted = await turso_user_service.delete_database(resolved_name)
        removed_files = _remove_replica_files(replica_path)
        return {
            "status": "deleted" if deleted else "not_found",
            "database_name": resolved_name,
            "local_replica_files_removed": removed_files,
        }
    except Exception as error:
        logger.exception("Per-user Turso deletion failed for user %s", user_id)
        return {
            "status": "failed",
            "database_name": resolved_name,
            "local_replica_files_removed": 0,
            "error": str(error),
        }


def _external_erasure_has_retryable_failure(receipt: Dict[str, Any]) -> bool:
    successful = {"completed", "deleted"}
    return any(
        item.get("status") not in successful | {"manual_required"}
        for item in receipt.get("targets", [])
    )


async def process_account_deletion(
    user_id: str,
    *,
    source: str,
    event_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Erase a user across stores. Safe to call repeatedly for webhook retries."""

    claimed, existing = await _claim_job(user_id, source=source, event_id=event_id)
    if not claimed:
        return existing

    context = await _load_user_context(user_id)
    hashed_email = _email_hash(context.get("email"))
    receipt: Dict[str, Any] = {
        "source": source,
        "event_id": event_id,
        "external": None,
        "per_user_turso": None,
        "shared_database": None,
    }

    try:
        external_receipt = await execute_external_erasure(
            user_id,
            targets=list(SUPPORTED_EXTERNAL_ERASURE_TARGETS),
            erasure_id=event_id or f"account-delete:{user_id}",
            local_receipt_id=event_id or f"account-delete:{user_id}",
            confirm_external_erasure=True,
        )
        receipt["external"] = external_receipt
    except Exception as error:
        logger.exception("External account erasure failed for user %s", user_id)
        receipt["external"] = {"status": "failed", "error": str(error)}

    receipt["per_user_turso"] = await _delete_per_user_database(
        user_id,
        context.get("turso_db_name"),
    )

    try:
        receipt["shared_database"] = await delete_shared_user_rows(user_id)
    except Exception as error:
        receipt["shared_database"] = {"status": "failed", "error": str(error)}
        await _update_job(
            user_id,
            status="failed",
            receipt=receipt,
            email_hash=hashed_email,
            last_error=str(error),
        )
        raise

    external = receipt.get("external") or {}
    retryable_failure = (
        external.get("status") == "failed"
        or _external_erasure_has_retryable_failure(external)
        or receipt["per_user_turso"].get("status") == "failed"
    )
    manual_follow_up = int(external.get("manual_required_count") or 0) > 0
    if retryable_failure:
        status = "partial"
    elif manual_follow_up:
        status = "completed_with_follow_up"
    else:
        status = "completed"
    await _update_job(
        user_id,
        status=status,
        receipt=receipt,
        email_hash=hashed_email,
    )
    return {
        "user_id": user_id,
        "status": status,
        "receipt": receipt,
    }


async def delete_clerk_identity(user_id: str) -> Dict[str, Any]:
    """Delete the Clerk identity before erasing the authenticated account."""

    secret_key = (os.getenv("CLERK_SECRET_KEY") or "").strip()
    if not secret_key:
        raise RuntimeError("CLERK_SECRET_KEY is not configured")

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.delete(
            f"https://api.clerk.com/v1/users/{user_id}",
            headers={"Authorization": f"Bearer {secret_key}"},
        )

    if response.status_code == 404:
        return {"status": "already_deleted"}
    if response.status_code not in (200, 202, 204):
        raise RuntimeError(
            f"Clerk user deletion failed with status {response.status_code}"
        )
    return {"status": "deleted"}


async def clerk_identity_exists(user_id: str) -> bool:
    """Return whether Clerk still has the identity, failing closed on API errors."""

    secret_key = (os.getenv("CLERK_SECRET_KEY") or "").strip()
    if not secret_key:
        raise RuntimeError("CLERK_SECRET_KEY is not configured")

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            f"https://api.clerk.com/v1/users/{user_id}",
            headers={"Authorization": f"Bearer {secret_key}"},
        )

    if response.status_code == 404:
        return False
    if response.status_code == 200:
        return True
    raise RuntimeError(
        f"Clerk user lookup failed with status {response.status_code}"
    )
