"""Shared local watcher DB helper functions."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, List, Optional, Tuple

from services.turso_user_service import TursoProvisioningError, turso_user_service

logger = logging.getLogger(__name__)

_USER_ACTIVITY_BUNDLES: dict[str, "PerUserReplicaBundle"] = {}
_USER_ACTIVITY_LOCKS: dict[str, asyncio.Lock] = {}
_USER_ACTIVITY_REPLICA_SYNC_INTERVAL_SECONDS = max(
    5,
    int(os.getenv("TURSO_USER_REPLICA_SYNC_INTERVAL_SECONDS", "60") or "60"),
)
_TOKEN_REFRESH_LEEWAY_SECONDS = max(
    300,
    int(os.getenv("TURSO_USER_TOKEN_REFRESH_LEEWAY_SECONDS", "1800") or "1800"),
)


def _is_expected_per_user_bundle_fallback(exc: Exception) -> bool:
    if isinstance(exc, TursoProvisioningError):
        normalized = str(exc).strip().lower()
        return normalized in {
            "turso platform api is not configured",
            "per-user turso sync is not configured",
            "per-user turso database metadata is missing",
            "per-user turso migration has not completed yet",
        }
    return False


@dataclass
class PerUserReplicaBundle:
    user_id: str
    database_name: str
    sync_url: str
    replica_path: Path
    auth_token: str
    expires_at_epoch: float
    libsql_conn: object
    last_sync_epoch: float


def _allow_legacy_reads() -> bool:
    return (os.environ.get("RITUAL_ALLOW_LEGACY_DB_READS") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _has_table(path: str, table_name: str) -> bool:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1.0)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type='table' AND name=?
            LIMIT 1
            """,
            (table_name,),
        )
        exists = cursor.fetchone() is not None
        conn.close()
        return exists
    except Exception:
        return False


def _resolve_db_path(
    *,
    override_env: str,
    preferred_path: str,
    fallback_path: str,
    required_table: str,
    legacy_candidates: List[str],
) -> str:
    override_path = os.environ.get(override_env)
    if override_path and os.path.exists(override_path):
        return override_path

    if os.path.exists(preferred_path):
        try:
            if os.path.getsize(preferred_path) > 0 and _has_table(preferred_path, required_table):
                return preferred_path
        except OSError:
            pass

    if os.path.exists(fallback_path):
        try:
            if os.path.getsize(fallback_path) > 0 and _has_table(fallback_path, required_table):
                return fallback_path
        except OSError:
            pass

    if _allow_legacy_reads():
        for path in legacy_candidates:
            if not os.path.exists(path):
                continue
            try:
                if os.path.getsize(path) == 0:
                    continue
            except OSError:
                continue
            if _has_table(path, required_table):
                return path

        for path in legacy_candidates:
            if os.path.exists(path):
                return path

    return preferred_path


def get_local_activity_db_path_impl() -> str:
    """Resolve the local activity DB path (watcher + sync queue)."""
    home = os.environ.get("HOME") or str(Path.home())
    ritual_dir = os.path.join(home, ".ritual")
    return _resolve_db_path(
        override_env="RITUAL_ACTIVITY_DB_PATH",
        preferred_path=os.path.join(ritual_dir, "activity.db"),
        fallback_path=os.path.join(ritual_dir, "ritual.db"),
        required_table="activity_events",
        legacy_candidates=[
            os.path.join(ritual_dir, "watcher.db"),
            os.path.join(ritual_dir, "watcher.db.migrated"),
        ],
    )


def get_local_memory_db_path_impl() -> str:
    """Resolve the local memory DB path (context fallback + upload outbox)."""
    home = os.environ.get("HOME") or str(Path.home())
    ritual_dir = os.path.join(home, ".ritual")
    resolved = _resolve_db_path(
        override_env="RITUAL_MEMORY_DB_PATH",
        preferred_path=os.path.join(ritual_dir, "memory.db"),
        fallback_path=os.path.join(ritual_dir, "ritual.db"),
        required_table="context_snapshots",
        legacy_candidates=[
            os.path.join(ritual_dir, "frames.db"),
            os.path.join(ritual_dir, "frames.db.migrated"),
        ],
    )
    return resolved


