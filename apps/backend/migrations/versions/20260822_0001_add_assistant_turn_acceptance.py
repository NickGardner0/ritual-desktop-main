"""Add atomic assistant turn acceptance and commit metadata.

Revision ID: 20260822_0001
Revises: 20260820_0001
Create Date: 2026-08-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260822_0001"
down_revision = "20260820_0001"
branch_labels = None
depends_on = None


def _column_names(connection, table_name: str) -> set[str]:
    return {
        str(row[1])
        for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    }


def upgrade() -> None:
    bind = op.get_bind()
    columns = _column_names(bind, "assistant_turns")
    with op.batch_alter_table("assistant_turns") as batch:
        if "user_message_id" not in columns:
            batch.add_column(sa.Column("user_message_id", sa.String(), nullable=True))
        if "user_message_text" not in columns:
            batch.add_column(sa.Column("user_message_text", sa.Text(), nullable=True))
        if "accepted_at" not in columns:
            batch.add_column(sa.Column("accepted_at", sa.DateTime(), nullable=True))
        if "commit_version" not in columns:
            batch.add_column(
                sa.Column("commit_version", sa.Integer(), nullable=False, server_default="0")
            )


def downgrade() -> None:
    bind = op.get_bind()
    columns = _column_names(bind, "assistant_turns")
    with op.batch_alter_table("assistant_turns") as batch:
        for name in ("commit_version", "accepted_at", "user_message_text", "user_message_id"):
            if name in columns:
                batch.drop_column(name)
