"""Per-user Turso provisioning, migration, and token minting."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx
import libsql_experimental as libsql
from sqlalchemy import select

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

SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS context_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        session_id INTEGER,
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
        session_id INTEGER NOT NULL UNIQUE,
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
)

INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_context_sessions_time ON context_sessions(start_ts, end_ts)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_ts_start ON activity_events(ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_ts_end ON activity_events(ts_end)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_user_device_ts ON activity_events(user_id, device_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_domain ON activity_events(browser_domain)",
    "CREATE INDEX IF NOT EXISTS idx_afk_events_user_device_ts ON afk_events(user_id, device_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_ts ON context_snapshots(ts)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_app_ts ON context_snapshots(app_bundle_id, ts)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_domain_ts ON context_snapshots(browser_domain, ts)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_context_snapshots_dedup ON context_snapshots(dedup_key)",
    "CREATE INDEX IF NOT EXISTS idx_context_snapshots_session_ts ON context_snapshots(session_id, ts)",
    "CREATE INDEX IF NOT EXISTS idx_session_retrieval_docs_time ON session_retrieval_docs(chunk_start_ts, chunk_end_ts)",
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
        self.migration_source_user_id = (os.getenv("TURSO_MIGRATION_SOURCE_USER_ID") or "").strip()
        self.replica_dir = Path(__file__).parent.parent / ".turso_user_replicas"
        self.replica_dir.mkdir(parents=True, exist_ok=True)

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

    def replica_path_for_user(self, user_id: str) -> Path:
        hashed = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]
        return self.replica_dir / f"{hashed}.db"

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

    async def _create_database(self, database_name: str) -> Dict[str, Any]:
        payload = await self._platform_request(
            "POST",
            f"/v1/organizations/{self.organization}/databases",
            json_body={"name": database_name, "group": self.group},
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

    async def _load_user(self, user_id: str) -> Optional[UserDB]:
        async with get_db_session() as session:
            result = await session.execute(select(UserDB).where(UserDB.id == user_id))
            return result.scalar_one_or_none()

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
            result = await session.execute(select(UserDB).where(UserDB.id == user_id))
            user = result.scalar_one_or_none()
            if user is None:
                raise TursoProvisioningError(f"User {user_id} not found while updating Turso metadata")

            user.turso_db_name = database_name
            user.turso_db_url = sync_url
            if provisioned_at is not None and user.turso_provisioned_at is None:
                user.turso_provisioned_at = provisioned_at
            if migrated_at is not None:
                user.turso_migrated_at = migrated_at
            user.updated_at = datetime.utcnow()
            await session.commit()

    def _open_remote_replica(self, db_path: Path, sync_url: str, auth_token: str):
        conn = libsql.connect(str(db_path), sync_url=sync_url, auth_token=auth_token)
        conn.sync()
        return conn

    async def _ensure_remote_schema(self, user_id: str, sync_url: str, database_name: str) -> None:
        token = await self._mint_database_token(
            database_name,
            expiration=self.server_token_ttl,
            authorization="full-access",
        )
        replica_path = self.replica_path_for_user(user_id)

        def _apply_schema() -> None:
            conn = self._open_remote_replica(replica_path, sync_url, token)
            try:
                for statement in SCHEMA_STATEMENTS:
                    conn.execute(statement)
                for statement in INDEX_STATEMENTS:
                    conn.execute(statement)
                conn.commit()
                conn.sync()
            finally:
                close = getattr(conn, "close", None)
                if callable(close):
                    close()

        await asyncio.to_thread(_apply_schema)

    async def ensure_user_activity_database(self, user_id: str) -> Optional[UserDB]:
        user = await self._load_user(user_id)
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

    async def migrate_rollout_user_if_needed(
        self,
        user_id: str,
        *,
        source_user_id: Optional[str] = None,
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
        )
        return await self._load_user(user_id) or user

    async def migrate_user(self, user_id: str, *, source_user_id: Optional[str] = None) -> UserDB:
        user = await self.ensure_user_activity_database(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")
        if user.turso_migrated_at is None:
            await self._migrate_user_rows(
                user,
                source_user_id=self.resolve_migration_source_user_id(user_id, source_user_id),
            )
        return await self._load_user(user_id) or user

    async def _migrate_user_rows(
        self,
        user: UserDB,
        *,
        source_user_id: Optional[str] = None,
    ) -> None:
        if not user.turso_db_name or not user.turso_db_url:
            raise TursoProvisioningError("Cannot migrate user without Turso database metadata")
        source_user_id = self.resolve_migration_source_user_id(user.id, source_user_id)

        token = await self._mint_database_token(
            user.turso_db_name,
            expiration=self.server_token_ttl,
            authorization="full-access",
        )
        replica_path = self.replica_path_for_user(user.id)

        def _copy_and_verify() -> Dict[str, Dict[str, int]]:
            remote = self._open_remote_replica(replica_path, user.turso_db_url, token)
            source_path = self._legacy_activity_db_path()
            if not source_path.exists():
                raise TursoProvisioningError(f"Shared activity replica is missing at {source_path}")

            source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True, timeout=10.0)
            source.row_factory = sqlite3.Row
            try:
                for statement in SCHEMA_STATEMENTS:
                    remote.execute(statement)
                for statement in INDEX_STATEMENTS:
                    remote.execute(statement)

                for table_name in MIGRATION_TABLES:
                    columns = [
                        row[1]
                        for row in source.execute(f"PRAGMA table_info({table_name})").fetchall()
                    ]
                    if not columns:
                        continue
                    column_list = ", ".join(columns)
                    placeholders = ", ".join(["?"] * len(columns))
                    rows = source.execute(
                        f"SELECT {column_list} FROM {table_name} WHERE user_id = ? ORDER BY id ASC",
                        (source_user_id,),
                    ).fetchall()
                    user_id_index = next(
                        (index for index, column in enumerate(columns) if column == "user_id"),
                        None,
                    )
                    for row in rows:
                        values = list(row)
                        if user_id_index is not None:
                            values[user_id_index] = user.id
                        remote.execute(
                            f"INSERT OR IGNORE INTO {table_name} ({column_list}) VALUES ({placeholders})",
                            tuple(values),
                        )

                remote.commit()
                remote.sync()

                counts: Dict[str, Dict[str, int]] = {}
                for table_name in ("context_snapshots", "session_retrieval_docs", "context_sessions", "activity_events"):
                    source_count = int(
                        source.execute(
                            f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                            (source_user_id,),
                        ).fetchone()[0]
                    )
                    target_count = int(
                        remote.execute(
                            f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
                            (user.id,),
                        ).fetchone()[0]
                    )
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
    ) -> Dict[str, Dict[str, int]]:
        user = await self.ensure_user_activity_database(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")
        if not user.turso_db_name or not user.turso_db_url:
            raise TursoProvisioningError("Per-user Turso database metadata is missing")
        source_user_id = self.resolve_migration_source_user_id(user.id, source_user_id)

        token = await self._mint_database_token(
            user.turso_db_name,
            expiration=self.server_token_ttl,
            authorization="full-access",
        )
        replica_path = self.replica_path_for_user(user.id)

        def _counts() -> Dict[str, Dict[str, int]]:
            remote = self._open_remote_replica(replica_path, user.turso_db_url, token)
            source_path = self._legacy_activity_db_path()
            if not source_path.exists():
                raise TursoProvisioningError(f"Shared activity replica is missing at {source_path}")

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
    ) -> Dict[str, Any]:
        user = await self.ensure_user_activity_database(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")

        source_user_id = self.resolve_migration_source_user_id(user_id, source_user_id)
        counts = await self.get_user_migration_counts(user_id, source_user_id=source_user_id)
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
        user = await self._load_user(user_id)
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

        user = await self._load_user(user_id)
        if user is None:
            raise TursoProvisioningError(f"User {user_id} does not exist")

        if not user.turso_db_name or not user.turso_db_url:
            user = await self.ensure_user_activity_database(user_id)

        if user is None or not user.turso_db_name or not user.turso_db_url:
            raise TursoProvisioningError("Per-user Turso database metadata is missing")

        if self.is_rollout_gate_user(user_id) and user.turso_migrated_at is None:
            raise TursoProvisioningError("Per-user Turso migration has not completed yet")

        token = await self._mint_database_token(
            user.turso_db_name,
            expiration=self.desktop_token_ttl,
            authorization="full-access",
        )
        expires_at = (datetime.now(timezone.utc) + self._ttl_to_timedelta(self.desktop_token_ttl)).isoformat()
        return DesktopSyncConfig(
            sync_url=user.turso_db_url,
            auth_token=token,
            expires_at=expires_at,
            database_name=user.turso_db_name,
        )


turso_user_service = TursoUserService()
