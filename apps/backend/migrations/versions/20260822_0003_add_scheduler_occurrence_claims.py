"""Add durable scheduler occurrence claims.

Revision ID: 20260822_0003
Revises: 20260822_0002
Create Date: 2026-08-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260822_0003"
down_revision = "20260822_0002"
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
    if "scheduler_occurrence_claims" in _table_names(bind):
        return
    op.create_table(
        "scheduler_occurrence_claims",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("job_key", sa.String(), nullable=False),
        sa.Column("scope_key", sa.String(), nullable=False, server_default="global"),
        sa.Column("scheduled_for", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="running"),
        sa.Column("lease_owner", sa.String(), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "job_key",
            "scope_key",
            "scheduled_for",
            name="uq_scheduler_occurrence_identity",
        ),
    )
    op.create_index(
        "idx_scheduler_occurrence_status_lease",
        "scheduler_occurrence_claims",
        ["status", "lease_expires_at"],
    )
    op.create_index(
        "idx_scheduler_occurrence_job_scheduled",
        "scheduler_occurrence_claims",
        ["job_key", "scheduled_for"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "scheduler_occurrence_claims" in _table_names(bind):
        op.drop_table("scheduler_occurrence_claims")
