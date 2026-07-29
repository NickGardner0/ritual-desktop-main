"""Add habit log provenance fields and action receipt client_event_id.

Revision ID: 20260729_0002
Revises: 20260729_0001
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260729_0002"
down_revision = "20260729_0001"
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


def _dedupe_habit_log_client_events(connection) -> None:
    """Keep oldest log per (habit_id, client_event_id); null out newer duplicates."""
    if not _table_exists(connection, "habit_logs"):
        return
    if not _column_exists(connection, "habit_logs", "client_event_id"):
        return
    rows = connection.exec_driver_sql(
        """
        SELECT id, habit_id, client_event_id, completed_at, date
        FROM habit_logs
        WHERE client_event_id IS NOT NULL
        ORDER BY habit_id, client_event_id,
                 COALESCE(completed_at, date, '') ASC,
                 id ASC
        """
    ).fetchall()
    seen: set[tuple[str, str]] = set()
    for row in rows:
        log_id, habit_id, client_event_id = row[0], row[1], row[2]
        key = (habit_id, client_event_id)
        if key in seen:
            connection.exec_driver_sql(
                "UPDATE habit_logs SET client_event_id = NULL WHERE id = ?",
                (log_id,),
            )
        else:
            seen.add(key)


def _dedupe_action_receipt_client_events(connection) -> None:
    if not _table_exists(connection, "action_receipts"):
        return
    if not _column_exists(connection, "action_receipts", "client_event_id"):
        return
    rows = connection.exec_driver_sql(
        """
        SELECT id, user_id, client_event_id, created_at
        FROM action_receipts
        WHERE client_event_id IS NOT NULL
        ORDER BY user_id, client_event_id,
                 COALESCE(created_at, '') ASC,
                 id ASC
        """
    ).fetchall()
    seen: set[tuple[str, str]] = set()
    for row in rows:
        receipt_id, user_id, client_event_id = row[0], row[1], row[2]
        key = (user_id, client_event_id)
        if key in seen:
            connection.exec_driver_sql(
                "UPDATE action_receipts SET client_event_id = NULL WHERE id = ?",
                (receipt_id,),
            )
        else:
            seen.add(key)


def upgrade() -> None:
    bind = op.get_bind()

    if _table_exists(bind, "habit_logs"):
        if not _column_exists(bind, "habit_logs", "actor_type"):
            op.add_column("habit_logs", sa.Column("actor_type", sa.String(), nullable=True))
        if not _column_exists(bind, "habit_logs", "actor_ref"):
            op.add_column("habit_logs", sa.Column("actor_ref", sa.String(), nullable=True))

        _dedupe_habit_log_client_events(bind)
        if not _index_exists(bind, "idx_habit_logs_habit_client_event"):
            op.create_index(
                "idx_habit_logs_habit_client_event",
                "habit_logs",
                ["habit_id", "client_event_id"],
                unique=True,
                sqlite_where=sa.text("client_event_id IS NOT NULL"),
            )

    if _table_exists(bind, "action_receipts"):
        if not _column_exists(bind, "action_receipts", "client_event_id"):
            op.add_column(
                "action_receipts",
                sa.Column("client_event_id", sa.String(), nullable=True),
            )
        _dedupe_action_receipt_client_events(bind)
        if not _index_exists(bind, "idx_action_receipts_user_client_event"):
            op.create_index(
                "idx_action_receipts_user_client_event",
                "action_receipts",
                ["user_id", "client_event_id"],
                unique=True,
                sqlite_where=sa.text("client_event_id IS NOT NULL"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    if _index_exists(bind, "idx_action_receipts_user_client_event"):
        op.drop_index("idx_action_receipts_user_client_event", table_name="action_receipts")
    if _table_exists(bind, "action_receipts") and _column_exists(
        bind, "action_receipts", "client_event_id"
    ):
        op.drop_column("action_receipts", "client_event_id")

    if _index_exists(bind, "idx_habit_logs_habit_client_event"):
        op.drop_index("idx_habit_logs_habit_client_event", table_name="habit_logs")
    if _table_exists(bind, "habit_logs"):
        if _column_exists(bind, "habit_logs", "actor_ref"):
            op.drop_column("habit_logs", "actor_ref")
        if _column_exists(bind, "habit_logs", "actor_type"):
            op.drop_column("habit_logs", "actor_type")
