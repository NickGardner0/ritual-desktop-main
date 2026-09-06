from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from alembic import context
from sqlalchemy import create_engine, pool


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database.models import Base  # noqa: E402


config = context.config
target_metadata = Base.metadata


def _migration_connection_settings() -> tuple[str, dict[str, str]]:
    raw_url = os.getenv("ALEMBIC_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not raw_url:
        raise RuntimeError("ALEMBIC_DATABASE_URL or DATABASE_URL is required for migrations")

    if not raw_url.startswith("libsql://"):
        return raw_url, {}

    parsed = urlparse(raw_url)
    auth_token = parse_qs(parsed.query).get("authToken", [None])[0]
    if not parsed.netloc or not auth_token:
        raise RuntimeError(
            "Turso DATABASE_URL must include a host and authToken query parameter"
        )

    database_path = parsed.path or ""
    sqlalchemy_url = f"sqlite+libsql://{parsed.netloc}{database_path}?secure=true"
    return sqlalchemy_url, {"auth_token": auth_token}


def run_migrations_offline() -> None:
    url, _ = _migration_connection_settings()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url, connect_args = _migration_connection_settings()
    engine = create_engine(
        url,
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
