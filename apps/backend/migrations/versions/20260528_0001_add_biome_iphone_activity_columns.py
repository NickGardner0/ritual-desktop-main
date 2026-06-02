"""Add Biome iPhone activity metadata columns.

Revision ID: 20260528_0001
Revises: 20260527_0001
Create Date: 2026-05-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260528_0001"
down_revision = "20260527_0001"
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


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "activity_events"):
        return

    columns = [
        ("event_uid", sa.String(), False, ""),
        ("device_platform", sa.String(), True, None),
        ("app_version", sa.String(), True, None),
        ("app_build", sa.String(), True, None),
        ("transition_reason", sa.String(), True, None),
        ("biome_source_file", sa.String(), True, None),
        ("biome_is_provisional", sa.Integer(), False, "0"),
        ("location_lat", sa.Float(), True, None),
        ("location_lon", sa.Float(), True, None),
        ("location_accuracy_m", sa.Float(), True, None),
        ("location_source", sa.String(), True, None),
        ("location_place_label", sa.String(), True, None),
        ("location_confidence", sa.Float(), True, None),
        ("location_resolved_at", sa.BigInteger(), True, None),
        ("location_signal_age_ms", sa.BigInteger(), True, None),
    ]
    for name, type_, nullable, default in columns:
        if _column_exists(bind, "activity_events", name):
            continue
        op.add_column(
            "activity_events",
            sa.Column(name, type_, nullable=nullable, server_default=default),
        )

    if _column_exists(bind, "activity_events", "event_uid"):
        op.execute(
            """
            UPDATE activity_events
            SET event_uid = printf('legacy-activity:%s:%s:%lld', device_id, user_id, id)
            WHERE event_uid IS NULL OR TRIM(event_uid) = ''
            """
        )
        bind.exec_driver_sql(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_events_event_uid
            ON activity_events(event_uid)
            """
        )

    bind.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS idx_activity_events_source_ts
        ON activity_events(user_id, source, ts_start)
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "activity_events"):
        return

    for index_name in ("idx_activity_events_source_ts", "idx_activity_events_event_uid"):
        try:
            op.drop_index(index_name, table_name="activity_events")
        except Exception:
            pass

    for name in (
        "location_signal_age_ms",
        "location_resolved_at",
        "location_confidence",
        "location_place_label",
        "location_source",
        "location_accuracy_m",
        "location_lon",
        "location_lat",
        "biome_source_file",
        "biome_is_provisional",
        "transition_reason",
        "app_build",
        "app_version",
        "device_platform",
        "event_uid",
    ):
        if _column_exists(bind, "activity_events", name):
            with op.batch_alter_table("activity_events") as batch:
                batch.drop_column(name)
