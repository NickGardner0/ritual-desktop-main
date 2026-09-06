"""Reconcile schemas historically created by standalone backend scripts.

Revision ID: 20260817_0001
Revises: 20260729_0003
Create Date: 2026-08-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260817_0001"
down_revision = "20260729_0003"
branch_labels = None
depends_on = None


CANDIDATE_TABLES = (
    "ai_conversations",
    "ai_messages",
    "financial_connections",
    "financial_accounts",
    "financial_transactions",
    "financial_sync_cursors",
    "financial_sync_runs",
    "heart_rate_sessions",
    "heart_rate_samples",
    "heart_rate_1m_rollups",
    "live_biometrics_state",
    "import_runs",
    "import_items",
    "import_mapping_presets",
    "screen_time_rollups",
    "user_ui_preferences",
    "watcher_devices",
    "watcher_state",
    "activity_events",
    "daily_activity_rollups",
    "watcher_sync_outbox",
    "watcher_app_exclusions",
    "afk_events",
    "domain_daily_rollups",
    "wearable_devices",
    "wearable_metrics",
    "wearable_ingest_events",
    "wearable_events",
)


def _table_exists(connection, table_name: str) -> bool:
    return connection.exec_driver_sql(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone() is not None


def _column_exists(connection, table_name: str, column_name: str) -> bool:
    if not _table_exists(connection, table_name):
        return False
    return column_name in {
        row[1]
        for row in connection.exec_driver_sql(
            f"PRAGMA table_info({table_name})"
        ).fetchall()
    }


def _ensure_column(
    connection,
    table_name: str,
    column_name: str,
    column: sa.Column,
) -> None:
    if _table_exists(connection, table_name) and not _column_exists(
        connection, table_name, column_name
    ):
        op.add_column(table_name, column)


def _ensure_candidate_tables(connection) -> None:
    from database.models import Base

    for table_name in CANDIDATE_TABLES:
        table = Base.metadata.tables[table_name]
        table.create(bind=connection, checkfirst=True)


def _reconcile_columns(connection) -> None:
    # Habit scripts and the import migration independently created these fields.
    _ensure_column(connection, "habit_logs", "habit_name", sa.Column("habit_name", sa.String()))
    _ensure_column(connection, "habit_logs", "source", sa.Column("source", sa.String()))
    _ensure_column(connection, "habit_logs", "import_run_id", sa.Column("import_run_id", sa.String()))
    _ensure_column(connection, "habit_logs", "source_id", sa.Column("source_id", sa.String()))
    _ensure_column(connection, "habit_logs", "dedupe_key", sa.Column("dedupe_key", sa.String()))

    # The old import/UI/wearable scripts predate these additive model fields.
    _ensure_column(connection, "import_runs", "undo_expires_at", sa.Column("undo_expires_at", sa.DateTime()))
    _ensure_column(connection, "import_runs", "undo_package_json", sa.Column("undo_package_json", sa.Text()))
    _ensure_column(connection, "user_ui_preferences", "overview_view_mode", sa.Column("overview_view_mode", sa.String()))
    _ensure_column(connection, "wearable_devices", "provider", sa.Column("provider", sa.String(), server_default="apple_health"))
    _ensure_column(connection, "wearable_devices", "connection_id", sa.Column("connection_id", sa.String()))
    _ensure_column(connection, "wearable_devices", "last_seen_at", sa.Column("last_seen_at", sa.DateTime()))
    _ensure_column(connection, "wearable_devices", "sdk_version", sa.Column("sdk_version", sa.String()))

    # Watcher V1/V2 scripts encoded only their historical columns. Preserve all
    # rows while bringing those tables to the final V2 shape.
    _ensure_column(connection, "watcher_state", "afk_timeout_seconds", sa.Column("afk_timeout_seconds", sa.Integer(), server_default="900"))
    _ensure_column(connection, "activity_events", "browser_url", sa.Column("browser_url", sa.String()))
    _ensure_column(connection, "activity_events", "browser_domain", sa.Column("browser_domain", sa.String()))
    _ensure_column(connection, "activity_events", "is_incognito", sa.Column("is_incognito", sa.Integer(), nullable=False, server_default="0"))
    _ensure_column(connection, "daily_activity_rollups", "browser_domain", sa.Column("browser_domain", sa.String()))
    _ensure_column(connection, "daily_activity_rollups", "afk_ms", sa.Column("afk_ms", sa.Integer(), nullable=False, server_default="0"))

    # AI tables were originally created directly from then-current models.
    _ensure_column(connection, "ai_conversations", "channel", sa.Column("channel", sa.String(), nullable=False, server_default="app"))
    _ensure_column(connection, "ai_conversations", "auto_run_queued", sa.Column("auto_run_queued", sa.Integer(), nullable=False, server_default="0"))
    _ensure_column(connection, "ai_messages", "tool_payload", sa.Column("tool_payload", sa.Text()))


def _backfill_habit_names(connection) -> None:
    if not (_table_exists(connection, "habit_logs") and _table_exists(connection, "habits")):
        return
    connection.exec_driver_sql(
        """
        UPDATE habit_logs
        SET habit_name = (
            SELECT habits.name FROM habits WHERE habits.id = habit_logs.habit_id
        )
        WHERE habit_name IS NULL
          AND EXISTS (SELECT 1 FROM habits WHERE habits.id = habit_logs.habit_id)
        """
    )


def _dedupe_first_run_client_events(connection) -> None:
    if not all(
        _column_exists(connection, "habit_logs", column)
        for column in ("id", "client_event_id", "source")
    ):
        return
    duplicate_ids = connection.exec_driver_sql(
        """
        SELECT id
        FROM habit_logs
        WHERE source = 'first_run' AND client_event_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id)
            FROM habit_logs
            WHERE source = 'first_run' AND client_event_id IS NOT NULL
            GROUP BY client_event_id
          )
        """
    ).fetchall()
    for (log_id,) in duplicate_ids:
        connection.exec_driver_sql(
            "UPDATE habit_logs SET client_event_id = NULL WHERE id = ?",
            (log_id,),
        )


INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_habit_logs_dedupe_key ON habit_logs(dedupe_key)",
    "CREATE INDEX IF NOT EXISTS idx_habit_logs_import_run ON habit_logs(import_run_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_logs_first_run_client_event ON habit_logs(client_event_id) WHERE client_event_id IS NOT NULL AND source = 'first_run'",
    "CREATE INDEX IF NOT EXISTS idx_import_runs_user_id ON import_runs(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_import_runs_status ON import_runs(status)",
    "CREATE INDEX IF NOT EXISTS idx_import_runs_file_hash ON import_runs(file_hash_sha256)",
    "CREATE INDEX IF NOT EXISTS idx_import_runs_user_status ON import_runs(user_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_import_items_run_id ON import_items(import_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_import_items_run ON import_items(import_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_import_items_validation ON import_items(validation_status)",
    "CREATE INDEX IF NOT EXISTS idx_import_presets_user_source ON import_mapping_presets(user_id, source)",
    "CREATE INDEX IF NOT EXISTS idx_watcher_devices_user_id ON watcher_devices(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_watcher_state_device_id ON watcher_state(device_id)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_ts_start ON activity_events(ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_device_ts ON activity_events(device_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_user_ts ON activity_events(user_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_app_ts ON activity_events(app_bundle_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_domain ON activity_events(browser_domain)",
    "CREATE INDEX IF NOT EXISTS idx_daily_rollups_user_day ON daily_activity_rollups(user_id, day)",
    "CREATE INDEX IF NOT EXISTS idx_daily_rollups_device_day ON daily_activity_rollups(device_id, day)",
    "CREATE INDEX IF NOT EXISTS idx_daily_rollups_app ON daily_activity_rollups(app_bundle_id, day)",
    "CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON watcher_sync_outbox(status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_sync_outbox_device ON watcher_sync_outbox(device_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_app_exclusions_user ON watcher_app_exclusions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_afk_events_device_ts ON afk_events(device_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_afk_events_user_ts ON afk_events(user_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_domain_rollups_user_day ON domain_daily_rollups(user_id, day)",
    "CREATE INDEX IF NOT EXISTS idx_domain_rollups_domain ON domain_daily_rollups(domain, day)",
    "CREATE INDEX IF NOT EXISTS idx_heart_rate_sessions_user_started ON heart_rate_sessions(user_id, started_at)",
    "CREATE INDEX IF NOT EXISTS idx_heart_rate_sessions_user_status ON heart_rate_sessions(user_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_user_received ON heart_rate_samples(user_id, received_at)",
    "CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_session_received ON heart_rate_samples(session_id, received_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_heart_rate_rollups_user_bucket_source ON heart_rate_1m_rollups(user_id, bucket_start, source_preference)",
)


def upgrade() -> None:
    connection = op.get_bind()
    _ensure_candidate_tables(connection)
    _reconcile_columns(connection)
    _backfill_habit_names(connection)
    _dedupe_first_run_client_events(connection)
    for statement in INDEX_SQL:
        connection.exec_driver_sql(statement)


def downgrade() -> None:
    # This reconciliation adopts pre-existing production data and is additive.
    pass
