"""Add trusted device registry for private sync.

Revision ID: 20260626_0001
Revises: 20260623_0001
Create Date: 2026-06-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260626_0001"
down_revision = "20260623_0001"
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

    if not _table_exists(bind, "private_sync_devices"):
        op.create_table(
            "private_sync_devices",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("device_id", sa.String, nullable=False),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("device_name", sa.String, nullable=False),
            sa.Column("platform", sa.String, nullable=True),
            sa.Column("public_key", sa.Text, nullable=True),
            sa.Column("status", sa.String, nullable=False, server_default="pending"),
            sa.Column("registered_at", sa.DateTime, nullable=True),
            sa.Column("trusted_at", sa.DateTime, nullable=True),
            sa.Column("revoked_at", sa.DateTime, nullable=True),
            sa.Column("last_seen_at", sa.DateTime, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )

    if not _index_exists(bind, "idx_private_sync_devices_user_device"):
        op.create_index(
            "idx_private_sync_devices_user_device",
            "private_sync_devices",
            ["user_id", "device_id"],
            unique=True,
        )

    if not _index_exists(bind, "idx_private_sync_devices_user_status"):
        op.create_index(
            "idx_private_sync_devices_user_status",
            "private_sync_devices",
            ["user_id", "status"],
        )

    if not _table_exists(bind, "private_sync_key_grants"):
        op.create_table(
            "private_sync_key_grants",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("grant_id", sa.String, nullable=False),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sender_device_id", sa.String, nullable=False),
            sa.Column("recipient_device_id", sa.String, nullable=False),
            sa.Column("key_version", sa.Integer, nullable=False),
            sa.Column("algorithm", sa.String, nullable=False),
            sa.Column("nonce", sa.Text, nullable=False),
            sa.Column("ciphertext", sa.Text, nullable=False),
            sa.Column("aad", sa.Text, nullable=False),
            sa.Column("ciphertext_sha256", sa.String, nullable=False),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )

    if not _index_exists(bind, "idx_private_sync_key_grants_user_grant"):
        op.create_index(
            "idx_private_sync_key_grants_user_grant",
            "private_sync_key_grants",
            ["user_id", "grant_id"],
            unique=True,
        )

    if not _index_exists(bind, "idx_private_sync_key_grants_user_recipient"):
        op.create_index(
            "idx_private_sync_key_grants_user_recipient",
            "private_sync_key_grants",
            ["user_id", "recipient_device_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()

    if _index_exists(bind, "idx_private_sync_key_grants_user_recipient"):
        op.drop_index("idx_private_sync_key_grants_user_recipient", table_name="private_sync_key_grants")
    if _index_exists(bind, "idx_private_sync_key_grants_user_grant"):
        op.drop_index("idx_private_sync_key_grants_user_grant", table_name="private_sync_key_grants")
    if _table_exists(bind, "private_sync_key_grants"):
        op.drop_table("private_sync_key_grants")

    if _index_exists(bind, "idx_private_sync_devices_user_status"):
        op.drop_index("idx_private_sync_devices_user_status", table_name="private_sync_devices")
    if _index_exists(bind, "idx_private_sync_devices_user_device"):
        op.drop_index("idx_private_sync_devices_user_device", table_name="private_sync_devices")
    if _table_exists(bind, "private_sync_devices"):
        op.drop_table("private_sync_devices")
