from __future__ import annotations

import os
import sys
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database.models import Base  # noqa: E402


config = context.config
target_metadata = Base.metadata


def _migration_database_url() -> str:
    url = os.getenv("ALEMBIC_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("ALEMBIC_DATABASE_URL or DATABASE_URL is required for migrations")
    if url.startswith("libsql://"):
        raise RuntimeError(
            "Alembic migrations require a direct SQLAlchemy-compatible URL. "
            "Set ALEMBIC_DATABASE_URL for the migration target."
        )
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_migration_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_migration_database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
