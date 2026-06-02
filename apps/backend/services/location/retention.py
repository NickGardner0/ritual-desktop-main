"""Retention job: delete raw location pings older than the retention window.

Place labels in user_location_state and habit_logs survive — only the
raw lat/lon ping log is pruned for privacy.

Wire into the internal scheduler loop in main.py so this runs hourly/daily.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import delete

from database.connection import get_db_session
from database.models import UserLocationPingDB
from services.location.util import now_ms

logger = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS = 30


async def cleanup_old_pings(retention_days: int = DEFAULT_RETENTION_DAYS) -> int:
    """Delete pings older than `retention_days`. Returns deleted row count."""
    cutoff_ms = now_ms() - retention_days * 24 * 60 * 60 * 1000
    async with get_db_session() as session:
        result = await session.execute(
            delete(UserLocationPingDB).where(UserLocationPingDB.client_ts < cutoff_ms)
        )
        await session.commit()
    deleted = result.rowcount or 0
    logger.info("Location retention: deleted %d pings older than %d days", deleted, retention_days)
    return deleted
