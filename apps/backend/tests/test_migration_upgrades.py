"""Fixture-backed coverage for the Alembic-only backend schema path."""

from __future__ import annotations

import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config


BACKEND_ROOT = Path(__file__).resolve().parents[1]
HEAD_REVISION = "20260904_0001"


LEGACY_SUBSET_SQL = """
PRAGMA foreign_keys=OFF;
CREATE TABLE users (id TEXT PRIMARY KEY, created_at DATETIME, updated_at DATETIME);
CREATE TABLE habits (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, updated_at DATETIME);
CREATE TABLE habit_logs (id TEXT PRIMARY KEY, habit_id TEXT NOT NULL, duration INTEGER, amount REAL, date TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL DEFAULT 'completed', notes TEXT, log_metadata TEXT);
INSERT INTO users(id) VALUES ('u1');
INSERT INTO habits(id,user_id,name,category) VALUES ('h1','u1','Sleep','health');
INSERT INTO habit_logs(id,habit_id,date,status) VALUES ('l1','h1','2026-01-01','completed');

CREATE TABLE import_runs (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,source TEXT NOT NULL,file_hash_sha256 TEXT,status TEXT NOT NULL DEFAULT 'created');
CREATE TABLE import_items (id TEXT PRIMARY KEY,import_run_id TEXT NOT NULL,habit_key TEXT NOT NULL,date TEXT NOT NULL,validation_status TEXT);
CREATE TABLE import_mapping_presets (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,source TEXT NOT NULL,mapping_json TEXT NOT NULL);
CREATE TABLE user_ui_preferences (user_id TEXT PRIMARY KEY, habit_text_color TEXT);

CREATE TABLE scheduled_blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    day TEXT NOT NULL,
    start_minutes INTEGER NOT NULL,
    end_minutes INTEGER NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
INSERT INTO scheduled_blocks(id,user_id,title,day,start_minutes,end_minutes)
VALUES ('sb1','u1','Legacy block','2026-01-01',540,600);

CREATE TABLE watcher_devices (device_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,device_name TEXT NOT NULL,platform TEXT NOT NULL,os_version TEXT,created_at INTEGER NOT NULL,last_seen_at INTEGER);
CREATE TABLE watcher_state (id INTEGER PRIMARY KEY,device_id TEXT NOT NULL,is_enabled INTEGER NOT NULL DEFAULT 0,poll_interval_ms INTEGER NOT NULL DEFAULT 2000,last_seen_ts INTEGER,accessibility_status TEXT NOT NULL DEFAULT 'unknown',title_mode TEXT NOT NULL DEFAULT 'off',truncate_length INTEGER,excluded_bundle_ids TEXT,sync_analytics INTEGER NOT NULL DEFAULT 0,sync_raw_to_cloud INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
CREATE TABLE activity_events (id INTEGER PRIMARY KEY AUTOINCREMENT,device_id TEXT NOT NULL,user_id TEXT NOT NULL,ts_start INTEGER NOT NULL,ts_end INTEGER NOT NULL,app_bundle_id TEXT NOT NULL,app_name TEXT NOT NULL,window_title TEXT,window_title_hash TEXT,window_owner_pid INTEGER,is_afk INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'ritual_watcher_v1',created_at INTEGER NOT NULL);
CREATE TABLE daily_activity_rollups (id INTEGER PRIMARY KEY AUTOINCREMENT,day TEXT NOT NULL,device_id TEXT NOT NULL,user_id TEXT NOT NULL,app_bundle_id TEXT NOT NULL,app_name TEXT NOT NULL,window_title TEXT,window_title_hash TEXT,active_ms INTEGER NOT NULL DEFAULT 0,events_count INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE watcher_sync_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT,device_id TEXT NOT NULL,user_id TEXT NOT NULL,type TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at INTEGER NOT NULL,last_attempt_at INTEGER);
CREATE TABLE watcher_app_exclusions (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,bundle_id TEXT NOT NULL,app_name TEXT,reason TEXT,created_at INTEGER NOT NULL);
"""


class MigrationUpgradeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

    def _database_path(self, name: str) -> Path:
        return Path(self.temp_dir.name) / name

    def _upgrade(self, database_path: Path, revision: str = "head") -> None:
        config = Config(str(BACKEND_ROOT / "alembic.ini"))
        with patch.dict(
            os.environ,
            {"ALEMBIC_DATABASE_URL": f"sqlite:///{database_path}"},
            clear=False,
        ):
            command.upgrade(config, revision)

    @staticmethod
    def _columns(connection: sqlite3.Connection, table_name: str) -> set[str]:
        return {
            row[1]
            for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        }

    def test_empty_database_upgrade_is_complete_and_repeatable(self) -> None:
        database_path = self._database_path("empty.db")
        self._upgrade(database_path)
        self._upgrade(database_path)

        from database.models import Base

        with sqlite3.connect(database_path) as connection:
            self.assertEqual(
                connection.execute("SELECT version_num FROM alembic_version").fetchone()[0],
                HEAD_REVISION,
            )
            for table_name, table in Base.metadata.tables.items():
                actual = self._columns(connection, table_name)
                self.assertTrue(actual, f"missing model table {table_name}")
                self.assertFalse(
                    set(table.columns.keys()) - actual,
                    f"missing model columns on {table_name}",
                )
                actual_indexes = {
                    row[1]
                    for row in connection.execute(
                        f"PRAGMA index_list({table_name})"
                    ).fetchall()
                }
                expected_indexes = {index.name for index in table.indexes if index.name}
                self.assertFalse(
                    expected_indexes - actual_indexes,
                    f"missing model indexes on {table_name}",
                )

    def test_known_legacy_script_subset_destructively_replaces_calendar_only(self) -> None:
        database_path = self._database_path("legacy.db")
        with sqlite3.connect(database_path) as connection:
            connection.executescript(LEGACY_SUBSET_SQL)

        self._upgrade(database_path)
        self._upgrade(database_path)

        with sqlite3.connect(database_path) as connection:
            self.assertEqual(
                connection.execute("SELECT version_num FROM alembic_version").fetchone()[0],
                HEAD_REVISION,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT habit_name FROM habit_logs WHERE id='l1'"
                ).fetchone()[0],
                "Sleep",
            )
            self.assertTrue(
                {
                    "client_event_id",
                    "source",
                    "import_run_id",
                    "source_id",
                    "dedupe_key",
                    "revision",
                    "last_update_idempotency_key",
                }
                <= self._columns(connection, "habit_logs")
            )
            self.assertTrue(
                {"browser_url", "browser_domain", "is_incognito", "event_uid"}
                <= self._columns(connection, "activity_events")
            )
            self.assertTrue(
                {"browser_domain", "afk_ms"}
                <= self._columns(connection, "daily_activity_rollups")
            )
            self.assertIn(
                "overview_view_mode",
                self._columns(connection, "user_ui_preferences"),
            )
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertNotIn("scheduled_blocks", tables)
            self.assertTrue(
                {"calendar_accounts", "calendar_sources", "calendar_events", "calendar_occurrences", "calendar_sync_runs"}
                <= tables
            )
            self.assertNotIn("scheduled_for", self._columns(connection, "tasks"))
            self.assertNotIn("generated_scheduled_block_id", self._columns(connection, "routine_runs"))
            self.assertIn("calendar_preferences_json", self._columns(connection, "user_ui_preferences"))

    def test_calendar_cutover_deletes_calendar_generated_data_and_preserves_manual_work(self) -> None:
        database_path = self._database_path("calendar-cutover.db")
        self._upgrade(database_path, "20260822_0004")
        with sqlite3.connect(database_path) as connection:
            connection.execute("PRAGMA foreign_keys=OFF")
            connection.execute("INSERT INTO users(id,email) VALUES ('calendar-user','calendar@example.com')")
            connection.execute(
                """INSERT INTO tasks(id,user_id,title,status,priority,source,tags_json,scheduled_for)
                   VALUES ('calendar-task','calendar-user','Generated block task','open','none','calendar','[]','2026-09-04 09:00:00')"""
            )
            connection.execute(
                """INSERT INTO tasks(id,user_id,title,status,priority,source,tags_json,scheduled_for)
                   VALUES ('manual-task','calendar-user','Manual linked task','open','none','manual','[]','2026-09-04 10:00:00')"""
            )
            routine_values = (
                "calendar-user", "scheduled", "daily", "{}", "America/New_York", "none", "[]", "{}"
            )
            connection.execute(
                """INSERT INTO routines(id,user_id,title,status,kind,trigger_type,trigger_config_json,timezone,priority,tags_json,task_template_json)
                   VALUES ('pure-calendar',?,?,?,?,?,?,?,?,?,?)""",
                (routine_values[0], "Calendar only", routine_values[1], "calendar_block", *routine_values[2:]),
            )
            connection.execute(
                """INSERT INTO routines(id,user_id,title,status,kind,trigger_type,trigger_config_json,timezone,priority,tags_json,task_template_json)
                   VALUES ('mixed-routine',?,?,?,?,?,?,?,?,?,?)""",
                (routine_values[0], "Mixed routine", routine_values[1], "mixed", *routine_values[2:]),
            )
            connection.execute(
                """INSERT INTO routine_runs(id,routine_id,user_id,scheduled_for,status,generated_task_id,generated_scheduled_block_id)
                   VALUES ('pure-run','pure-calendar','calendar-user','2026-09-04 09:00:00','generated','calendar-task','block-generated')"""
            )
            connection.execute(
                """INSERT INTO routine_runs(id,routine_id,user_id,scheduled_for,status,generated_task_id,generated_scheduled_block_id)
                   VALUES ('mixed-run','mixed-routine','calendar-user','2026-09-04 10:00:00','generated','manual-task','block-manual')"""
            )
            connection.execute(
                """INSERT INTO scheduled_blocks(id,user_id,title,day,start_minutes,end_minutes,task_id)
                   VALUES ('block-generated','calendar-user','Generated','2026-09-04',540,600,'calendar-task')"""
            )
            connection.execute(
                """INSERT INTO scheduled_blocks(id,user_id,title,day,start_minutes,end_minutes,task_id)
                   VALUES ('block-manual','calendar-user','Linked','2026-09-04',600,660,'manual-task')"""
            )
            connection.execute(
                """INSERT INTO entity_references(id,user_id,source_type,source_id,target_type,target_id,relationship,provenance)
                   VALUES ('legacy-ref','calendar-user','task','manual-task','calendar_block','block-manual','references','user')"""
            )
            connection.execute(
                """INSERT INTO approval_requests(id,user_id,action_kind,status,payload_json,proposed_action_json,policy_decision_json)
                   VALUES ('legacy-approval','calendar-user','calendar.create','pending','{}','{\"type\":\"calendar_block\"}','{}')"""
            )
            connection.execute(
                """INSERT INTO action_receipts(id,user_id,action_kind,capability,target_ref,status,metadata_json)
                   VALUES ('legacy-receipt','calendar-user','calendar.create','tasks','calendar_block:block-manual','applied','{}')"""
            )
            connection.commit()

        self._upgrade(database_path)

        with sqlite3.connect(database_path) as connection:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertNotIn("scheduled_blocks", tables)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM tasks WHERE id='calendar-task'").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM tasks WHERE id='manual-task'").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM routines WHERE id='pure-calendar'").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT kind FROM routines WHERE id='mixed-routine'").fetchone()[0], "task")
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM routine_runs WHERE id='pure-run'").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM routine_runs WHERE id='mixed-run'").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM entity_references WHERE id='legacy-ref'").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM approval_requests WHERE id='legacy-approval'").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM action_receipts WHERE id='legacy-receipt'").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
