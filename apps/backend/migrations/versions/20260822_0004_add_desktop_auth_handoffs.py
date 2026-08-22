"""Add channel-bound desktop authentication handoffs.

Revision ID: 20260822_0004
Revises: 20260822_0003
Create Date: 2026-08-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260822_0004"
down_revision = "20260822_0003"
branch_labels = None
depends_on = None


def _table_names(connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }


def upgrade() -> None:
    bind = op.get_bind()
    if "desktop_auth_handoffs" in _table_names(bind):
        return
    op.create_table(
        "desktop_auth_handoffs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("nonce_hash", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("protocol", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.Column("failure_code", sa.String(), nullable=True),
        sa.Column("native_metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_desktop_auth_handoff_user_created",
        "desktop_auth_handoffs",
        ["user_id", "created_at"],
    )
    op.create_index(
        "idx_desktop_auth_handoff_status_expiry",
        "desktop_auth_handoffs",
        ["status", "expires_at"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "desktop_auth_handoffs" in _table_names(bind):
        op.drop_table("desktop_auth_handoffs")
