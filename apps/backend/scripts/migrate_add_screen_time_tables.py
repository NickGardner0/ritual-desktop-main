#!/usr/bin/env python3
"""
Migration script to add Screen Time aggregate tables.
"""

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from database.connection import async_session_factory, engine
from database.models import ScreenTimeRollupDB

load_dotenv()


async def check_table_exists(table_name: str) -> bool:
    async with async_session_factory() as session:
        result = await session.execute(
            text(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
        )
        return result.fetchone() is not None


async def main() -> int:
    table_name = "screen_time_rollups"
    exists = await check_table_exists(table_name)
    if exists:
        print("✅ screen_time_rollups already exists")
        await engine.dispose()
        return 0

    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: ScreenTimeRollupDB.__table__.create(sync_conn, checkfirst=True))

    exists = await check_table_exists(table_name)
    print("✅ screen_time_rollups created" if exists else "❌ failed to create screen_time_rollups")
    await engine.dispose()
    return 0 if exists else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
