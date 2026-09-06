"""Add entity_references and optional experiment mention fields.

Revision ID: 20260818_0001
Revises: 20260817_0001
Create Date: 2026-08-18
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260818_0001"
down_revision = "20260817_0001"
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
    if not _table_exists(bind, "entity_references"):
        op.create_table(
            "entity_references",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_type", sa.String(), nullable=False),
            sa.Column("source_id", sa.String(), nullable=False),
            sa.Column("target_type", sa.String(), nullable=False),
            sa.Column("target_id", sa.String(), nullable=False),
            sa.Column("relationship", sa.String(), nullable=False, server_default="references"),
            sa.Column("provenance", sa.String(), nullable=False, server_default="user"),
            sa.Column("anchor_json", sa.Text(), nullable=True),
            sa.Column("client_event_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
        )
        op.create_index(
            "idx_entity_references_user_source",
            "entity_references",
            ["user_id", "source_type", "source_id"],
        )
        op.create_index(
            "idx_entity_references_user_target",
            "entity_references",
            ["user_id", "target_type", "target_id"],
        )

    if _table_exists(bind, "entity_references") and not _index_exists(bind, "idx_entity_references_user_client_event"):
        op.create_index(
            "idx_entity_references_user_client_event",
            "entity_references",
            ["user_id", "client_event_id"],
            unique=True,
            sqlite_where=sa.text("client_event_id IS NOT NULL"),
        )

    if _table_exists(bind, "experiments"):
        columns_to_add: list[tuple[str, sa.Column]] = []
        if not _column_exists(bind, "experiments", "hypothesis"):
            columns_to_add.append(("hypothesis", sa.Column("hypothesis", sa.Text(), nullable=True)))
        if not _column_exists(bind, "experiments", "period_start"):
            columns_to_add.append(("period_start", sa.Column("period_start", sa.String(), nullable=True)))
        if not _column_exists(bind, "experiments", "period_end"):
            columns_to_add.append(("period_end", sa.Column("period_end", sa.String(), nullable=True)))
        if columns_to_add:
            with op.batch_alter_table("experiments") as batch:
                for _name, column in columns_to_add:
                    batch.add_column(column)


def downgrade() -> None:
    bind = op.get_bind()
    if _index_exists(bind, "idx_entity_references_user_client_event"):
        op.drop_index("idx_entity_references_user_client_event", table_name="entity_references")
    if _table_exists(bind, "entity_references"):
        op.drop_table("entity_references")
