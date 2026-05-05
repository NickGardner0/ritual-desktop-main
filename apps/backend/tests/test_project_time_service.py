import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.project_time_service import (
    get_project_time_rollups,
    get_project_time_sessions,
    recompute_project_time,
    update_project_time_session_classification,
)


def _init_db(path: str) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE activity_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_uid TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            app_bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT,
            browser_domain TEXT,
            is_afk INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.executemany(
        """
        INSERT INTO activity_events (
            event_uid, device_id, user_id, ts_start, ts_end,
            app_bundle_id, app_name, window_title, browser_domain, is_afk
        ) VALUES (?, 'device-1', 'user-1', ?, ?, ?, ?, ?, ?, 0)
        """,
        [
            (
                "event-1",
                1_700_000_000_000,
                1_700_000_600_000,
                "com.todesktop.cursor",
                "Cursor",
                "project_time.rs - ritual-desktop-main - Modified",
                "",
            ),
            (
                "event-2",
                1_700_000_610_000,
                1_700_001_000_000,
                "com.apple.Safari",
                "Safari",
                "Railway deploy logs",
                "railway.app",
            ),
        ],
    )
    conn.commit()
    conn.close()


class ProjectTimeServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_project_time_rollups_sessions_and_corrections_are_compact(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "activity.db")
            _init_db(db_path)

            @asynccontextmanager
            async def _activity_conn(*args, **kwargs):
                write = bool(kwargs.get("write"))
                if write:
                    conn = sqlite3.connect(db_path)
                else:
                    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.0)
                    conn.execute("PRAGMA query_only = ON")
                conn.row_factory = sqlite3.Row
                try:
                    yield conn
                finally:
                    conn.close()

            with patch("services.project_time_service.open_activity_connection_for_user", _activity_conn):
                recompute = await recompute_project_time(
                    "user-1",
                    start_date="2023-11-14",
                    end_date="2023-11-14",
                )
                self.assertTrue(recompute["success"])
                self.assertGreaterEqual(recompute["sessions_written"], 1)

                rollups = await get_project_time_rollups(
                    "user-1",
                    start_date="2023-11-14",
                    end_date="2023-11-14",
                    group_by="task",
                    limit=10,
                )
                self.assertTrue(rollups["success"])
                self.assertGreaterEqual(len(rollups["data"]), 1)
                self.assertNotIn("ocr_text", rollups["data"][0])
                self.assertNotIn("raw_visible_text", rollups["data"][0])

                sessions = await get_project_time_sessions(
                    "user-1",
                    start_date="2023-11-14",
                    end_date="2023-11-14",
                    limit=10,
                )
                self.assertTrue(sessions["success"])
                self.assertGreaterEqual(len(sessions["data"]), 1)
                first_session = sessions["data"][0]
                self.assertNotIn("raw_visible_text", first_session)
                self.assertNotIn("contextual_retrieval_text", first_session)

                updated = await update_project_time_session_classification(
                    "user-1",
                    session_uid=first_session["session_uid"],
                    project_name="Ritual Desktop",
                    task_name="Project Time",
                    apply_forward=True,
                )
                self.assertTrue(updated["success"])

                corrected = await get_project_time_rollups(
                    "user-1",
                    start_date="2023-11-14",
                    end_date="2023-11-14",
                    group_by="task",
                    limit=10,
                )
                labels = {(row["project_name"], row["task_name"]) for row in corrected["data"]}
                self.assertIn(("Ritual Desktop", "Project Time"), labels)


if __name__ == "__main__":
    unittest.main()
