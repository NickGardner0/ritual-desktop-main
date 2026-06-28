"""Add durable user activation state.

Revision ID: 20260604_0001
Revises: 20260528_0001
Create Date: 2026-06-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260604_0001"
down_revision = "20260528_0001"
branch_labels = None
depends_on = None


def _table_exists(connection, table_name: str) -> bool:
    result = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    )
    return result.fetchone() is not None


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "user_activation_state"):
        op.create_table(
            "user_activation_state",
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("profile_completed_at", sa.DateTime, nullable=True),
            sa.Column("first_habit_id", sa.String, sa.ForeignKey("habits.id", ondelete="SET NULL"), nullable=True),
            sa.Column("first_log_id", sa.String, sa.ForeignKey("habit_logs.id", ondelete="SET NULL"), nullable=True),
            sa.Column("first_behavior_logged_at", sa.DateTime, nullable=True),
            sa.Column("permissions_seen_at", sa.DateTime, nullable=True),
            sa.Column("activation_completed_at", sa.DateTime, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )

    if not _table_exists(bind, "user_activation_checklist_items"):
        op.create_table(
            "user_activation_checklist_items",
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("key", sa.String, nullable=False),
            sa.Column("status", sa.String, nullable=False, server_default="not_started"),
            sa.Column("metadata_json", sa.Text, nullable=True),
            sa.Column("seen_at", sa.DateTime, nullable=True),
            sa.Column("skipped_at", sa.DateTime, nullable=True),
            sa.Column("completed_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )
        op.create_index(
            "idx_activation_checklist_user_key",
            "user_activation_checklist_items",
            ["user_id", "key"],
            unique=True,
        )

    if _table_exists(bind, "habit_logs"):
        op.create_index(
            "idx_habit_logs_first_run_client_event",
            "habit_logs",
            ["client_event_id"],
            unique=True,
            sqlite_where=sa.text("client_event_id IS NOT NULL AND source = 'first_run'"),
        )


def downgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind, "user_activation_checklist_items"):
        op.drop_index("idx_activation_checklist_user_key", table_name="user_activation_checklist_items")
        op.drop_table("user_activation_checklist_items")

    if _table_exists(bind, "habit_logs"):
        op.drop_index("idx_habit_logs_first_run_client_event", table_name="habit_logs")

    if _table_exists(bind, "user_activation_state"):
        op.drop_table("user_activation_state")
