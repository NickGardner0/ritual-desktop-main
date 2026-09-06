"""Add durable assistant_turns table.

Revision ID: 20260820_0001
Revises: 20260818_0002
Create Date: 2026-08-20
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260820_0001"
down_revision = "20260818_0002"
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
    if _table_exists(bind, "assistant_turns"):
        return
    op.create_table(
        "assistant_turns",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.String(), sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("channel", sa.String(), nullable=False, server_default="dashboard"),
        sa.Column("status", sa.String(), nullable=False, server_default="queued"),
        sa.Column("epoch", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("receipt_ids_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("assistant_text", sa.Text(), nullable=True),
        sa.Column("tool_payload_json", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("idx_assistant_turns_user_created", "assistant_turns", ["user_id", "created_at"])
    op.create_index(
        "idx_assistant_turns_conversation_sequence",
        "assistant_turns",
        ["conversation_id", "sequence"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "assistant_turns"):
        return
    op.drop_index("idx_assistant_turns_conversation_sequence", table_name="assistant_turns")
    op.drop_index("idx_assistant_turns_user_created", table_name="assistant_turns")
    op.drop_table("assistant_turns")
