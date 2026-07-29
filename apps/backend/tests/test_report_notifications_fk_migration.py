from __future__ import annotations

import importlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

migration = importlib.import_module(
    "migrations.versions.20260729_0002_repair_report_notifications_fk"
)


class ReportNotificationsForeignKeyMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        self.connection = self.engine.connect()
        self.connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        self.connection.exec_driver_sql("CREATE TABLE users (id TEXT PRIMARY KEY)")
        self.connection.exec_driver_sql(
            "CREATE TABLE report_runs (id TEXT PRIMARY KEY)"
        )
        self.connection.exec_driver_sql(
            """
            CREATE TABLE report_notifications (
                id TEXT PRIMARY KEY,
                report_run_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel TEXT NOT NULL DEFAULT 'email',
                recipient_email TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                provider_message_id TEXT,
                payload_json TEXT,
                sent_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(report_run_id)
                    REFERENCES report_runs_legacy(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        self.connection.exec_driver_sql(
            "INSERT INTO users (id) VALUES ('user-1')"
        )
        self.connection.exec_driver_sql(
            "INSERT INTO report_runs (id) VALUES ('run-1')"
        )
        self.connection.exec_driver_sql(
            """
            INSERT INTO report_notifications (
                id, report_run_id, user_id, recipient_email
            ) VALUES ('notification-1', 'run-1', 'user-1', 'test@example.com')
            """
        )

    def tearDown(self) -> None:
        self.connection.close()
        self.engine.dispose()

    def test_upgrade_repairs_foreign_key_and_preserves_rows(self) -> None:
        with patch.object(migration.op, "get_bind", return_value=self.connection):
            migration.upgrade()

        targets = {
            row[2]
            for row in self.connection.exec_driver_sql(
                "PRAGMA foreign_key_list(report_notifications)"
            ).fetchall()
        }
        self.assertEqual(targets, {"report_runs", "users"})
        count = self.connection.exec_driver_sql(
            "SELECT COUNT(*) FROM report_notifications"
        ).scalar_one()
        self.assertEqual(count, 1)

        indexes = {
            row[1]
            for row in self.connection.exec_driver_sql(
                "PRAGMA index_list(report_notifications)"
            ).fetchall()
        }
        self.assertIn("idx_report_notifications_run_recipient", indexes)


if __name__ == "__main__":
    unittest.main()
