"""Cached direct remote Turso clients for per-user computer-activity reads."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional, Sequence

from libsql_client import Client, Statement, create_client

from services.turso_user_service import turso_user_service

logger = logging.getLogger(__name__)

_REMOTE_ACTIVITY_CLIENTS: dict[str, "RemoteActivityClientBundle"] = {}
_REMOTE_ACTIVITY_CLIENT_LOCKS: dict[str, asyncio.Lock] = {}
_REMOTE_ACTIVITY_TOKEN_REUSE_WINDOW_SECONDS = max(
    300,
    int(os.getenv("TURSO_REMOTE_READ_TOKEN_REUSE_WINDOW_SECONDS", "600") or "600"),
)


@dataclass
class RemoteActivityClientBundle:
    user_id: str
    database_name: str
    sync_url: str
    auth_token: str
    expires_at_epoch: float
    client: Client


@dataclass
class RemoteActivityRowsResult:
    expected_remote: bool
    source: str
    rows: list[tuple[Any, ...]]
    error: Optional[str] = None


def _lock_for_user(user_id: str) -> asyncio.Lock:
    lock = _REMOTE_ACTIVITY_CLIENT_LOCKS.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _REMOTE_ACTIVITY_CLIENT_LOCKS[user_id] = lock
    return lock


def _bundle_is_fresh(bundle: RemoteActivityClientBundle) -> bool:
    return (bundle.expires_at_epoch - time.time()) > _REMOTE_ACTIVITY_TOKEN_REUSE_WINDOW_SECONDS


async def _close_bundle(bundle: RemoteActivityClientBundle) -> None:
    try:
        await bundle.client.close()
    except Exception as exc:
        logger.debug("Failed closing remote activity client for %s: %s", bundle.user_id, exc)


async def _build_bundle(user_id: str) -> Optional[RemoteActivityClientBundle]:
    access = await turso_user_service.get_user_activity_access(user_id)
    if not access.use_per_user_db or not access.sync_url or not access.database_name:
        return None

    token, expires_at_epoch = await turso_user_service.get_cached_database_token(
        access.database_name,
        expiration=turso_user_service.server_token_ttl,
        authorization="full-access",
        reuse_window_seconds=_REMOTE_ACTIVITY_TOKEN_REUSE_WINDOW_SECONDS,
    )
    client = create_client(
        turso_user_service.client_url_for_sync_url(access.sync_url),
        auth_token=token,
    )
    return RemoteActivityClientBundle(
        user_id=user_id,
        database_name=access.database_name,
        sync_url=access.sync_url,
        auth_token=token,
        expires_at_epoch=expires_at_epoch,
        client=client,
    )


async def _get_or_create_bundle(user_id: str) -> Optional[RemoteActivityClientBundle]:
    async with _lock_for_user(user_id):
        bundle = _REMOTE_ACTIVITY_CLIENTS.get(user_id)
        if bundle is not None and _bundle_is_fresh(bundle):
            return bundle

        if bundle is not None:
            await _close_bundle(bundle)
            _REMOTE_ACTIVITY_CLIENTS.pop(user_id, None)

        new_bundle = await _build_bundle(user_id)
        if new_bundle is not None:
            _REMOTE_ACTIVITY_CLIENTS[user_id] = new_bundle
        return new_bundle


async def fetch_remote_activity_rows(
    user_id: str,
    sql: str,
    args: Sequence[Any] | None = None,
) -> RemoteActivityRowsResult:
    access = await turso_user_service.get_user_activity_access(user_id)
    if not access.use_per_user_db:
        return RemoteActivityRowsResult(expected_remote=False, source="legacy_fallback", rows=[])

    try:
        bundle = await _get_or_create_bundle(user_id)
        if bundle is None:
            return RemoteActivityRowsResult(
                expected_remote=True,
                source="sync_pending",
                rows=[],
                error="per-user_turso_bundle_unavailable",
            )

        result_set = await bundle.client.execute(sql, list(args or []))
        rows = [tuple(row.astuple()) for row in result_set.rows]
        return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=rows)
    except Exception as exc:
        logger.warning("Remote Turso activity query failed for %s: %s", user_id, exc)
        return RemoteActivityRowsResult(
            expected_remote=True,
            source="sync_pending",
            rows=[],
            error=str(exc),
        )


async def execute_remote_activity_batch(
    user_id: str,
    statements: Sequence[Statement],
) -> bool:
    """Execute a write batch against the user's canonical activity database.

    Returns ``False`` when the user is still on the legacy/local fallback path.
    Any remote write failure is raised so callers can preserve local outboxes
    and retry later instead of silently dropping activity events.
    """
    if not statements:
        return True

    user = await turso_user_service.ensure_user_activity_database(user_id)
    if user is not None and user.turso_db_name and user.turso_db_url:
        await turso_user_service._ensure_remote_schema_once(  # noqa: SLF001 - shared internal schema gate
            user_id,
            user.turso_db_url,
            user.turso_db_name,
        )

    access = await turso_user_service.get_user_activity_access(user_id)
    if not access.use_per_user_db:
        return False

    bundle = await _get_or_create_bundle(user_id)
    if bundle is None:
        raise RuntimeError("per-user Turso activity bundle unavailable")

    for index in range(0, len(statements), 100):
        await bundle.client.batch(list(statements[index:index + 100]))
    return True
