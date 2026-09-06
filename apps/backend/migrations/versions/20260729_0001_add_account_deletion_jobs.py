"""Add durable coordinated account-deletion receipts.

Revision ID: 20260729_0001
Revises: 20260715_0001
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260729_0001"
down_revision = "20260715_0001"
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
    if _table_exists(bind, "account_deletion_jobs"):
        return

    op.create_table(
        "account_deletion_jobs",
        sa.Column("user_id", sa.String, primary_key=True),
        sa.Column("event_id", sa.String, nullable=True),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("email_hash", sa.String, nullable=True),
        sa.Column("status", sa.String, nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("receipt_json", sa.Text, nullable=True),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=True),
        sa.Column("updated_at", sa.DateTime, nullable=True),
        sa.Column("completed_at", sa.DateTime, nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "account_deletion_jobs"):
        op.drop_table("account_deletion_jobs")
