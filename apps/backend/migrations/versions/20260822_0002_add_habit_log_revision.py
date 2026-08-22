"""Add optimistic revision and idempotency identity to habit logs.

Revision ID: 20260822_0002
Revises: 20260822_0001
Create Date: 2026-08-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260822_0002"
down_revision = "20260822_0001"
branch_labels = None
depends_on = None


def _column_names(connection, table_name: str) -> set[str]:
    return {
        str(row[1])
        for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    }


def upgrade() -> None:
    bind = op.get_bind()
    columns = _column_names(bind, "habit_logs")
    with op.batch_alter_table("habit_logs") as batch:
        if "revision" not in columns:
            batch.add_column(
                sa.Column("revision", sa.Integer(), nullable=False, server_default="1")
            )
        if "last_update_idempotency_key" not in columns:
            batch.add_column(
                sa.Column("last_update_idempotency_key", sa.String(), nullable=True)
            )


def downgrade() -> None:
    bind = op.get_bind()
    columns = _column_names(bind, "habit_logs")
    with op.batch_alter_table("habit_logs") as batch:
        for name in ("last_update_idempotency_key", "revision"):
            if name in columns:
                batch.drop_column(name)