def _legacy_replica_path() -> Optional[Path]:
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url or "turso.io" not in database_url:
        return None

    try:
        from database.connection import DATABASE_RUNTIME_STATE
    except Exception:
        DATABASE_RUNTIME_STATE = {"db_ready": None, "last_error": None}

    try:
        from database.connection import local_db_path as configured_local_db_path

        replica_path = Path(configured_local_db_path)
    except Exception:
        replica_path = Path(__file__).parent.parent / ".turso_replica.db"

    try:
        if not replica_path.exists():
            logger.warning("Backend Turso replica missing at %s", replica_path)
            return None
        if DATABASE_RUNTIME_STATE.get("db_ready") is False:
            last_error = DATABASE_RUNTIME_STATE.get("last_error")
            log_fn = logger.info if last_error in (None, "", "None") else logger.warning
            log_fn(
                "Backend Turso replica is not marked ready; last_error=%s",
                last_error,
            )
        return replica_path
    except Exception as exc:
        logger.warning("Failed to resolve backend Turso replica: %s", exc)
        return None


def _open_sqlite_conn(path: Path, *, write: bool) -> sqlite3.Connection:
    if write:
        conn = sqlite3.connect(str(path), timeout=5.0)
    else:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
        conn.execute("PRAGMA query_only = ON")
    conn.row_factory = sqlite3.Row
    return conn


def _sqlite_integrity_ok(path: Path) -> bool:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
        try:
            row = conn.execute("PRAGMA quick_check(1)").fetchone()
        finally:
            conn.close()
        return bool(row) and str(row[0]).strip().lower() == "ok"
    except Exception as exc:
        logger.warning("Integrity check failed for %s: %s", path, exc)
        return False


def _has_required_activity_tables(path: Path) -> bool:
    return any(
        _has_table(str(path), table_name)
        for table_name in ("context_snapshots", "session_retrieval_docs", "activity_events")
    )


def _open_cached_per_user_replica_conn(
    user_id: str,
    *,
    write: bool,
) -> Optional[sqlite3.Connection]:
    if write:
        return None

    replica_path = turso_user_service.replica_path_for_user(user_id)
    if not replica_path.exists():
        return None
    if not _has_required_activity_tables(replica_path):
        logger.warning(
            "Cached per-user replica for %s is missing required activity tables at %s",
            user_id,
            replica_path,
        )
        return None
    if not _sqlite_integrity_ok(replica_path):
        logger.warning(
            "Cached per-user replica for %s failed integrity check at %s",
            user_id,
            replica_path,
        )
        return None

    try:
        conn = _open_sqlite_conn(replica_path, write=False)
    except Exception as exc:
        logger.warning(
            "Failed opening cached per-user replica for %s at %s: %s",
            user_id,
            replica_path,
            exc,
        )
        return None

    logger.warning(
        "Using cached per-user activity replica for %s path=%s due to per-user bundle resolution failure",
        user_id,
        replica_path,
    )
    return conn


def get_turso_activity_conn():
    """Get a read-only connection to the backend-managed Turso replica.

    The backend already maintains `.turso_replica.db` via
    ``database.connection``. Activity/search routes should read from that
    replica instead of creating and syncing a second replica file on every
    request. That per-request sync path was fragile on Railway and caused the
    calendar summary and memory query endpoints to fall back to empty local
    SQLite databases.
    """
    replica_path = _legacy_replica_path()
    if replica_path is None:
        return None

    try:
        conn = _open_sqlite_conn(replica_path, write=False)
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='context_snapshots' LIMIT 1"
        ).fetchone()
        if not has_table:
            conn.close()
            return None

        count = conn.execute("SELECT COUNT(*) FROM context_snapshots").fetchone()[0]
        if count == 0:
            conn.close()
            return None

        logger.info(
            "Turso activity conn: %d context_snapshots via backend replica %s",
            count,
            replica_path.name,
        )
        return conn
    except Exception as exc:
        logger.warning("Failed to open backend Turso replica for activity data: %s", exc)

        return None


