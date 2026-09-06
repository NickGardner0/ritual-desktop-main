"""Repair the report-notification foreign key left by a legacy table rebuild.

Revision ID: 20260729_0002
Revises: 20260729_0001
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op


revision = "20260729_0002"
down_revision = "20260729_0001"
branch_labels = None
depends_on = None


def _table_exists(connection, table_name: str) -> bool:
    result = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    )
    return result.fetchone() is not None


def _foreign_key_targets(connection, table_name: str) -> set[str]:
    if not _table_exists(connection, table_name):
        return set()
    rows = connection.exec_driver_sql(
        f"PRAGMA foreign_key_list({table_name})"
    ).fetchall()
    return {row[2] for row in rows}


def upgrade() -> None:
    connection = op.get_bind()
    table_name = "report_notifications"
    if not _table_exists(connection, table_name):
        return

    targets = _foreign_key_targets(connection, table_name)
    if "report_runs_legacy" not in targets:
        return

    repaired_table = "report_notifications_fk_repaired"
    connection.exec_driver_sql(f"DROP TABLE IF EXISTS {repaired_table}")
    connection.exec_driver_sql(
        f"""
        CREATE TABLE {repaired_table} (
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
            FOREIGN KEY(report_run_id) REFERENCES report_runs(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    connection.exec_driver_sql(
        f"""
        INSERT INTO {repaired_table} (
            id, report_run_id, user_id, channel, recipient_email, status,
            provider_message_id, payload_json, sent_at, created_at, updated_at
        )
        SELECT
            id, report_run_id, user_id, channel, recipient_email, status,
            provider_message_id, payload_json, sent_at, created_at, updated_at
        FROM {table_name}
        """
    )
    connection.exec_driver_sql(f"DROP TABLE {table_name}")
    connection.exec_driver_sql(
        f"ALTER TABLE {repaired_table} RENAME TO {table_name}"
    )
    connection.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_report_notifications_run_recipient
        ON report_notifications (report_run_id, recipient_email)
        """
    )


def downgrade() -> None:
    # Restoring a foreign key to a table that does not exist would corrupt writes.
    pass
