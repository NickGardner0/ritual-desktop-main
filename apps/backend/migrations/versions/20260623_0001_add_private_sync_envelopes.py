"""Add ciphertext-only private sync envelopes.

Revision ID: 20260623_0001
Revises: 20260604_0001
Create Date: 2026-06-23
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260623_0001"
down_revision = "20260604_0001"
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


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "private_sync_envelopes"):
        op.create_table(
            "private_sync_envelopes",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("envelope_id", sa.String, nullable=False),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("collection", sa.String, nullable=False),
            sa.Column("record_id", sa.String, nullable=False),
            sa.Column("record_type", sa.String, nullable=False),
            sa.Column("revision", sa.Integer, nullable=False),
            sa.Column("server_revision", sa.Integer, nullable=False),
            sa.Column("key_version", sa.Integer, nullable=False, server_default="1"),
            sa.Column("algorithm", sa.String, nullable=False),
            sa.Column("nonce", sa.Text, nullable=False),
            sa.Column("ciphertext", sa.Text, nullable=False),
            sa.Column("aad", sa.Text, nullable=False),
            sa.Column("ciphertext_sha256", sa.String, nullable=False),
            sa.Column("tombstone", sa.Boolean, nullable=False, server_default=sa.text("0")),
            sa.Column("client_updated_at", sa.String, nullable=True),
            sa.Column("client_id", sa.String, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )

    if not _index_exists(bind, "idx_private_sync_envelopes_user_envelope"):
        op.create_index(
            "idx_private_sync_envelopes_user_envelope",
            "private_sync_envelopes",
            ["user_id", "envelope_id"],
            unique=True,
        )

    if not _index_exists(bind, "idx_private_sync_envelopes_user_server_revision"):
        op.create_index(
            "idx_private_sync_envelopes_user_server_revision",
            "private_sync_envelopes",
            ["user_id", "server_revision"],
        )

    if not _index_exists(bind, "idx_private_sync_envelopes_user_collection"):
        op.create_index(
            "idx_private_sync_envelopes_user_collection",
            "private_sync_envelopes",
            ["user_id", "collection", "record_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()

    if _index_exists(bind, "idx_private_sync_envelopes_user_collection"):
        op.drop_index("idx_private_sync_envelopes_user_collection", table_name="private_sync_envelopes")
    if _index_exists(bind, "idx_private_sync_envelopes_user_server_revision"):
        op.drop_index("idx_private_sync_envelopes_user_server_revision", table_name="private_sync_envelopes")
    if _index_exists(bind, "idx_private_sync_envelopes_user_envelope"):
        op.drop_index("idx_private_sync_envelopes_user_envelope", table_name="private_sync_envelopes")

    if _table_exists(bind, "private_sync_envelopes"):
        op.drop_table("private_sync_envelopes")
