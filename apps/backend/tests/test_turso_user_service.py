import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.turso_user_service import (
    SCHEMA_STATEMENTS,
    TursoProvisioningError,
    TursoUserService,
)


class _SQLiteReplica:
    def __init__(self, path: str):
        self._conn = sqlite3.connect(path)

    def execute(self, *args, **kwargs):
        return self._conn.execute(*args, **kwargs)

    def commit(self):
        return self._conn.commit()

    def close(self):
        return self._conn.close()

    def sync(self):
        return None


class _FailingCommitReplica(_SQLiteReplica):
    should_fail_once = True

    def commit(self):
        if _FailingCommitReplica.should_fail_once:
            _FailingCommitReplica.should_fail_once = False
            raise ValueError('SqliteFailure(7, "wal_insert_frame failed")')
        return super().commit()


class _TimeoutReplica(_SQLiteReplica):
    should_fail_once = True

    def execute(self, *args, **kwargs):
        if _TimeoutReplica.should_fail_once and str(args[0]).startswith("INSERT OR IGNORE INTO"):
            _TimeoutReplica.should_fail_once = False
            raise ValueError("sync error: http dispatch error: connection error: Operation timed out (os error 60)")
        return super().execute(*args, **kwargs)


class _SyncFailReplica:
    remaining_failures = 1
    sync_calls = 0

    def __init__(self, path: str):
        self.path = path

    def sync(self):
        _SyncFailReplica.sync_calls += 1
        if _SyncFailReplica.remaining_failures > 0:
            _SyncFailReplica.remaining_failures -= 1
            raise ValueError('SqliteFailure(7, "wal_insert_frame failed")')
        return None


class _FakeExecuteResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _FakeMetadataSession:
    def __init__(self, row):
        self._row = row

    async def execute(self, *args, **kwargs):
        return _FakeExecuteResult(self._row)


def _prepare_schema(path: str) -> None:
    conn = sqlite3.connect(path)
    try:
        for statement in SCHEMA_STATEMENTS:
            conn.execute(statement)
        conn.commit()
    finally:
        conn.close()


def _seed_rollout_user_source(path: str, user_id: str) -> None:
    conn = sqlite3.connect(path)
    try:
        now_ms = 1_710_000_000_000
        conn.execute(
            """
            INSERT INTO context_sessions (
                id, device_id, user_id, start_ts, end_ts, primary_app_bundle_id,
                primary_app_name, primary_domain, dominant_title, representative_text,
                coverage_score, snapshot_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                "device-1",
                user_id,
                now_ms - 50_000,
                now_ms - 10_000,
                "com.todesktop.cursor",
                "Cursor",
                "",
                "feature work",
                "implemented migration gate",
                0.9,
                1,
                now_ms,
                now_ms,
            ),
        )
        conn.execute(
            """
            INSERT INTO activity_events (
                id, device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                window_title, window_title_hash, window_owner_pid, is_afk, browser_url,
                browser_domain, is_incognito, source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                "device-1",
                user_id,
                now_ms - 50_000,
                now_ms - 10_000,
                "com.todesktop.cursor",
                "Cursor",
                "feature work",
                None,
                None,
                0,
                None,
                None,
                0,
                "ritual_watcher_v2",
                now_ms,
            ),
        )
        conn.execute(
            """
            INSERT INTO context_snapshots (
                id, device_id, user_id, activity_event_id, session_id, ts, source_type,
                app_bundle_id, app_name, window_title, browser_url, browser_domain,
                tab_title, document_title, visible_text_raw, visible_text_norm,
                capture_quality, capture_components_json, ax_richness_score,
                selected_text_present, document_path, ax_source, capture_trigger,
                trigger_to_snapshot_ms, ui_elements_json, dedup_key,
                is_sensitive_redacted, semantic_summary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                "device-1",
                user_id,
                1,
                1,
                now_ms - 20_000,
                "ax",
                "com.todesktop.cursor",
                "Cursor",
                "feature work",
                None,
                None,
                None,
                "migration gate plan",
                "implemented migration gate",
                "implemented migration gate",
                0.95,
                None,
                0.8,
                0,
                None,
                None,
                "ax_event",
                0,
                None,
                "dedup-1",
                0,
                None,
                now_ms,
                now_ms,
            ),
        )
        conn.execute(
            """
            INSERT INTO session_retrieval_docs (
                id, session_id, device_id, user_id, source_kind, chunk_start_ts,
                chunk_end_ts, app_name, browser_domain, window_title, document_title,
                raw_visible_text, contextual_retrieval_text, capture_quality,
                context_version, session_position, session_count, embedded_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                1,
                "device-1",
                user_id,
                "context_session",
                now_ms - 50_000,
                now_ms - 10_000,
                "Cursor",
                None,
                "feature work",
                "migration gate plan",
                "implemented migration gate",
                "implemented migration gate",
                0.9,
                1,
                0,
                1,
                None,
                now_ms,
                now_ms,
            ),
        )
        conn.commit()
    finally:
        conn.close()


class TursoUserServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_load_user_turso_metadata_recovers_from_malformed_shared_replica_once(self):
        service = TursoUserService()
        attempts = {"count": 0}
        fake_row = (
            "user-1",
            "ritual-user-1",
            "libsql://ritual-user-1.turso.io",
            None,
            None,
        )

        @asynccontextmanager
        async def flaky_get_db_session():
            if attempts["count"] == 0:
                attempts["count"] += 1
                raise ValueError("database disk image is malformed")
            yield _FakeMetadataSession(fake_row)

        with patch("services.turso_user_service.get_db_session", flaky_get_db_session), patch.object(
            service,
            "_recover_shared_metadata_replica",
            AsyncMock(return_value=True),
        ) as recover:
            metadata = await service._load_user_turso_metadata("user-1")

        self.assertIsNotNone(metadata)
        self.assertEqual(metadata.id, "user-1")
        self.assertEqual(metadata.turso_db_name, "ritual-user-1")
        self.assertEqual(metadata.turso_db_url, "libsql://ritual-user-1.turso.io")
        recover.assert_awaited_once()

    async def test_ensure_user_activity_database_skips_platform_calls_when_metadata_exists(self):
        service = TursoUserService()
        user = SimpleNamespace(
            id="user-1",
            turso_db_name="ritual-user-1",
            turso_db_url="libsql://ritual-user-1.turso.io",
            turso_provisioned_at="2026-03-27T00:00:00Z",
        )

        with patch.object(service, "_load_user_turso_metadata", AsyncMock(return_value=user)), patch.object(
            service,
            "_load_user",
            AsyncMock(return_value=user),
        ), patch.object(
            service,
            "_retrieve_database",
            AsyncMock(side_effect=AssertionError("should not call platform API")),
        ), patch.object(
            service,
            "_ensure_remote_schema",
            AsyncMock(side_effect=AssertionError("should not ensure schema")),
        ):
            result = await service.ensure_user_activity_database("user-1")

        self.assertIs(result, user)

    async def test_get_desktop_sync_config_uses_existing_metadata_without_reprovisioning(self):
        service = TursoUserService()
        user = SimpleNamespace(
            id="user-1",
            turso_db_name="ritual-user-1",
            turso_db_url="libsql://ritual-user-1.turso.io",
            turso_provisioned_at="2026-03-27T00:00:00Z",
            turso_migrated_at="2026-03-27T00:01:00Z",
        )

        with patch.object(service, "is_platform_configured", return_value=True), patch.object(
            service,
            "ensure_user_activity_metadata",
            AsyncMock(return_value=user),
        ), patch.object(
            service,
            "_mint_database_token",
            AsyncMock(return_value="desktop-token"),
        ):
            config = await service.get_desktop_sync_config("user-1")

        self.assertEqual(config.sync_url, "libsql://ritual-user-1.turso.io")
        self.assertEqual(config.auth_token, "desktop-token")
        self.assertEqual(config.database_name, "ritual-user-1")

    async def test_get_desktop_sync_config_refuses_rollout_user_until_operator_migration_completes(self):
        service = TursoUserService()
        user = SimpleNamespace(
            id="rollout-user",
            turso_db_name="ritual-user-rollout",
            turso_db_url="libsql://ritual-user-rollout.turso.io",
            turso_provisioned_at="2026-03-27T00:00:00Z",
            turso_migrated_at=None,
        )

        with patch.object(service, "is_platform_configured", return_value=True), patch.object(
            service,
            "ensure_user_activity_metadata",
            AsyncMock(return_value=user),
        ), patch.object(
            service,
            "is_rollout_gate_user",
            return_value=True,
        ), patch.object(
            service,
            "migrate_rollout_user_if_needed",
            AsyncMock(side_effect=AssertionError("should not auto-migrate")),
        ):
            with self.assertRaises(TursoProvisioningError) as exc:
                await service.get_desktop_sync_config("rollout-user")

        self.assertIn("migration has not completed", str(exc.exception).lower())

    async def test_migrate_user_rows_can_use_explicit_source_db_path(self):
        service = TursoUserService()
        target_user_id = "current-user"
        source_user_id = "legacy-user"

        with tempfile.TemporaryDirectory() as tmp:
            source_path = os.path.join(tmp, "activity.db")
            target_path = os.path.join(tmp, "per-user.db")
            _prepare_schema(source_path)
            _prepare_schema(target_path)
            _seed_rollout_user_source(source_path, source_user_id)

            user = SimpleNamespace(
                id=target_user_id,
                turso_db_name="ritual-user-current",
                turso_db_url="libsql://ritual-user-current.turso.io",
            )

            with patch.object(
                service,
                "_mint_database_token",
                AsyncMock(return_value="server-token"),
            ), patch.object(
                service,
                "_legacy_activity_db_path",
                side_effect=AssertionError("should not use legacy replica"),
            ), patch.object(
                service,
                "_update_user_turso_metadata",
                AsyncMock(),
            ) as update_metadata, patch.object(
                service,
                "is_rollout_gate_user",
                return_value=False,
            ), patch.object(
                service,
                "_open_remote_replica",
                side_effect=lambda _replica_path, _sync_url, _token: _SQLiteReplica(target_path),
            ):
                await service._migrate_user_rows(
                    user,
                    source_user_id=source_user_id,
                    source_db_path=source_path,
                )

            conn = sqlite3.connect(target_path)
            try:
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM context_snapshots WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0],
                    1,
                )
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM session_retrieval_docs WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0],
                    1,
                )
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM context_sessions WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0],
                    1,
                )
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM activity_events WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0],
                    1,
                )
            finally:
                conn.close()

        update_metadata.assert_awaited()

    async def test_rollout_user_does_not_cut_over_before_minimum_counts(self):
        service = TursoUserService()
        user_id = "rollout-user"

        with tempfile.TemporaryDirectory() as tmp:
            source_path = os.path.join(tmp, "shared-replica.db")
            target_path = os.path.join(tmp, "per-user.db")
            _prepare_schema(source_path)
            _prepare_schema(target_path)
            _seed_rollout_user_source(source_path, user_id)

            user = SimpleNamespace(
                id=user_id,
                turso_db_name="ritual-user-rollout",
                turso_db_url="libsql://ritual-user-rollout.turso.io",
            )

            with patch.object(
                service,
                "_mint_database_token",
                AsyncMock(return_value="server-token"),
            ), patch.object(
                service,
                "_legacy_activity_db_path",
                return_value=Path(source_path),
            ), patch.object(
                service,
                "_update_user_turso_metadata",
                AsyncMock(),
            ) as update_metadata, patch.object(
                service,
                "is_rollout_gate_user",
                return_value=True,
            ), patch.object(
                service,
                "_open_remote_replica",
                side_effect=lambda _replica_path, _sync_url, _token: _SQLiteReplica(target_path),
            ):
                with self.assertRaises(TursoProvisioningError) as exc:
                    await service._migrate_user_rows(user)

        self.assertIn("Migration gate failed", str(exc.exception))
        update_metadata.assert_not_awaited()

    async def test_migrate_user_rows_replays_batch_after_retryable_commit_failure(self):
        service = TursoUserService()
        target_user_id = "current-user"
        source_user_id = "legacy-user"

        with tempfile.TemporaryDirectory() as tmp:
            source_path = os.path.join(tmp, "activity.db")
            target_path = os.path.join(tmp, "per-user.db")
            _prepare_schema(source_path)
            _prepare_schema(target_path)
            _seed_rollout_user_source(source_path, source_user_id)
            _FailingCommitReplica.should_fail_once = True

            user = SimpleNamespace(
                id=target_user_id,
                turso_db_name="ritual-user-current",
                turso_db_url="libsql://ritual-user-current.turso.io",
            )

            with patch.object(
                service,
                "_mint_database_token",
                AsyncMock(return_value="server-token"),
            ), patch.object(
                service,
                "_update_user_turso_metadata",
                AsyncMock(),
            ) as update_metadata, patch.object(
                service,
                "is_rollout_gate_user",
                return_value=False,
            ), patch.object(
                service,
                "_open_remote_replica",
                side_effect=lambda _replica_path, _sync_url, _token: _FailingCommitReplica(target_path),
            ):
                await service._migrate_user_rows(
                    user,
                    source_user_id=source_user_id,
                    source_db_path=source_path,
                )

            conn = sqlite3.connect(target_path)
            try:
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM activity_events WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0],
                    1,
                )
            finally:
                conn.close()

        update_metadata.assert_awaited()

    async def test_migrate_user_rows_retries_batch_after_timeout_write_failure(self):
        service = TursoUserService()
        target_user_id = "current-user"
        source_user_id = "legacy-user"

        with tempfile.TemporaryDirectory() as tmp:
            source_path = os.path.join(tmp, "activity.db")
            target_path = os.path.join(tmp, "per-user.db")
            _prepare_schema(source_path)
            _prepare_schema(target_path)
            _seed_rollout_user_source(source_path, source_user_id)
            _TimeoutReplica.should_fail_once = True

            user = SimpleNamespace(
                id=target_user_id,
                turso_db_name="ritual-user-current",
                turso_db_url="libsql://ritual-user-current.turso.io",
            )

            with patch.object(
                service,
                "_mint_database_token",
                AsyncMock(return_value="server-token"),
            ), patch.object(
                service,
                "_update_user_turso_metadata",
                AsyncMock(),
            ) as update_metadata, patch.object(
                service,
                "is_rollout_gate_user",
                return_value=False,
            ), patch.object(
                service,
                "_open_remote_replica",
                side_effect=lambda _replica_path, _sync_url, _token: _TimeoutReplica(target_path),
            ):
                await service._migrate_user_rows(
                    user,
                    source_user_id=source_user_id,
                    source_db_path=source_path,
                )

            conn = sqlite3.connect(target_path)
            try:
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM activity_events WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0],
                    1,
                )
            finally:
                conn.close()

        update_metadata.assert_awaited()

    async def test_open_remote_replica_resets_local_cache_after_retryable_sync_failure(self):
        service = TursoUserService()

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "replica.db"
            for suffix in ("", "-info", "-shm", "-wal"):
                Path(f"{db_path}{suffix}").write_text("stale")

            _SyncFailReplica.remaining_failures = 1
            _SyncFailReplica.sync_calls = 0

            with patch("services.turso_user_service.libsql.connect", side_effect=lambda *args, **kwargs: _SyncFailReplica(str(db_path))):
                conn = service._open_remote_replica(
                    db_path,
                    "libsql://ritual-user-current.turso.io",
                    "server-token",
                )

            self.assertIsInstance(conn, _SyncFailReplica)
            self.assertEqual(_SyncFailReplica.sync_calls, 2)
            for suffix in ("", "-info", "-shm", "-wal"):
                self.assertFalse(Path(f"{db_path}{suffix}").exists())

    async def test_open_remote_replica_retries_multiple_times_for_retryable_sync_failures(self):
        service = TursoUserService()

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "replica.db"
            for suffix in ("", "-info", "-shm", "-wal"):
                Path(f"{db_path}{suffix}").write_text("stale")

            _SyncFailReplica.remaining_failures = 3
            _SyncFailReplica.sync_calls = 0

            with patch("services.turso_user_service.libsql.connect", side_effect=lambda *args, **kwargs: _SyncFailReplica(str(db_path))):
                conn = service._open_remote_replica(
                    db_path,
                    "libsql://ritual-user-current.turso.io",
                    "server-token",
                )

            self.assertIsInstance(conn, _SyncFailReplica)
            self.assertEqual(_SyncFailReplica.sync_calls, 4)

    async def test_import_user_database_builds_seed_and_switches_metadata_only_after_verification(self):
        service = TursoUserService()
        target_user_id = "current-user"
        source_user_id = "legacy-user"

        with tempfile.TemporaryDirectory() as tmp:
            source_path = Path(tmp) / "activity.db"
            _prepare_schema(str(source_path))
            _seed_rollout_user_source(str(source_path), source_user_id)

            user = SimpleNamespace(
                id=target_user_id,
                turso_db_name="ritual-user-current",
                turso_db_url="libsql://ritual-user-current.turso.io",
                turso_provisioned_at=None,
            )

            with patch.object(
                service,
                "_create_database",
                AsyncMock(return_value={"Hostname": "imported-db.example.turso.io"}),
            ) as create_database, patch.object(
                service,
                "_mint_database_token",
                AsyncMock(return_value="upload-token"),
            ), patch.object(
                service,
                "_upload_database_file",
                AsyncMock(),
            ) as upload_database, patch.object(
                service,
                "_verify_database_counts",
                AsyncMock(
                    return_value={
                        "context_snapshots": {"source": 1, "target": 1},
                        "session_retrieval_docs": {"source": 1, "target": 1},
                        "context_sessions": {"source": 1, "target": 1},
                        "activity_events": {"source": 1, "target": 1},
                        "afk_events": {"source": 0, "target": 0},
                    }
                ),
            ), patch.object(
                service,
                "_update_user_turso_metadata",
                AsyncMock(),
            ) as update_metadata, patch.object(
                service,
                "is_rollout_gate_user",
                return_value=False,
            ):
                await service._import_user_database(
                    user,
                    source_user_id=source_user_id,
                    source_db_path=source_path,
                )

            create_database.assert_awaited()
            upload_database.assert_awaited()
            update_metadata.assert_awaited()
            uploaded_seed_path = upload_database.await_args.args[2]
            conn = sqlite3.connect(uploaded_seed_path)
            try:
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM activity_events WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0],
                    1,
                )
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) FROM context_snapshots WHERE user_id = ?",
                        (target_user_id,),
                    ).fetchone()[0],
                    1,
                )
            finally:
                conn.close()
