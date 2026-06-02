"""Move legacy runtime schema DDL under Alembic ownership.

Revision ID: 20260524_0001
Revises:
Create Date: 2026-05-24
"""

from __future__ import annotations

from alembic import op
from migrations.legacy_runtime_schema import COLUMN_MIGRATIONS, CREATE_TABLE_SQL, INDEX_SQL


revision = "20260524_0001"
down_revision = None
branch_labels = None
depends_on = None


def _table_exists(connection, table_name: str) -> bool:
    result = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    )
    return result.fetchone() is not None


def _column_exists(connection, table_name: str, column_name: str) -> bool:
    if not _table_exists(connection, table_name):
        return False
    result = connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
    return column_name in {row[1] for row in result.fetchall()}


def _ensure_report_runs_artifact_fk(connection) -> None:
    if not _table_exists(connection, "report_runs"):
        return
    fk_rows = connection.exec_driver_sql("PRAGMA foreign_key_list(report_runs)").fetchall()
    artifact_fk_present = any(
        len(row) >= 5 and row[3] == "artifact_id" and row[2] == "artifacts"
        for row in fk_rows
    )
    if artifact_fk_present:
        return

    connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
    connection.exec_driver_sql("ALTER TABLE report_runs RENAME TO report_runs_legacy")
    connection.exec_driver_sql(
        """
        CREATE TABLE report_runs (
            id TEXT PRIMARY KEY,
            schedule_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            cadence TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            subject TEXT,
            summary_json TEXT,
            email_html TEXT,
            artifact_id TEXT,
            generated_at DATETIME,
            sent_at DATETIME,
            error_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(schedule_id) REFERENCES report_schedules(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
        )
        """
    )
    connection.exec_driver_sql(
        """
        INSERT INTO report_runs (
            id, schedule_id, user_id, cadence, status, period_start, period_end,
            subject, summary_json, email_html, artifact_id, generated_at, sent_at,
            error_json, created_at, updated_at
        )
        SELECT
            id, schedule_id, user_id, cadence, status, period_start, period_end,
            subject, summary_json, email_html, artifact_id, generated_at, sent_at,
            error_json, created_at, updated_at
        FROM report_runs_legacy
        """
    )
    connection.exec_driver_sql("DROP TABLE report_runs_legacy")
    connection.exec_driver_sql("PRAGMA foreign_keys=ON")
    connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_report_runs_schedule_created ON report_runs (schedule_id, created_at)"
    )
    connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_report_runs_user_status ON report_runs (user_id, status, created_at)"
    )
    connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS idx_report_runs_artifact ON report_runs (artifact_id)"
    )


def _ensure_extra_runtime_tables(connection) -> None:
    connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS scheduled_blocks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            notes TEXT,
            day TEXT NOT NULL,
            start_minutes INTEGER NOT NULL,
            end_minutes INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_user_day
        ON scheduled_blocks (user_id, day)
        """
    )
    connection.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_user_day_start
        ON scheduled_blocks (user_id, day, start_minutes)
        """
    )
    connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS integrations (
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            connected_at TIMESTAMP,
            disabled_at TIMESTAMP,
            metadata TEXT,
            last_sync_at TIMESTAMP,
            last_error TEXT,
            PRIMARY KEY (user_id, provider),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    connection.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_integrations_provider_enabled
        ON integrations (provider, enabled)
        """
    )


def _ensure_habit_projection_unique(connection) -> None:
    if not _table_exists(connection, "habit_logs"):
        return

    connection.exec_driver_sql(
        """
        DELETE FROM habit_logs
        WHERE source = 'ritual_watcher_projection_v1'
          AND EXISTS (
            SELECT 1
            FROM habit_logs newer
            WHERE newer.source = 'ritual_watcher_projection_v1'
              AND newer.habit_id = habit_logs.habit_id
              AND newer.date = habit_logs.date
              AND newer.id <> habit_logs.id
              AND (
                COALESCE(newer.completed_at, '') > COALESCE(habit_logs.completed_at, '')
                OR (
                  COALESCE(newer.completed_at, '') = COALESCE(habit_logs.completed_at, '')
                  AND newer.id > habit_logs.id
                )
              )
          )
        """
    )
    connection.exec_driver_sql(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_logs_projection_unique
        ON habit_logs (habit_id, date, source)
        WHERE source = 'ritual_watcher_projection_v1'
        """
    )


def _rename_computer_time_habit_records(connection) -> None:
    if _table_exists(connection, "habits"):
        connection.exec_driver_sql(
            """
            UPDATE habits
            SET name = 'Computer Time',
                updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(TRIM(name)) IN ('computer use', 'computer activity')
            """
        )

    if _table_exists(connection, "habit_logs"):
        connection.exec_driver_sql(
            """
            UPDATE habit_logs
            SET habit_name = 'Computer Time'
            WHERE habit_name IS NOT NULL
              AND LOWER(TRIM(habit_name)) IN ('computer use', 'computer activity')
            """
        )


def upgrade() -> None:
    connection = op.get_bind()

    from database.models import Base

    Base.metadata.create_all(bind=connection)

    for table_name, column_name, sql in COLUMN_MIGRATIONS:
        if not _column_exists(connection, table_name, column_name):
            connection.exec_driver_sql(sql)

    for _, sql in CREATE_TABLE_SQL:
        connection.exec_driver_sql(sql)

    for _, sql in INDEX_SQL:
        connection.exec_driver_sql(sql)

    _ensure_report_runs_artifact_fk(connection)
    _ensure_extra_runtime_tables(connection)
    _ensure_habit_projection_unique(connection)
    _rename_computer_time_habit_records(connection)


def downgrade() -> None:
    # Historical runtime migrations were additive and not safely reversible.
    pass
