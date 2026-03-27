import os
import sqlite3
import sys
import tempfile
import unittest
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
