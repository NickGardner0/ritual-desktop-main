"""Add durable experiment workspaces and linked conversation threads.

Revision ID: 20260715_0001
Revises: 20260629_0001
Create Date: 2026-07-15
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260715_0001"
down_revision = "20260629_0001"
branch_labels = None
depends_on = None


def _table_exists(connection, table_name: str) -> bool:
    result = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    )
    return result.fetchone() is not None


def _index_exists(connection, index_name: str) -> bool:
    result = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        (index_name,),
    )
    return result.fetchone() is not None


def _column_exists(connection, table_name: str, column_name: str) -> bool:
    result = connection.exec_driver_sql(f"PRAGMA table_info({table_name})")
    return any(row[1] == column_name for row in result.fetchall())


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "experiments"):
        op.create_table(
            "experiments",
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String, nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("status", sa.String, nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )

    if not _table_exists(bind, "experiment_entries"):
        op.create_table(
            "experiment_entries",
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("experiment_id", sa.String, sa.ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String, nullable=False),
            sa.Column("title", sa.String, nullable=False),
            sa.Column("content", sa.Text, nullable=True),
            sa.Column("metadata_json", sa.Text, nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )

    if not _column_exists(bind, "ai_conversations", "experiment_id"):
        op.add_column(
            "ai_conversations",
            sa.Column("experiment_id", sa.String, sa.ForeignKey("experiments.id", ondelete="SET NULL"), nullable=True),
        )

    indexes = [
        ("idx_experiments_user_updated", "experiments", ["user_id", "updated_at"]),
        ("idx_experiments_user_status", "experiments", ["user_id", "status"]),
        ("idx_experiment_entries_experiment_kind", "experiment_entries", ["experiment_id", "kind", "created_at"]),
        ("idx_experiment_entries_user_updated", "experiment_entries", ["user_id", "updated_at"]),
        ("idx_ai_conversations_experiment_updated", "ai_conversations", ["experiment_id", "updated_at"]),
    ]
    for name, table, columns in indexes:
        if not _index_exists(bind, name):
            op.create_index(name, table, columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    for name in (
        "idx_ai_conversations_experiment_updated",
        "idx_experiment_entries_user_updated",
        "idx_experiment_entries_experiment_kind",
        "idx_experiments_user_status",
        "idx_experiments_user_updated",
    ):
        if _index_exists(bind, name):
            op.drop_index(name)

    if _table_exists(bind, "experiment_entries"):
        op.drop_table("experiment_entries")
    if _table_exists(bind, "experiments"):
        op.drop_table("experiments")
