"""Shared SQLAlchemy base and helpers."""

from datetime import datetime, timezone
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


def _utcnow_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)
