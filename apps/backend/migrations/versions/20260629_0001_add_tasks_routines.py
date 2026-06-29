"""Add first-class tasks and routines.

Revision ID: 20260629_0001
Revises: 20260626_0001
Create Date: 2026-06-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260629_0001"
down_revision = "20260626_0001"
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

    if not _table_exists(bind, "routines"):
        op.create_table(
            "routines",
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String, nullable=False),
            sa.Column("description", sa.Text, nullable=True),
            sa.Column("status", sa.String, nullable=False, server_default="scheduled"),
            sa.Column("kind", sa.String, nullable=False, server_default="task"),
            sa.Column("trigger_type", sa.String, nullable=False, server_default="daily"),
            sa.Column("trigger_config_json", sa.Text, nullable=False, server_default="{}"),
            sa.Column("timezone", sa.String, nullable=False, server_default="America/New_York"),
            sa.Column("priority", sa.String, nullable=False, server_default="none"),
            sa.Column("tags_json", sa.Text, nullable=False, server_default="[]"),
            sa.Column("task_template_json", sa.Text, nullable=False, server_default="{}"),
            sa.Column("ai_workflow_definition_id", sa.String, sa.ForeignKey("workflow_definitions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("first_run_at", sa.DateTime, nullable=True),
            sa.Column("ends_at", sa.DateTime, nullable=True),
            sa.Column("last_run_at", sa.DateTime, nullable=True),
            sa.Column("next_run_at", sa.DateTime, nullable=True),
            sa.Column("client_event_id", sa.String, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )
    elif not _column_exists(bind, "routines", "client_event_id"):
        op.add_column("routines", sa.Column("client_event_id", sa.String, nullable=True))

    if not _table_exists(bind, "tasks"):
        op.create_table(
            "tasks",
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String, nullable=False),
            sa.Column("notes", sa.Text, nullable=True),
            sa.Column("status", sa.String, nullable=False, server_default="open"),
            sa.Column("priority", sa.String, nullable=False, server_default="none"),
            sa.Column("due_at", sa.DateTime, nullable=True),
            sa.Column("scheduled_for", sa.DateTime, nullable=True),
            sa.Column("completed_at", sa.DateTime, nullable=True),
            sa.Column("source", sa.String, nullable=False, server_default="manual"),
            sa.Column("project", sa.String, nullable=True),
            sa.Column("category", sa.String, nullable=True),
            sa.Column("tags_json", sa.Text, nullable=False, server_default="[]"),
            sa.Column("routine_id", sa.String, sa.ForeignKey("routines.id", ondelete="SET NULL"), nullable=True),
            sa.Column("routine_run_id", sa.String, nullable=True),
            sa.Column("linked_habit_id", sa.String, sa.ForeignKey("habits.id", ondelete="SET NULL"), nullable=True),
            sa.Column("linked_artifact_id", sa.String, sa.ForeignKey("artifacts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("client_event_id", sa.String, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )

    if not _table_exists(bind, "routine_runs"):
        op.create_table(
            "routine_runs",
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("routine_id", sa.String, sa.ForeignKey("routines.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("scheduled_for", sa.DateTime, nullable=False),
            sa.Column("status", sa.String, nullable=False, server_default="scheduled"),
            sa.Column("generated_task_id", sa.String, sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
            sa.Column("generated_scheduled_block_id", sa.String, sa.ForeignKey("scheduled_blocks.id", ondelete="SET NULL"), nullable=True),
            sa.Column("workflow_run_id", sa.String, sa.ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True),
            sa.Column("completed_at", sa.DateTime, nullable=True),
            sa.Column("skipped_at", sa.DateTime, nullable=True),
            sa.Column("error_json", sa.Text, nullable=True),
            sa.Column("idempotency_key", sa.String, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )
    elif not _column_exists(bind, "routine_runs", "generated_scheduled_block_id"):
        op.add_column("routine_runs", sa.Column("generated_scheduled_block_id", sa.String, nullable=True))

    if not _table_exists(bind, "task_events"):
        op.create_table(
            "task_events",
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("task_id", sa.String, sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("event_type", sa.String, nullable=False),
            sa.Column("payload_json", sa.Text, nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime, nullable=True),
        )

    indexes = [
        ("idx_routines_user_status_next", "routines", ["user_id", "status", "next_run_at"], False),
        ("idx_routines_user_kind", "routines", ["user_id", "kind"], False),
        ("idx_routines_user_client_event", "routines", ["user_id", "client_event_id"], True),
        ("idx_tasks_user_status_scheduled", "tasks", ["user_id", "status", "scheduled_for"], False),
        ("idx_tasks_user_status_due", "tasks", ["user_id", "status", "due_at"], False),
        ("idx_tasks_user_source", "tasks", ["user_id", "source"], False),
        ("idx_tasks_user_client_event", "tasks", ["user_id", "client_event_id"], True),
        ("idx_routine_runs_user_status_scheduled", "routine_runs", ["user_id", "status", "scheduled_for"], False),
        ("idx_routine_runs_routine_scheduled", "routine_runs", ["routine_id", "scheduled_for"], False),
        ("idx_routine_runs_idempotency", "routine_runs", ["idempotency_key"], True),
        ("idx_task_events_task_created", "task_events", ["task_id", "created_at"], False),
        ("idx_task_events_user_created", "task_events", ["user_id", "created_at"], False),
    ]
    for name, table, columns, unique in indexes:
        if not _index_exists(bind, name):
            op.create_index(name, table, columns, unique=unique)

    # Add the circular nullable FK after both tables exist. SQLite cannot add it
    # as a table constraint here, so application-level ownership validation covers it.


def downgrade() -> None:
    bind = op.get_bind()

    for name, table in [
        ("idx_task_events_user_created", "task_events"),
        ("idx_task_events_task_created", "task_events"),
        ("idx_routine_runs_idempotency", "routine_runs"),
        ("idx_routine_runs_routine_scheduled", "routine_runs"),
        ("idx_routine_runs_user_status_scheduled", "routine_runs"),
        ("idx_tasks_user_client_event", "tasks"),
        ("idx_tasks_user_source", "tasks"),
        ("idx_tasks_user_status_due", "tasks"),
        ("idx_tasks_user_status_scheduled", "tasks"),
        ("idx_routines_user_client_event", "routines"),
        ("idx_routines_user_kind", "routines"),
        ("idx_routines_user_status_next", "routines"),
    ]:
        if _index_exists(bind, name):
            op.drop_index(name, table_name=table)

    for table in ["task_events", "routine_runs", "tasks", "routines"]:
        if _table_exists(bind, table):
            op.drop_table(table)
