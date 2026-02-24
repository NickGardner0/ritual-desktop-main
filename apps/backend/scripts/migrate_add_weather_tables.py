#!/usr/bin/env python3
"""
Create weather integration tables.

Usage:
  cd apps/backend && python scripts/migrate_add_weather_tables.py
"""

import sys
import asyncio
from pathlib import Path

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import text
from database.connection import async_session_factory, engine


async def run_migration() -> None:
    print("🌤️  Running weather schema migration...")

    async with async_session_factory() as session:
        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS integrations (
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                connected_at TIMESTAMP,
                disabled_at TIMESTAMP,
                metadata TEXT,
                last_sync_at TIMESTAMP,
                last_error TEXT,
                PRIMARY KEY (user_id, provider),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """))

        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_integrations_provider_enabled
            ON integrations (provider, enabled)
        """))

        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS weather_observations (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                observed_at TIMESTAMP NOT NULL,
                tz TEXT NOT NULL,
                location_label TEXT NOT NULL,
                condition_code TEXT NOT NULL,
                temperature_c REAL NOT NULL,
                feels_like_c REAL NOT NULL,
                humidity REAL NOT NULL,
                wind_speed_mps REAL NOT NULL,
                wind_gust_mps REAL,
                wind_direction_deg REAL NOT NULL,
                precip_probability REAL NOT NULL,
                precip_intensity REAL,
                cloud_cover REAL,
                pressure_hpa REAL,
                visibility_m REAL,
                source TEXT NOT NULL DEFAULT 'weatherkit',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """))

        await session.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_weather_observations_user_observed
            ON weather_observations (user_id, observed_at)
        """))

        await session.execute(text("""
            CREATE TABLE IF NOT EXISTS weather_daily (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                date_local TEXT NOT NULL,
                tz TEXT NOT NULL,
                location_label TEXT NOT NULL,
                condition_code TEXT,
                high_c REAL NOT NULL,
                low_c REAL NOT NULL,
                sunrise TIMESTAMP,
                sunset TIMESTAMP,
                uv_index_max REAL,
                source TEXT NOT NULL DEFAULT 'weatherkit',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """))

        await session.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_weather_daily_user_date_unique
            ON weather_daily (user_id, date_local)
        """))

        await session.commit()

    print("✅ Weather schema migration complete")


async def main() -> None:
    try:
        await run_migration()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
