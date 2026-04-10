"""Per-user Turso provisioning, migration, and token minting."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Literal, Optional
from urllib.parse import urlparse

import httpx
import libsql_experimental as libsql
from sqlalchemy import select, update

from database.connection import get_db_session
from database.models import UserDB

logger = logging.getLogger(__name__)

ROLLOUT_COUNT_MINIMUMS = {
    "context_snapshots": 18_513,
    "session_retrieval_docs": 3_481,
    "context_sessions": 3_549,
    "activity_events": 542_000,
}

MIGRATION_TABLES = (
    "context_sessions",
    "activity_events",
    "context_snapshots",
    "session_retrieval_docs",
    "afk_events",
)

MIGRATION_BATCH_SIZE = max(50, int((os.getenv("TURSO_MIGRATION_BATCH_SIZE") or "250").strip()))
MIGRATION_BATCH_RETRY_LIMIT = max(5, int((os.getenv("TURSO_MIGRATION_BATCH_RETRY_LIMIT") or "25").strip()))
REPLICA_OPEN_RETRY_LIMIT = max(2, int((os.getenv("TURSO_REPLICA_OPEN_RETRY_LIMIT") or "5").strip()))

SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS context_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uid TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        primary_app_bundle_id TEXT,
        primary_app_name TEXT,
        primary_domain TEXT,
        dominant_title TEXT,
        representative_text TEXT,
        coverage_score REAL NOT NULL DEFAULT 0.0,
        snapshot_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_uid TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        ts_start INTEGER NOT NULL,
        ts_end INTEGER NOT NULL,
        app_bundle_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        window_title TEXT,
        window_title_hash TEXT,
        window_owner_pid INTEGER,
        is_afk INTEGER NOT NULL DEFAULT 0,
        browser_url TEXT,
        browser_domain TEXT,
        is_incognito INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'ritual_watcher_v2',
        created_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS afk_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        afk_uid TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        ts_start INTEGER NOT NULL,
        ts_end INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS context_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        activity_event_id INTEGER,
        activity_event_uid TEXT,
        session_id INTEGER,
        session_uid TEXT,
        ts INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        app_bundle_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        window_title TEXT,
        browser_url TEXT,
        browser_domain TEXT,
        tab_title TEXT,
        document_title TEXT,
        visible_text_raw TEXT NOT NULL DEFAULT '',
        visible_text_norm TEXT NOT NULL DEFAULT '',
        capture_quality REAL NOT NULL DEFAULT 0.0,
        capture_components_json TEXT,
        ax_richness_score REAL NOT NULL DEFAULT 0.0,
        selected_text_present INTEGER NOT NULL DEFAULT 0,
        document_path TEXT,
        ax_source TEXT,
        capture_trigger TEXT,
        trigger_to_snapshot_ms INTEGER,
        ui_elements_json TEXT,
        dedup_key TEXT NOT NULL,
        is_sensitive_redacted INTEGER NOT NULL DEFAULT 0,
        semantic_summary TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS session_retrieval_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        session_uid TEXT NOT NULL DEFAULT '',
        logical_chunk_id TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'context_session',
        chunk_start_ts INTEGER NOT NULL,
        chunk_end_ts INTEGER NOT NULL,
        app_name TEXT,
        browser_domain TEXT,
        window_title TEXT,
        document_title TEXT,
        raw_visible_text TEXT NOT NULL DEFAULT '',
        contextual_retrieval_text TEXT NOT NULL DEFAULT '',
        capture_quality REAL NOT NULL DEFAULT 0.0,
        context_version INTEGER NOT NULL DEFAULT 1,
        session_position INTEGER NOT NULL DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 1,
        embedded_at INTEGER DEFAULT NULL,
        provider_doc_id TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS semantic_work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        source_scope TEXT NOT NULL DEFAULT 'broad_overview',
        range_start_ts INTEGER NOT NULL,
        range_end_ts INTEGER NOT NULL,
        session_id INTEGER,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        title TEXT NOT NULL,
        action_summary TEXT NOT NULL DEFAULT '',
        activity_class TEXT NOT NULL DEFAULT 'work',
        story_kind TEXT NOT NULL DEFAULT 'general',
        primary_app TEXT,
        apps_json TEXT NOT NULL DEFAULT '[]',
        domains_json TEXT NOT NULL DEFAULT '[]',
        files_json TEXT NOT NULL DEFAULT '[]',
        commands_json TEXT NOT NULL DEFAULT '[]',
        errors_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        semantic_summary TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0.0,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        score_main_event REAL NOT NULL DEFAULT 0.0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS semantic_work_item_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        evidence_id TEXT,
        session_id INTEGER,
        evidence_kind TEXT NOT NULL DEFAULT 'citation',
        snippet TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL,
        score REAL NOT NULL DEFAULT 0.0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(work_item_id, evidence_id, timestamp)
    )
    """,
)

INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_context_sessions_time ON context_sessions(start_ts, end_ts)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_context_sessions_session_uid ON context_sessions(session_uid)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_ts_start ON activity_events(ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_ts_end ON activity_events(ts_end)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_user_device_ts ON activity_events(user_id, device_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_domain ON activity_events(browser_domain)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_events_event_uid ON activity_events(event_uid)",
    "CREATE INDEX IF NOT EXISTS idx_afk_events_user_device_ts ON afk_events(user_id, device_id, ts_start)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_afk_events_afk_uid ON afk_events(afk_uid)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_ts ON context_snapshots(ts)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_app_ts ON context_snapshots(app_bundle_id, ts)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_domain_ts ON context_snapshots(browser_domain, ts)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_context_snapshots_dedup ON context_snapshots(dedup_key)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_session_ts ON context_snapshots(session_id, ts)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_activity_event_uid ON context_snapshots(activity_event_uid)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_session_uid ON context_snapshots(session_uid)",
    "CREATE INDEX IF NOT EXISTS idx_session_retrieval_docs_time ON session_retrieval_docs(chunk_start_ts, chunk_end_ts)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_session_retrieval_docs_logical_chunk_id ON session_retrieval_docs(logical_chunk_id)",
    "CREATE INDEX IF NOT EXISTS idx_session_retrieval_docs_session_uid ON session_retrieval_docs(session_uid)",
    "CREATE INDEX IF NOT EXISTS idx_semantic_work_items_user_scope_range ON semantic_work_items(user_id, source_scope, range_start_ts, range_end_ts)",
    "CREATE INDEX IF NOT EXISTS idx_semantic_work_items_user_time ON semantic_work_items(user_id, start_ts, end_ts)",
    "CREATE INDEX IF NOT EXISTS idx_semantic_work_item_evidence_work_item ON semantic_work_item_evidence(work_item_id, timestamp)",
)

COLUMN_MIGRATIONS = (
    ("context_sessions", "session_uid", "TEXT NOT NULL DEFAULT ''"),
    ("activity_events", "event_uid", "TEXT NOT NULL DEFAULT ''"),
    ("afk_events", "afk_uid", "TEXT NOT NULL DEFAULT ''"),
    ("context_snapshots", "activity_event_uid", "TEXT"),
    ("context_snapshots", "session_uid", "TEXT"),
    ("session_retrieval_docs", "session_uid", "TEXT NOT NULL DEFAULT ''"),
    ("session_retrieval_docs", "logical_chunk_id", "TEXT NOT NULL DEFAULT ''"),
    ("session_retrieval_docs", "provider_doc_id", "TEXT DEFAULT NULL"),
)

BACKFILL_STATEMENTS = (
    """
    UPDATE activity_events
    SET event_uid = printf('legacy-activity:%s:%s:%lld', device_id, user_id, id)
    WHERE TRIM(COALESCE(event_uid, '')) = ''
    """,
    """
    UPDATE afk_events
    SET afk_uid = printf('legacy-afk:%s:%s:%lld', device_id, user_id, id)
    WHERE TRIM(COALESCE(afk_uid, '')) = ''
    """,
    """
    UPDATE context_sessions
    SET session_uid = printf('legacy-session:%s:%s:%lld', device_id, user_id, id)
    WHERE TRIM(COALESCE(session_uid, '')) = ''
    """,
    """
    UPDATE context_snapshots
    SET activity_event_uid = (
        SELECT activity_events.event_uid
        FROM activity_events
        WHERE activity_events.id = context_snapshots.activity_event_id
    )
    WHERE activity_event_id IS NOT NULL
      AND TRIM(COALESCE(activity_event_uid, '')) = ''
    """,
    """
    UPDATE context_snapshots
    SET session_uid = (
        SELECT context_sessions.session_uid
        FROM context_sessions
        WHERE context_sessions.id = context_snapshots.session_id
    )
    WHERE session_id IS NOT NULL
      AND TRIM(COALESCE(session_uid, '')) = ''
    """,
    """
    UPDATE session_retrieval_docs
    SET session_uid = (
        SELECT context_sessions.session_uid
        FROM context_sessions
        WHERE context_sessions.id = session_retrieval_docs.session_id
    )
    WHERE TRIM(COALESCE(session_uid, '')) = ''
    """,
    """
    UPDATE session_retrieval_docs
    SET logical_chunk_id = printf('session-doc:%s', session_uid)
    WHERE TRIM(COALESCE(logical_chunk_id, '')) = ''
      AND TRIM(COALESCE(session_uid, '')) != ''
    """,
)


class TursoProvisioningError(RuntimeError):
    """Raised when provisioning or migration fails."""


@dataclass
class DesktopSyncConfig:
    sync_url: str
    auth_token: str
    expires_at: str
    database_name: str


@dataclass
class UserActivityAccess:
    mode: str
    sync_url: Optional[str] = None
    database_name: Optional[str] = None
    use_per_user_db: bool = False


@dataclass
class UserTursoMetadata:
    id: str
    turso_db_name: Optional[str] = None
    turso_db_url: Optional[str] = None
    turso_provisioned_at: Optional[datetime] = None
    turso_migrated_at: Optional[datetime] = None


class TursoUserService:
    def __init__(self) -> None:
        self.platform_api_base = (
            os.getenv("TURSO_PLATFORM_API_BASE_URL") or "https://api.turso.tech"
        ).rstrip("/")
        self.platform_token = (os.getenv("TURSO_PLATFORM_API_TOKEN") or "").strip()
        self.organization = (os.getenv("TURSO_ORGANIZATION") or "").strip()
        self.group = (os.getenv("TURSO_GROUP") or "").strip()
        self.db_prefix = self._sanitize_db_name_component(
            (os.getenv("TURSO_DATABASE_PREFIX") or "ritual_user").strip() or "ritual_user"
        )
        self.rollout_gate_user_id = (os.getenv("TURSO_MIGRATION_GATE_USER_ID") or "").strip()
        self.desktop_token_ttl = os.getenv("TURSO_DESKTOP_TOKEN_TTL", "12h").strip() or "12h"
        self.server_token_ttl = os.getenv("TURSO_SERVER_TOKEN_TTL", "1h").strip() or "1h"
        self.migration_token_ttl = os.getenv("TURSO_MIGRATION_TOKEN_TTL", "24h").strip() or "24h"
        self.migration_source_user_id = (os.getenv("TURSO_MIGRATION_SOURCE_USER_ID") or "").strip()
        self.migration_source_db_path = (os.getenv("TURSO_MIGRATION_SOURCE_DB_PATH") or "").strip()
        self.replica_dir = Path(__file__).parent.parent / ".turso_user_replicas"
        self.replica_dir.mkdir(parents=True, exist_ok=True)
        self.import_seed_dir = Path(__file__).parent.parent / ".turso_import_seeds"
        self.import_seed_dir.mkdir(parents=True, exist_ok=True)
        self._token_cache: Dict[tuple[str, str, str], tuple[str, float]] = {}
        self._token_cache_locks: Dict[tuple[str, str, str], asyncio.Lock] = {}
        self._schema_ready_dbs: set[str] = set()
        self._schema_ready_lock = asyncio.Lock()

    def is_platform_configured(self) -> bool:
        return bool(self.platform_token and self.organization and self.group)

    def is_rollout_gate_user(self, user_id: str) -> bool:
        return bool(self.rollout_gate_user_id and user_id == self.rollout_gate_user_id)

    def _sanitize_db_name_component(self, value: str) -> str:
        lowered = value.strip().lower().replace("_", "-")
        cleaned = re.sub(r"[^a-z0-9-]+", "-", lowered)
        cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
        return cleaned or "ritual-user"

    def build_database_name(self, user_id: str) -> str:
        suffix = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]
        name = f"{self.db_prefix}-{suffix}"
        return name[:64].rstrip("-")

    def sync_url_for_hostname(self, hostname: str) -> str:
        return f"libsql://{hostname}"

    def client_url_for_sync_url(self, sync_url: str) -> str:
        parsed = urlparse(str(sync_url or "").strip())
        if parsed.scheme == "libsql" and parsed.hostname:
            return f"https://{parsed.hostname}"
        return str(sync_url or "").strip()

    def replica_path_for_user(self, user_id: str) -> Path:
        hashed = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]
        return self.replica_dir / f"{hashed}.db"

    def resolve_migration_source_db_path(
        self,
        source_db_path: Optional[str | Path] = None,
    ) -> Path:
        candidate = source_db_path or self.migration_source_db_path
        if candidate:
            return Path(candidate).expanduser().resolve()
        return self._legacy_activity_db_path()

    def resolve_migration_source_user_id(
        self,
        target_user_id: str,
        source_user_id: Optional[str] = None,
    ) -> str:
        candidate = (source_user_id or self.migration_source_user_id or "").strip()
        return candidate or target_user_id

    def _ttl_to_timedelta(self, ttl: str) -> timedelta:
        match = re.fullmatch(r"\s*(\d+)\s*([smhd])\s*", ttl or "")
        if not match:
            raise TursoProvisioningError(f"Unsupported Turso token TTL format: {ttl!r}")

        amount = int(match.group(1))
        unit = match.group(2)
        if unit == "s":
            return timedelta(seconds=amount)
        if unit == "m":
            return timedelta(minutes=amount)
        if unit == "h":
            return timedelta(hours=amount)
        return timedelta(days=amount)

    async def _platform_request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        allowed_statuses: tuple[int, ...] = (200,),
    ) -> Dict[str, Any]:
        if not self.is_platform_configured():
            raise TursoProvisioningError("Turso platform API is not configured")

        url = f"{self.platform_api_base}{path}"
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.request(
                method,
                url,
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {self.platform_token}"},
            )

        if response.status_code not in allowed_statuses:
            detail = response.text.strip()
            raise TursoProvisioningError(
                f"Turso API {method} {path} failed with {response.status_code}: {detail}"
            )

        if not response.content:
            return {}
        return response.json()

    async def _retrieve_database(self, database_name: str) -> Optional[Dict[str, Any]]:
        path = f"/v1/organizations/{self.organization}/databases/{database_name}"
        try:
            payload = await self._platform_request("GET", path, allowed_statuses=(200,))
        except TursoProvisioningError as exc:
            if " 404:" in str(exc):
                return None
            raise
        return payload.get("database") or None

    async def _create_database(
        self,
        database_name: str,
        *,
        seed: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"name": database_name, "group": self.group}
        if seed:
            body["seed"] = seed
        payload = await self._platform_request(
            "POST",
            f"/v1/organizations/{self.organization}/databases",
            json_body=body,
            allowed_statuses=(200, 409),
        )
        database = payload.get("database") or {}
        if not database:
            existing = await self._retrieve_database(database_name)
            if existing:
                return existing
        if not database:
            raise TursoProvisioningError("Turso create database returned no database payload")
        return database

    async def delete_database(self, database_name: str) -> bool:
        path = f"/v1/organizations/{self.organization}/databases/{database_name}"
        try:
            await self._platform_request(
                "DELETE",
                path,
                allowed_statuses=(200, 202, 204),
            )
        except TursoProvisioningError as exc:
            if " 404:" in str(exc):
                return False
            raise

        self._schema_ready_dbs.discard(database_name)
        stale_keys = [key for key in self._token_cache if key[0] == database_name]
        for key in stale_keys:
            self._token_cache.pop(key, None)
            self._token_cache_locks.pop(key, None)
        return True

    async def _mint_database_token(
        self,
        database_name: str,
        *,
        expiration: str,
        authorization: str,
    ) -> str:
        payload = await self._platform_request(
            "POST",
            f"/v1/organizations/{self.organization}/databases/{database_name}/auth/tokens",
            params={"expiration": expiration, "authorization": authorization},
            allowed_statuses=(200,),
        )
        token = str(payload.get("jwt") or "").strip()
        if not token:
            raise TursoProvisioningError("Turso token mint returned an empty JWT")
        return token

    def _token_cache_key(
        self,
        database_name: str,
        *,
        expiration: str,
        authorization: str,
    ) -> tuple[str, str, str]:
        return (database_name, expiration, authorization)

    def _token_cache_lock(
        self,
        database_name: str,
        *,
        expiration: str,
        authorization: str,
    ) -> asyncio.Lock:
        key = self._token_cache_key(
            database_name,
            expiration=expiration,
            authorization=authorization,
        )
        lock = self._token_cache_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._token_cache_locks[key] = lock
        return lock

    async def get_cached_database_token(
        self,
        database_name: str,
        *,
        expiration: str,
        authorization: str,
        reuse_window_seconds: int = 0,
    ) -> tuple[str, float]:
        key = self._token_cache_key(
            database_name,
            expiration=expiration,
            authorization=authorization,
        )
        lock = self._token_cache_lock(
            database_name,
            expiration=expiration,
            authorization=authorization,
        )
        async with lock:
            cached = self._token_cache.get(key)
            now = time.time()
            if cached and (cached[1] - now) > max(0, reuse_window_seconds):
                return cached

            token = await self._mint_database_token(
                database_name,
                expiration=expiration,
                authorization=authorization,
            )
            expires_at_epoch = now + self._ttl_to_timedelta(expiration).total_seconds()
            cached_value = (token, expires_at_epoch)
            self._token_cache[key] = cached_value
            return cached_value

    async def _load_user(self, user_id: str) -> Optional[UserDB]:
        async with get_db_session() as session:
            result = await session.execute(select(UserDB).where(UserDB.id == user_id))
            return result.scalar_one_or_none()

    def _is_malformed_replica_error(self, exc: Exception) -> bool:
        message = str(exc or "").lower()
        return (
            "database disk image is malformed" in message
            or "integrity check failed" in message
            or "file is not a database" in message
        )

    async def _recover_shared_metadata_replica(self) -> bool:
        try:
            from database.connection import _recover_corrupt_local_replica
        except Exception as exc:
            logger.warning("Failed importing shared replica recovery helper: %s", exc)
            return False
        try:
            return bool(await _recover_corrupt_local_replica())
        except Exception as exc:
            logger.warning("Failed recovering shared backend replica: %s", exc)
            return False

    async def _load_user_turso_metadata(self, user_id: str) -> Optional[UserTursoMetadata]:
        recovered = False
        while True:
            try:
                async with get_db_session() as session:
                    result = await session.execute(
                        select(
                            UserDB.id,
                            UserDB.turso_db_name,
                            UserDB.turso_db_url,
                            UserDB.turso_provisioned_at,
                            UserDB.turso_migrated_at,
                        ).where(UserDB.id == user_id)
                    )
                    row = result.first()
                break
            except Exception as exc:
                if not recovered and self._is_malformed_replica_error(exc):
                    recovered = await self._recover_shared_metadata_replica()
                    if recovered:
                        logger.warning(
                            "Recovered malformed shared backend replica while loading Turso metadata for %s; retrying",
                            user_id,
                        )
                        continue
                raise

        if row is None:
            return None

        return UserTursoMetadata(
            id=row[0],
            turso_db_name=row[1],
            turso_db_url=row[2],
            turso_provisioned_at=row[3],
            turso_migrated_at=row[4],
        )

    async def _update_user_turso_metadata(
        self,
        user_id: str,
        *,
        database_name: str,
        sync_url: str,
        provisioned_at: Optional[datetime] = None,
        migrated_at: Optional[datetime] = None,
    ) -> None:
        async with get_db_session() as session:
            existing = await self._load_user_turso_metadata(user_id)
            if existing is None:
                raise TursoProvisioningError(f"User {user_id} not found while updating Turso metadata")

            values: Dict[str, Any] = {
                "turso_db_name": database_name,
                "turso_db_url": sync_url,
                "updated_at": datetime.utcnow(),
            }
            if provisioned_at is not None and existing.turso_provisioned_at is None:
                values["turso_provisioned_at"] = provisioned_at
            if migrated_at is not None:
                values["turso_migrated_at"] = migrated_at

            await session.execute(update(UserDB).where(UserDB.id == user_id).values(**values))
            await session.commit()

    async def ensure_user_activity_metadata(self, user_id: str) -> Optional[UserTursoMetadata]:
        user = await self._load_user_turso_metadata(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")
        if not self.is_platform_configured():
            return user

        if user.turso_db_name and user.turso_db_url and user.turso_provisioned_at is not None:
            logger.debug(
                "Per-user Turso metadata already present for %s; skipping provisioning",
                user_id,
            )
            return user

        database_name = user.turso_db_name or self.build_database_name(user_id)
        database = await self._retrieve_database(database_name)
        created_database = database is None
        if database is None:
            database = await self._create_database(database_name)

        hostname = str(database.get("Hostname") or "").strip()
        if not hostname:
            refreshed = await self._retrieve_database(database_name)
            hostname = str((refreshed or {}).get("Hostname") or "").strip()
        if not hostname:
            raise TursoProvisioningError(f"Turso database {database_name} is missing a hostname")

        sync_url = self.sync_url_for_hostname(hostname)
        if created_database or user.turso_provisioned_at is None or user.turso_db_url != sync_url:
            await self._ensure_remote_schema(user_id, sync_url, database_name)
        await self._update_user_turso_metadata(
            user_id,
            database_name=database_name,
            sync_url=sync_url,
            provisioned_at=user.turso_provisioned_at or datetime.utcnow(),
        )
        return await self._load_user_turso_metadata(user_id)

    def _is_retryable_replica_error(self, exc: Exception) -> bool:
        message = str(exc).lower()
        return (
            "stream not found" in message
            or "wal_insert_begin failed" in message
            or "wal_insert_frame failed" in message
            or "lower generation" in message
            or "server returned a lower generation than local" in message
            or "sqlitefailure(7" in message
            or "sqlitefailure(10" in message
            or "sqlitfailure(7" in message
            or "http dispatch error" in message
            or "connection error" in message
            or "operation timed out" in message
            or "os error 60" in message
            or "timed out" in message
        )

    def _reset_local_replica_cache(self, db_path: Path) -> None:
        for suffix in ("", "-info", "-shm", "-wal"):
            candidate = Path(f"{db_path}{suffix}")
            try:
                if candidate.exists():
                    candidate.unlink()
            except FileNotFoundError:
                continue

    def _is_duplicate_column_error(self, exc: Exception) -> bool:
        message = str(exc).lower()
        return "duplicate column name" in message or "already exists" in message

    def _apply_column_migrations(self, conn: Any) -> None:
        for table_name, column_name, column_sql in COLUMN_MIGRATIONS:
            statement = f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"
            try:
                conn.execute(statement)
            except Exception as exc:
                if self._is_duplicate_column_error(exc):
                    continue
                raise

    def _apply_backfills(self, conn: Any) -> None:
        for statement in BACKFILL_STATEMENTS:
            conn.execute(statement)

    def _table_sql(self, conn: Any, table_name: str) -> str:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
        if not row:
            return ""
        return str(row[0] or "")

    def _table_exists(self, conn: Any, table_name: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
        return row is not None

    def _next_backup_table_name(self, conn: Any, base_name: str) -> str:
        candidate = base_name
        suffix = 1
        while self._table_exists(conn, candidate):
            candidate = f"{base_name}_{suffix}"
            suffix += 1
        return candidate

    def _repair_session_retrieval_docs_schema(self, conn: Any) -> None:
        sql = self._table_sql(conn, "session_retrieval_docs")
        if not sql:
            return

        normalized = re.sub(r"\s+", " ", sql.strip().lower())
        if "session_id integer not null unique" not in normalized:
            return

        backup_table = self._next_backup_table_name(
            conn, "session_retrieval_docs_legacy_unique_session_id"
        )

        logger.warning(
            "Repairing legacy session_retrieval_docs schema; preserving backup table as %s",
            backup_table,
        )

        conn.execute(f"ALTER TABLE session_retrieval_docs RENAME TO {backup_table}")
        conn.execute("DROP INDEX IF EXISTS idx_session_retrieval_docs_time")
        conn.execute("DROP INDEX IF EXISTS idx_session_retrieval_docs_logical_chunk_id")
        conn.execute("DROP INDEX IF EXISTS idx_session_retrieval_docs_session_uid")

        conn.execute(
            """
            CREATE TABLE session_retrieval_docs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                session_uid TEXT NOT NULL DEFAULT '',
                logical_chunk_id TEXT NOT NULL DEFAULT '',
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                source_kind TEXT NOT NULL DEFAULT 'context_session',
                chunk_start_ts INTEGER NOT NULL,
                chunk_end_ts INTEGER NOT NULL,
                app_name TEXT,
                browser_domain TEXT,
                window_title TEXT,
                document_title TEXT,
                raw_visible_text TEXT NOT NULL DEFAULT '',
                contextual_retrieval_text TEXT NOT NULL DEFAULT '',
                capture_quality REAL NOT NULL DEFAULT 0.0,
                context_version INTEGER NOT NULL DEFAULT 1,
                session_position INTEGER NOT NULL DEFAULT 0,
                session_count INTEGER NOT NULL DEFAULT 1,
                embedded_at INTEGER DEFAULT NULL,
                provider_doc_id TEXT DEFAULT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )

        conn.execute(
            f"""
            INSERT INTO session_retrieval_docs (
                id,
                session_id,
                session_uid,
                logical_chunk_id,
                device_id,
                user_id,
                source_kind,
                chunk_start_ts,
                chunk_end_ts,
                app_name,
                browser_domain,
                window_title,
                document_title,
                raw_visible_text,
                contextual_retrieval_text,
                capture_quality,
                context_version,
                session_position,
                session_count,
                embedded_at,
                provider_doc_id,
                created_at,
                updated_at
            )
            SELECT
                id,
                session_id,
                session_uid,
                logical_chunk_id,
                device_id,
                user_id,
                source_kind,
                chunk_start_ts,
                chunk_end_ts,
                app_name,
                browser_domain,
                window_title,
                document_title,
                raw_visible_text,
                contextual_retrieval_text,
                capture_quality,
                context_version,
                session_position,
                session_count,
                embedded_at,
                provider_doc_id,
                created_at,
                updated_at
            FROM {backup_table}
            """
        )

    def _apply_full_schema(self, conn: Any) -> None:
        for statement in SCHEMA_STATEMENTS:
            conn.execute(statement)
        self._apply_column_migrations(conn)
        self._repair_session_retrieval_docs_schema(conn)
        self._apply_backfills(conn)
        for statement in INDEX_STATEMENTS:
            conn.execute(statement)

    def _open_remote_replica(self, db_path: Path, sync_url: str, auth_token: str):
        last_exc: Exception | None = None
        for attempt in range(1, REPLICA_OPEN_RETRY_LIMIT + 1):
            conn = None
            try:
                conn = libsql.connect(str(db_path), sync_url=sync_url, auth_token=auth_token)
                conn.sync()
                return conn
            except Exception as exc:
                last_exc = exc
                close = getattr(conn, "close", None)
                if callable(close):
                    close()
                if not self._is_retryable_replica_error(exc):
                    raise

                logger.warning(
                    "Resetting local Turso replica cache after retryable sync error: %s",
                    exc,
                )
                self._reset_local_replica_cache(db_path)
                if attempt >= REPLICA_OPEN_RETRY_LIMIT:
                    raise
                time.sleep(min(5.0, 0.5 * attempt))
        if last_exc is not None:
            raise last_exc
        raise TursoProvisioningError("Failed to open remote Turso replica")

    async def _ensure_remote_schema(self, user_id: str, sync_url: str, database_name: str) -> None:
        token, _ = await self.get_cached_database_token(
            database_name,
            expiration=self.server_token_ttl,
            authorization="full-access",
            reuse_window_seconds=10 * 60,
        )
        replica_path = self.replica_path_for_user(user_id)

        def _apply_schema() -> None:
            conn = self._open_remote_replica(replica_path, sync_url, token)
            try:
                self._apply_full_schema(conn)
                conn.commit()
                conn.sync()
            finally:
                close = getattr(conn, "close", None)
                if callable(close):
                    close()

        await asyncio.to_thread(_apply_schema)

    async def _ensure_remote_schema_once(self, user_id: str, sync_url: str, database_name: str) -> None:
        if database_name in self._schema_ready_dbs:
            return

        async with self._schema_ready_lock:
            if database_name in self._schema_ready_dbs:
                return
            await self._ensure_remote_schema(user_id, sync_url, database_name)
            self._schema_ready_dbs.add(database_name)

    async def ensure_user_activity_database(self, user_id: str) -> Optional[UserDB]:
        await self.ensure_user_activity_metadata(user_id)
        return await self._load_user(user_id)

    def _legacy_activity_db_path(self) -> Path:
        try:
            from database.connection import local_db_path as configured_local_db_path

            return Path(configured_local_db_path)
        except Exception:
            return Path(__file__).parent.parent / ".turso_replica.db"

    def _shared_activity_query(
        self,
        query: str,
        params: tuple[Any, ...],
    ) -> Any:
        db_path = self._legacy_activity_db_path()
        if not db_path.exists():
            raise TursoProvisioningError(f"Shared activity replica is missing at {db_path}")
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5.0)
        try:
            return conn.execute(query, params).fetchall()
        finally:
            conn.close()

    def build_import_database_name(self, user_id: str) -> str:
        base_name = self.build_database_name(user_id)
        suffix = datetime.now(timezone.utc).strftime("%m%d%H%M%S")
        trailer = f"-import-{suffix}"
        max_base_length = 47 - len(trailer)
        trimmed_base = base_name[:max_base_length].rstrip("-")
        return f"{trimmed_base}{trailer}"

    def import_seed_path_for_user(self, user_id: str) -> Path:
        hashed = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]
        return self.import_seed_dir / f"{hashed}.db"

    def _compute_source_counts(self, source_path: Path, source_user_id: str) -> Dict[str, int]:
        conn = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True, timeout=10.0)
        try:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
            }
            counts: Dict[str, int] = {}
            for table_name in MIGRATION_TABLES:
                if table_name not in tables:
                    counts[table_name] = 0
                    continue
                counts[table_name] = int(
                    conn.execute(
                        f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                        (source_user_id,),
                    ).fetchone()[0]
                )
            return counts
        finally:
            conn.close()

    def _build_filtered_import_seed(
        self,
        *,
        source_path: Path,
        seed_path: Path,
        source_user_id: str,
        target_user_id: str,
    ) -> Dict[str, int]:
        self._reset_local_replica_cache(seed_path)
        if seed_path.exists():
            seed_path.unlink()

        conn = sqlite3.connect(seed_path)
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            self._apply_full_schema(conn)
            conn.execute("ATTACH DATABASE ? AS source_db", (str(source_path),))
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM source_db.sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
            counts: Dict[str, int] = {}
            for table_name in MIGRATION_TABLES:
                if table_name not in tables:
                    counts[table_name] = 0
                    continue
                columns = [
                    row[1]
                    for row in conn.execute(f"PRAGMA source_db.table_info({table_name})").fetchall()
                ]
                if not columns:
                    counts[table_name] = 0
                    continue

                select_parts = []
                params: list[Any] = []
                for column in columns:
                    if column == "user_id":
                        select_parts.append("? AS user_id")
                        params.append(target_user_id)
                    else:
                        select_parts.append(column)
                column_list = ", ".join(columns)
                select_list = ", ".join(select_parts)
                params.append(source_user_id)
                conn.execute(
                    f"""
                    INSERT OR IGNORE INTO {table_name} ({column_list})
                    SELECT {select_list}
                    FROM source_db.{table_name}
                    WHERE user_id = ?
                    """,
                    tuple(params),
                )
                counts[table_name] = int(
                    conn.execute(
                        f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0]
                )
            conn.commit()
            conn.execute("DETACH DATABASE source_db")
            self._apply_backfills(conn)
            for statement in INDEX_STATEMENTS:
                conn.execute(statement)
            conn.commit()
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.commit()
            return counts
        finally:
            conn.close()

    async def _upload_database_file(self, hostname: str, auth_token: str, db_path: Path) -> None:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
            with db_path.open("rb") as handle:
                response = await client.post(
                    f"https://{hostname}/v1/upload",
                    headers={"Authorization": f"Bearer {auth_token}"},
                    content=handle.read(),
                )
        if response.status_code != 200:
            detail = response.text.strip()
            raise TursoProvisioningError(
                f"Turso upload failed with {response.status_code}: {detail}"
            )

    async def migrate_rollout_user_if_needed(
        self,
        user_id: str,
        *,
        source_user_id: Optional[str] = None,
        source_db_path: Optional[str | Path] = None,
    ) -> UserDB:
        user = await self.ensure_user_activity_database(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")
        if user.turso_migrated_at is not None:
            return user
        if not self.is_rollout_gate_user(user_id):
            return user
        await self._migrate_user_rows(
            user,
            source_user_id=self.resolve_migration_source_user_id(user_id, source_user_id),
            source_db_path=source_db_path,
        )
        return await self._load_user(user_id) or user

    async def migrate_user(
        self,
        user_id: str,
        *,
        source_user_id: Optional[str] = None,
        source_db_path: Optional[str | Path] = None,
        strategy: Literal["replica", "import"] = "replica",
    ) -> UserDB:
        user = await self.ensure_user_activity_database(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")
        if user.turso_migrated_at is None:
            if strategy == "import":
                await self._import_user_database(
                    user,
                    source_user_id=self.resolve_migration_source_user_id(user_id, source_user_id),
                    source_db_path=source_db_path,
                )
            else:
                await self._migrate_user_rows(
                    user,
                    source_user_id=self.resolve_migration_source_user_id(user_id, source_user_id),
                    source_db_path=source_db_path,
                )
        return await self._load_user(user_id) or user

    async def _verify_database_counts(
        self,
        *,
        target_user_id: str,
        database_name: str,
        sync_url: str,
        expected_counts: Dict[str, int],
    ) -> Dict[str, Dict[str, int]]:
        token = await self._mint_database_token(
            database_name,
            expiration=self.server_token_ttl,
            authorization="full-access",
        )
        replica_path = self.replica_dir / f"{database_name}.verify.db"

        def _read_counts() -> Dict[str, Dict[str, int]]:
            remote = self._open_remote_replica(replica_path, sync_url, token)
            try:
                counts: Dict[str, Dict[str, int]] = {}
                for table_name in ("context_snapshots", "session_retrieval_docs", "context_sessions", "activity_events", "afk_events"):
                    target_count = int(
                        remote.execute(
                            f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                            (target_user_id,),
                        ).fetchone()[0]
                    )
                    counts[table_name] = {
                        "source": int(expected_counts.get(table_name, 0)),
                        "target": target_count,
                    }
                return counts
            finally:
                close = getattr(remote, "close", None)
                if callable(close):
                    close()
                self._reset_local_replica_cache(replica_path)

        return await asyncio.to_thread(_read_counts)

    async def _import_user_database(
        self,
        user: UserDB,
        *,
        source_user_id: Optional[str] = None,
        source_db_path: Optional[str | Path] = None,
    ) -> None:
        source_user_id = self.resolve_migration_source_user_id(user.id, source_user_id)
        resolved_source_db_path = self.resolve_migration_source_db_path(source_db_path)
        if not resolved_source_db_path.exists():
            raise TursoProvisioningError(f"Migration source DB is missing at {resolved_source_db_path}")

        seed_path = self.import_seed_path_for_user(user.id)
        expected_counts = await asyncio.to_thread(
            self._build_filtered_import_seed,
            source_path=resolved_source_db_path,
            seed_path=seed_path,
            source_user_id=source_user_id,
            target_user_id=user.id,
        )

        import_database_name = self.build_import_database_name(user.id)
        database = await self._create_database(
            import_database_name,
            seed={"type": "database_upload"},
        )
        hostname = str(database.get("Hostname") or "").strip()
        if not hostname:
            refreshed = await self._retrieve_database(import_database_name)
            hostname = str((refreshed or {}).get("Hostname") or "").strip()
        if not hostname:
            raise TursoProvisioningError(
                f"Turso import database {import_database_name} is missing a hostname"
            )

        upload_token = await self._mint_database_token(
            import_database_name,
            expiration=self.migration_token_ttl,
            authorization="full-access",
        )
        await self._upload_database_file(hostname, upload_token, seed_path)
        sync_url = self.sync_url_for_hostname(hostname)
        counts = await self._verify_database_counts(
            target_user_id=user.id,
            database_name=import_database_name,
            sync_url=sync_url,
            expected_counts=expected_counts,
        )

        for table_name, count_pair in counts.items():
            if count_pair["source"] != count_pair["target"]:
                raise TursoProvisioningError(
                    f"Import verification failed for {table_name}: "
                    f"source={count_pair['source']} target={count_pair['target']}"
                )

        if self.is_rollout_gate_user(user.id):
            for table_name, minimum in ROLLOUT_COUNT_MINIMUMS.items():
                actual = counts.get(table_name, {}).get("target", 0)
                if actual < minimum:
                    raise TursoProvisioningError(
                        f"Migration gate failed for {table_name}: expected at least {minimum}, got {actual}"
                    )

        await self._update_user_turso_metadata(
            user.id,
            database_name=import_database_name,
            sync_url=sync_url,
            provisioned_at=user.turso_provisioned_at or datetime.utcnow(),
            migrated_at=datetime.utcnow(),
        )
        logger.info(
            "Marked user %s as migrated to imported per-user Turso DB %s",
            user.id,
            import_database_name,
        )

    async def _migrate_user_rows(
        self,
        user: UserDB,
        *,
        source_user_id: Optional[str] = None,
        source_db_path: Optional[str | Path] = None,
    ) -> None:
        if not user.turso_db_name or not user.turso_db_url:
            raise TursoProvisioningError("Cannot migrate user without Turso database metadata")
        source_user_id = self.resolve_migration_source_user_id(user.id, source_user_id)
        resolved_source_db_path = self.resolve_migration_source_db_path(source_db_path)

        token = await self._mint_database_token(
            user.turso_db_name,
            expiration=self.migration_token_ttl,
            authorization="full-access",
        )
        replica_path = self.replica_path_for_user(user.id)

        def _copy_and_verify() -> Dict[str, Dict[str, int]]:
            current_token = token
            remote = self._open_remote_replica(replica_path, user.turso_db_url, current_token)
            source_path = resolved_source_db_path
            if not source_path.exists():
                raise TursoProvisioningError(f"Migration source DB is missing at {source_path}")

            source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True, timeout=10.0)
            source.row_factory = sqlite3.Row

            def _refresh_token() -> str:
                return asyncio.run(
                    self._mint_database_token(
                        user.turso_db_name,
                        expiration=self.migration_token_ttl,
                        authorization="full-access",
                    )
                )

            def _reopen_remote(*, refresh_token: bool = False) -> Any:
                nonlocal current_token
                close = getattr(remote, "close", None)
                if callable(close):
                    close()
                if refresh_token:
                    current_token = _refresh_token()
                return self._open_remote_replica(replica_path, user.turso_db_url, current_token)

            def _should_refresh_token(exc: Exception) -> bool:
                message = str(exc).lower()
                return (
                    "401 unauthorized" in message
                    or "token expired" in message
                    or "invalid jwt token" in message
                )

            def _should_force_fresh_remote(exc: Exception, attempt: int) -> bool:
                message = str(exc).lower()
                return "stream not found" in message or attempt % 5 == 0

            try:
                try:
                    self._apply_full_schema(remote)
                except Exception as exc:
                    if _should_refresh_token(exc):
                        remote = _reopen_remote(refresh_token=True)
                        self._apply_full_schema(remote)
                    else:
                        raise

                for table_name in MIGRATION_TABLES:
                    columns = [
                        row[1]
                        for row in source.execute(f"PRAGMA table_info({table_name})").fetchall()
                    ]
                    if not columns:
                        continue

                    column_list = ", ".join(columns)
                    placeholders = ", ".join(["?"] * len(columns))
                    user_id_index = next(
                        (index for index, column in enumerate(columns) if column == "user_id"),
                        None,
                    )
                    last_id = int(
                        (
                            remote.execute(
                                f"SELECT COALESCE(MAX(id), 0) FROM {table_name} WHERE user_id = ?",
                                (user.id,),
                            ).fetchone()[0]
                            or 0
                        )
                    )

                    while True:
                        rows = source.execute(
                            f"""
                            SELECT {column_list}
                            FROM {table_name}
                            WHERE user_id = ? AND id > ?
                            ORDER BY id ASC
                            LIMIT ?
                            """,
                            (source_user_id, last_id, MIGRATION_BATCH_SIZE),
                        ).fetchall()
                        if not rows:
                            break

                        transformed_rows = []
                        for row in rows:
                            values = list(row)
                            if user_id_index is not None:
                                values[user_id_index] = user.id
                            transformed_rows.append(tuple(values))

                        batch_attempt = 0
                        while True:
                            try:
                                for values in transformed_rows:
                                    remote.execute(
                                        f"INSERT OR IGNORE INTO {table_name} ({column_list}) VALUES ({placeholders})",
                                        values,
                                    )
                                remote.commit()
                                remote.sync()
                                remote = _reopen_remote()
                                last_id = int(rows[-1]["id"])
                                break
                            except Exception as exc:
                                batch_attempt += 1
                                if batch_attempt >= MIGRATION_BATCH_RETRY_LIMIT:
                                    raise
                                if _should_refresh_token(exc):
                                    time.sleep(min(8.0, 0.5 * (2 ** min(batch_attempt - 1, 4))))
                                    remote = _reopen_remote(refresh_token=True)
                                    continue
                                if self._is_retryable_replica_error(exc):
                                    time.sleep(min(8.0, 0.5 * (2 ** min(batch_attempt - 1, 4))))
                                    remote = _reopen_remote(
                                        refresh_token=_should_force_fresh_remote(exc, batch_attempt)
                                    )
                                    continue
                                raise

                try:
                    self._apply_backfills(remote)
                    remote.commit()
                    remote.sync()
                    remote = _reopen_remote()
                except Exception as exc:
                    if _should_refresh_token(exc):
                        remote = _reopen_remote(refresh_token=True)
                        self._apply_backfills(remote)
                        remote.commit()
                        remote.sync()
                        remote = _reopen_remote()
                    else:
                        raise

                counts: Dict[str, Dict[str, int]] = {}
                for table_name in ("context_snapshots", "session_retrieval_docs", "context_sessions", "activity_events"):
                    source_count = int(
                        source.execute(
                            f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                            (source_user_id,),
                        ).fetchone()[0]
                    )
                    try:
                        target_count = int(
                            remote.execute(
                                f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                                (user.id,),
                            ).fetchone()[0]
                        )
                    except Exception as exc:
                        if _should_refresh_token(exc):
                            remote = _reopen_remote(refresh_token=True)
                            target_count = int(
                                remote.execute(
                                    f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                                    (user.id,),
                                ).fetchone()[0]
                            )
                        else:
                            raise
                    counts[table_name] = {"source": source_count, "target": target_count}
                return counts
            finally:
                source.close()
                close = getattr(remote, "close", None)
                if callable(close):
                    close()

        counts = await asyncio.to_thread(_copy_and_verify)

        for table_name, count_pair in counts.items():
            if count_pair["source"] != count_pair["target"]:
                raise TursoProvisioningError(
                    f"Migration verification failed for {table_name}: "
                    f"source={count_pair['source']} target={count_pair['target']}"
                )

        if self.is_rollout_gate_user(user.id):
            for table_name, minimum in ROLLOUT_COUNT_MINIMUMS.items():
                actual = counts.get(table_name, {}).get("target", 0)
                if actual < minimum:
                    raise TursoProvisioningError(
                        f"Migration gate failed for {table_name}: expected at least {minimum}, got {actual}"
                    )

        await self._update_user_turso_metadata(
            user.id,
            database_name=user.turso_db_name,
            sync_url=user.turso_db_url,
            migrated_at=datetime.utcnow(),
        )
        logger.info("Marked user %s as migrated to per-user Turso DB %s", user.id, user.turso_db_name)

    async def get_user_migration_counts(
        self,
        user_id: str,
        *,
        source_user_id: Optional[str] = None,
        source_db_path: Optional[str | Path] = None,
    ) -> Dict[str, Dict[str, int]]:
        user = await self.ensure_user_activity_database(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")
        if not user.turso_db_name or not user.turso_db_url:
            raise TursoProvisioningError("Per-user Turso database metadata is missing")
        source_user_id = self.resolve_migration_source_user_id(user.id, source_user_id)
        resolved_source_db_path = self.resolve_migration_source_db_path(source_db_path)

        token = await self._mint_database_token(
            user.turso_db_name,
            expiration=self.server_token_ttl,
            authorization="full-access",
        )
        replica_path = self.replica_path_for_user(user.id)

        def _counts() -> Dict[str, Dict[str, int]]:
            remote = self._open_remote_replica(replica_path, user.turso_db_url, token)
            source_path = resolved_source_db_path
            if not source_path.exists():
                raise TursoProvisioningError(f"Migration source DB is missing at {source_path}")

            source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True, timeout=10.0)
            try:
                counts: Dict[str, Dict[str, int]] = {}
                for table_name in MIGRATION_TABLES:
                    source_count = int(
                        source.execute(
                            f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                            (source_user_id,),
                        ).fetchone()[0]
                    )
                    try:
                        target_count = int(
                            remote.execute(
                                f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                                (user.id,),
                            ).fetchone()[0]
                        )
                    except Exception:
                        target_count = 0
                    counts[table_name] = {"source": source_count, "target": target_count}
                return counts
            finally:
                source.close()
                close = getattr(remote, "close", None)
                if callable(close):
                    close()

        return await asyncio.to_thread(_counts)

    async def get_user_migration_status(
        self,
        user_id: str,
        *,
        source_user_id: Optional[str] = None,
        source_db_path: Optional[str | Path] = None,
    ) -> Dict[str, Any]:
        user = await self.ensure_user_activity_database(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")

        source_user_id = self.resolve_migration_source_user_id(user_id, source_user_id)
        resolved_source_db_path = self.resolve_migration_source_db_path(source_db_path)
        counts = await self.get_user_migration_counts(
            user_id,
            source_user_id=source_user_id,
            source_db_path=resolved_source_db_path,
        )
        exact_match = {
            table_name: (pair["source"] == pair["target"])
            for table_name, pair in counts.items()
        }
        rollout_floor_ok: Dict[str, bool] = {}
        if self.is_rollout_gate_user(user_id):
            rollout_floor_ok = {
                table_name: counts.get(table_name, {}).get("target", 0) >= minimum
                for table_name, minimum in ROLLOUT_COUNT_MINIMUMS.items()
            }

        return {
            "user_id": user.id,
            "source_user_id": source_user_id,
            "source_db_path": str(resolved_source_db_path),
            "database_name": user.turso_db_name,
            "sync_url": user.turso_db_url,
            "provisioned_at": user.turso_provisioned_at.isoformat() if user.turso_provisioned_at else None,
            "migrated_at": user.turso_migrated_at.isoformat() if user.turso_migrated_at else None,
            "is_rollout_gate_user": self.is_rollout_gate_user(user_id),
            "counts": counts,
            "exact_match": exact_match,
            "rollout_floor_ok": rollout_floor_ok,
        }

    async def get_user_activity_access(self, user_id: str) -> UserActivityAccess:
        user = await self._load_user_turso_metadata(user_id)
        if user and user.turso_migrated_at and user.turso_db_name and user.turso_db_url:
            return UserActivityAccess(
                mode="per-user",
                sync_url=user.turso_db_url,
                database_name=user.turso_db_name,
                use_per_user_db=True,
            )
        return UserActivityAccess(mode="legacy", use_per_user_db=False)

    async def get_desktop_sync_config(self, user_id: str) -> DesktopSyncConfig:
        if not self.is_platform_configured():
            raise TursoProvisioningError("Per-user Turso sync is not configured")

        user = await self.ensure_user_activity_metadata(user_id)

        if user is None or not user.turso_db_name or not user.turso_db_url:
            raise TursoProvisioningError("Per-user Turso database metadata is missing")

        if self.is_rollout_gate_user(user_id) and user.turso_migrated_at is None:
            raise TursoProvisioningError("Per-user Turso migration has not completed yet")

        token, expires_at_epoch = await self.get_cached_database_token(
            user.turso_db_name,
            expiration=self.desktop_token_ttl,
            authorization="full-access",
            reuse_window_seconds=60 * 60,
        )
        expires_at = datetime.fromtimestamp(expires_at_epoch, tz=timezone.utc).isoformat()
        return DesktopSyncConfig(
            sync_url=user.turso_db_url,
            auth_token=token,
            expires_at=expires_at,
            database_name=user.turso_db_name,
        )


turso_user_service = TursoUserService()
