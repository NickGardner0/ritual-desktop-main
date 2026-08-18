"""Add scheduled_blocks.task_id so calendar placements can point at TaskDB.

Revision ID: 20260818_0002
Revises: 20260818_0001
Create Date: 2026-08-18
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260818_0002"
down_revision = "20260818_0001"
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
    if _table_exists(bind, "scheduled_blocks") and not _column_exists(bind, "scheduled_blocks", "task_id"):
        op.add_column(
            "scheduled_blocks",
            sa.Column(
                "task_id",
                sa.String(),
                sa.ForeignKey("tasks.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    if _table_exists(bind, "scheduled_blocks") and not _index_exists(bind, "idx_scheduled_blocks_user_task"):
        op.create_index(
            "idx_scheduled_blocks_user_task",
            "scheduled_blocks",
            ["user_id", "task_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _index_exists(bind, "idx_scheduled_blocks_user_task"):
        op.drop_index("idx_scheduled_blocks_user_task", table_name="scheduled_blocks")
    if _table_exists(bind, "scheduled_blocks") and _column_exists(bind, "scheduled_blocks", "task_id"):
        op.drop_column("scheduled_blocks", "task_id")
