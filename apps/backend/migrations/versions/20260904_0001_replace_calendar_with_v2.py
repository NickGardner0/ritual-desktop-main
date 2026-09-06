"""Replace legacy scheduled blocks with Calendar V2.

Revision ID: 20260904_0001
Revises: 20260822_0004
Create Date: 2026-09-04

This is intentionally destructive. Legacy calendar content is not migrated or
backed up; downgrade recreates only an empty legacy schema.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260904_0001"
down_revision = "20260822_0004"
branch_labels = None
depends_on = None

CALENDAR_TABLES = (
    "calendar_accounts",
    "calendar_sources",
    "calendar_events",
    "calendar_occurrences",
    "calendar_sync_runs",
)


def _table_exists(connection, table_name: str) -> bool:
    return connection.exec_driver_sql(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone() is not None


def _column_exists(connection, table_name: str, column_name: str) -> bool:
    if not _table_exists(connection, table_name):
        return False
    return any(
        row[1] == column_name
        for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    )


def _index_exists(connection, index_name: str) -> bool:
    return connection.exec_driver_sql(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
        (index_name,),
    ).fetchone() is not None


def _create_calendar_tables(connection) -> None:
    from database.models import Base

    for table_name in CALENDAR_TABLES:
        Base.metadata.tables[table_name].create(bind=connection, checkfirst=True)


def _purge_legacy_calendar_content(connection) -> None:
    if _table_exists(connection, "entity_references"):
        connection.exec_driver_sql(
            "DELETE FROM entity_references WHERE source_type='calendar_block' OR target_type='calendar_block'"
        )
    if _table_exists(connection, "approval_requests"):
        connection.exec_driver_sql(
            """
            DELETE FROM approval_requests
            WHERE action_kind LIKE '%calendar%'
               OR payload_json LIKE '%calendar_block%'
               OR proposed_action_json LIKE '%calendar_block%'
            """
        )
    if _table_exists(connection, "action_receipts"):
        connection.exec_driver_sql(
            """
            DELETE FROM action_receipts
            WHERE target_ref LIKE 'calendar_block:%'
               OR action_kind LIKE '%calendar%'
               OR before_json LIKE '%calendar_block%'
               OR after_json LIKE '%calendar_block%'
               OR undo_json LIKE '%calendar_block%'
               OR metadata_json LIKE '%calendar_block%'
            """
        )
    if _table_exists(connection, "routine_runs") and _column_exists(
        connection, "routine_runs", "generated_scheduled_block_id"
    ):
        connection.exec_driver_sql(
            "UPDATE routine_runs SET generated_scheduled_block_id=NULL WHERE generated_scheduled_block_id IS NOT NULL"
        )
    if _table_exists(connection, "routines"):
        if _table_exists(connection, "routine_runs"):
            connection.exec_driver_sql(
                "DELETE FROM routine_runs WHERE routine_id IN (SELECT id FROM routines WHERE kind='calendar_block')"
            )
        connection.exec_driver_sql("DELETE FROM routines WHERE kind='calendar_block'")
        connection.exec_driver_sql(
            """
            UPDATE routines
            SET kind=CASE WHEN ai_workflow_definition_id IS NOT NULL THEN 'ai_workflow' ELSE 'task' END
            WHERE kind='mixed'
            """
        )
    if _table_exists(connection, "tasks"):
        connection.exec_driver_sql("DELETE FROM tasks WHERE source='calendar'")
    if _table_exists(connection, "scheduled_blocks"):
        connection.exec_driver_sql("DELETE FROM scheduled_blocks")


def upgrade() -> None:
    bind = op.get_bind()
    _create_calendar_tables(bind)

    if _table_exists(bind, "user_ui_preferences") and not _column_exists(
        bind, "user_ui_preferences", "calendar_preferences_json"
    ):
        op.add_column(
            "user_ui_preferences",
            sa.Column("calendar_preferences_json", sa.Text(), nullable=False, server_default="{}"),
        )
    if _table_exists(bind, "workflow_definitions") and not _column_exists(
        bind, "workflow_definitions", "expected_duration_minutes"
    ):
        op.add_column(
            "workflow_definitions",
            sa.Column("expected_duration_minutes", sa.Integer(), nullable=False, server_default="30"),
        )

    _purge_legacy_calendar_content(bind)

    if _index_exists(bind, "idx_tasks_user_status_scheduled"):
        op.drop_index("idx_tasks_user_status_scheduled", table_name="tasks")
    if _table_exists(bind, "tasks") and _column_exists(bind, "tasks", "scheduled_for"):
        with op.batch_alter_table("tasks") as batch:
            batch.drop_column("scheduled_for")
    if _table_exists(bind, "routine_runs") and _column_exists(
        bind, "routine_runs", "generated_scheduled_block_id"
    ):
        with op.batch_alter_table("routine_runs") as batch:
            batch.drop_column("generated_scheduled_block_id")
    if _table_exists(bind, "scheduled_blocks"):
        op.drop_table("scheduled_blocks")


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "tasks") and not _column_exists(bind, "tasks", "scheduled_for"):
        op.add_column("tasks", sa.Column("scheduled_for", sa.DateTime(), nullable=True))
        op.create_index(
            "idx_tasks_user_status_scheduled",
            "tasks",
            ["user_id", "status", "scheduled_for"],
        )
    if _table_exists(bind, "routine_runs") and not _column_exists(
        bind, "routine_runs", "generated_scheduled_block_id"
    ):
        op.add_column(
            "routine_runs",
            sa.Column("generated_scheduled_block_id", sa.String(), nullable=True),
        )
    if not _table_exists(bind, "scheduled_blocks"):
        op.create_table(
            "scheduled_blocks",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("day", sa.String(), nullable=False),
            sa.Column("start_minutes", sa.Integer(), nullable=False),
            sa.Column("end_minutes", sa.Integer(), nullable=False),
            sa.Column("task_id", sa.String(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("idx_scheduled_blocks_user_task", "scheduled_blocks", ["user_id", "task_id"])
    if _table_exists(bind, "workflow_definitions") and _column_exists(
        bind, "workflow_definitions", "expected_duration_minutes"
    ):
        op.drop_column("workflow_definitions", "expected_duration_minutes")
    if _table_exists(bind, "user_ui_preferences") and _column_exists(
        bind, "user_ui_preferences", "calendar_preferences_json"
    ):
        op.drop_column("user_ui_preferences", "calendar_preferences_json")
    for table_name in reversed(CALENDAR_TABLES):
        if _table_exists(bind, table_name):
            op.drop_table(table_name)