def _lock_for_user(user_id: str) -> asyncio.Lock:
    lock = _USER_ACTIVITY_LOCKS.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _USER_ACTIVITY_LOCKS[user_id] = lock
    return lock


def _bundle_is_fresh(bundle: PerUserReplicaBundle) -> bool:
    if not bundle.replica_path.exists():
        return False
    return bundle.expires_at_epoch - time.time() > _TOKEN_REFRESH_LEEWAY_SECONDS


def _close_bundle(bundle: PerUserReplicaBundle) -> None:
    close = getattr(bundle.libsql_conn, "close", None)
    if callable(close):
        close()


def _sync_bundle_now(bundle: PerUserReplicaBundle) -> None:
    bundle.libsql_conn.sync()
    bundle.last_sync_epoch = time.time()


async def _ensure_bundle_synced(bundle: PerUserReplicaBundle, *, force: bool = False) -> None:
    now = time.time()
    if not force and (now - bundle.last_sync_epoch) < _USER_ACTIVITY_REPLICA_SYNC_INTERVAL_SECONDS:
        return
    await asyncio.to_thread(_sync_bundle_now, bundle)


async def _build_per_user_bundle(user_id: str) -> Optional[PerUserReplicaBundle]:
    access = await turso_user_service.get_user_activity_access(user_id)
    if not access.use_per_user_db or not access.sync_url or not access.database_name:
        logger.info(
            "Per-user activity bundle disabled for %s mode=%s db=%s sync_url_present=%s",
            user_id,
            access.mode,
            access.database_name or "none",
            bool(access.sync_url),
        )
        return None

    logger.info(
        "Building per-user activity bundle for %s db=%s sync_url=%s",
        user_id,
        access.database_name,
        access.sync_url,
    )
    try:
        token, expires_at_epoch = await turso_user_service.get_cached_database_token(
            access.database_name,
            expiration=turso_user_service.server_token_ttl,
            authorization="full-access",
            reuse_window_seconds=10 * 60,
        )
    except Exception as exc:
        logger.warning(
            "Failed minting per-user Turso token for %s db=%s: %s",
            user_id,
            access.database_name,
            exc,
        )
        raise
    replica_path = turso_user_service.replica_path_for_user(user_id)

    def _connect() -> object:
        return turso_user_service._open_remote_replica(replica_path, access.sync_url or "", token)

    try:
        libsql_conn = await asyncio.to_thread(_connect)
    except Exception as exc:
        logger.warning(
            "Failed opening per-user Turso replica for %s db=%s replica=%s: %s",
            user_id,
            access.database_name,
            replica_path,
            exc,
        )
        raise
    bundle = PerUserReplicaBundle(
        user_id=user_id,
        database_name=access.database_name,
        sync_url=access.sync_url,
        replica_path=replica_path,
        auth_token=token,
        expires_at_epoch=expiry_epoch,
        libsql_conn=libsql_conn,
        last_sync_epoch=time.time(),
    )
    logger.info(
        "Opened per-user Turso activity replica for %s db=%s replica=%s",
        user_id,
        access.database_name,
        replica_path,
    )
    return bundle


async def _get_or_create_per_user_bundle(user_id: str) -> Optional[PerUserReplicaBundle]:
    async with _lock_for_user(user_id):
        bundle = _USER_ACTIVITY_BUNDLES.get(user_id)
        if bundle is not None and _bundle_is_fresh(bundle):
            logger.info(
                "Reusing cached per-user activity bundle for %s db=%s replica=%s",
                user_id,
                bundle.database_name,
                bundle.replica_path,
            )
            return bundle

        if bundle is not None:
            await asyncio.to_thread(_close_bundle, bundle)
            _USER_ACTIVITY_BUNDLES.pop(user_id, None)

        new_bundle = await _build_per_user_bundle(user_id)
        if new_bundle is None:
            return None

        _USER_ACTIVITY_BUNDLES[user_id] = new_bundle
        return new_bundle


