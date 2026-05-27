"""Add location tracking tables and habit_log location columns.

Revision ID: 20260527_0001
Revises: 20260524_0001
Create Date: 2026-05-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260527_0001"
down_revision = "20260524_0001"
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

    # ── user_location_pings (append-only event log) ──────────────────
    if not _table_exists(bind, "user_location_pings"):
        op.create_table(
            "user_location_pings",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("lat", sa.Float, nullable=True),
            sa.Column("lon", sa.Float, nullable=True),
            sa.Column("horizontal_accuracy_m", sa.Float, nullable=True),
            sa.Column("source", sa.String, nullable=False),
            sa.Column("device_id", sa.String, nullable=True),
            sa.Column("bssid", sa.String, nullable=True),
            sa.Column("ssid", sa.String, nullable=True),
            sa.Column("client_ts", sa.BigInteger, nullable=False),
            sa.Column("server_ts", sa.BigInteger, nullable=False),
            sa.Column("client_event_id", sa.String, unique=True, nullable=True),
            sa.Column("raw_payload", sa.Text, nullable=True),
        )
        op.create_index(
            "ix_loc_pings_user_ts",
            "user_location_pings",
            ["user_id", "client_ts"],
        )
        op.create_index(
            "ix_loc_pings_user_source_ts",
            "user_location_pings",
            ["user_id", "source", "client_ts"],
        )

    # ── user_location_state (materialized current location per user) ──
    if not _table_exists(bind, "user_location_state"):
        op.create_table(
            "user_location_state",
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("lat", sa.Float, nullable=False),
            sa.Column("lon", sa.Float, nullable=False),
            sa.Column("horizontal_accuracy_m", sa.Float, nullable=True),
            sa.Column("source", sa.String, nullable=False),
            sa.Column("ping_client_ts", sa.BigInteger, nullable=False),
            sa.Column("updated_at", sa.BigInteger, nullable=False),
            sa.Column("place_label", sa.String, nullable=True),
            sa.Column("place_confidence", sa.Float, nullable=True),
        )

    # ── habit_logs location enrichment columns ────────────────────────
    location_columns = [
        ("location_lat", sa.Float),
        ("location_lon", sa.Float),
        ("location_accuracy_m", sa.Float),
        ("location_source", sa.String),
        ("location_place_label", sa.String),
        ("location_confidence", sa.Float),
        ("location_resolved_at", sa.BigInteger),
        ("location_signal_age_ms", sa.BigInteger),
    ]
    if _table_exists(bind, "habit_logs"):
        for col_name, col_type in location_columns:
            if not _column_exists(bind, "habit_logs", col_name):
                op.add_column(
                    "habit_logs",
                    sa.Column(col_name, col_type, nullable=True),
                )


def downgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind, "habit_logs"):
        for col_name in (
            "location_signal_age_ms",
            "location_resolved_at",
            "location_confidence",
            "location_place_label",
            "location_source",
            "location_accuracy_m",
            "location_lon",
            "location_lat",
        ):
            if _column_exists(bind, "habit_logs", col_name):
                with op.batch_alter_table("habit_logs") as batch:
                    batch.drop_column(col_name)

    if _table_exists(bind, "user_location_state"):
        op.drop_table("user_location_state")

    if _table_exists(bind, "user_location_pings"):
        op.drop_index("ix_loc_pings_user_source_ts", table_name="user_location_pings")
        op.drop_index("ix_loc_pings_user_ts", table_name="user_location_pings")
        op.drop_table("user_location_pings")