@contextlib.asynccontextmanager
async def open_activity_connection_for_user(
    user_id: str,
    *,
    write: bool = False,
) -> AsyncIterator[Optional[sqlite3.Connection]]:
    bundle = None
    conn = None
    access = None
    try:
        try:
            access = await turso_user_service.get_user_activity_access(user_id)
        except Exception as exc:
            logger.warning("Failed loading activity access mode for %s: %s", user_id, exc)
            access = None

        try:
            bundle = await _get_or_create_per_user_bundle(user_id)
        except Exception as exc:
            if _is_expected_per_user_bundle_fallback(exc):
                logger.info(
                    "Per-user activity bundle unavailable for %s; using legacy replica fallback: %s",
                    user_id,
                    exc,
                )
            else:
                logger.warning(
                    "Failed resolving per-user activity bundle for %s; falling back to legacy replica: %s",
                    user_id,
                    exc,
                )
            bundle = None
        if bundle is not None:
            logger.info(
                "Using per-user activity SQLite connection for %s db=%s replica=%s write=%s",
                user_id,
                bundle.database_name,
                bundle.replica_path,
                write,
            )
            conn = _open_sqlite_conn(bundle.replica_path, write=write)
            yield conn
            return

        if access is not None and access.use_per_user_db:
            conn = _open_cached_per_user_replica_conn(user_id, write=write)
            if conn is not None:
                yield conn
                return

            logger.warning(
                "Per-user activity DB is expected for %s but no healthy per-user replica is available; refusing malformed legacy fallback",
                user_id,
            )
            yield None
            return

        replica_path = _legacy_replica_path()
        if replica_path is None:
            logger.warning(
                "No per-user activity bundle or legacy backend replica available for %s",
                user_id,
            )
            yield None
            return
        if not _has_required_activity_tables(replica_path):
            logger.warning(
                "Legacy backend replica for %s is missing required activity tables at %s",
                user_id,
                replica_path,
            )
            yield None
            return
        if not _sqlite_integrity_ok(replica_path):
            logger.warning(
                "Legacy backend replica for %s failed integrity check at %s",
                user_id,
                replica_path,
            )
            yield None
            return

        try:
            conn = _open_sqlite_conn(replica_path, write=write)
        except Exception as exc:
            logger.warning("Failed opening legacy activity replica for %s: %s", user_id, exc)
            yield None
            return
        logger.warning(
            "Falling back to legacy backend activity replica for %s path=%s write=%s",
            user_id,
            replica_path,
            write,
        )
        yield conn
    finally:
        if conn is not None:
            conn.close()
        if bundle is not None and write:
            try:
                await _ensure_bundle_synced(bundle, force=True)
            except Exception as exc:
                logger.warning("Failed syncing per-user Turso replica for %s: %s", user_id, exc)


async def using_per_user_activity_db(user_id: str) -> bool:
    access = await turso_user_service.get_user_activity_access(user_id)
    return access.use_per_user_db


def get_local_watcher_db_path_impl() -> str:
    """
    Back-compat alias for existing activity-oriented call sites.
    """
    return get_local_activity_db_path_impl()


def merge_time_intervals_impl(intervals: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """Merge overlapping (start_ms, end_ms) intervals."""
    if not intervals:
        return []

    sorted_intervals = sorted(intervals, key=lambda interval: interval[0])
    merged: List[Tuple[int, int]] = []
    current_start, current_end = sorted_intervals[0]

    for start, end in sorted_intervals[1:]:
        if start <= current_end:
            current_end = max(current_end, end)
            continue
        merged.append((current_start, current_end))
        current_start, current_end = start, end

    merged.append((current_start, current_end))
    return merged
