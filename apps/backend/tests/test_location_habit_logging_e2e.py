"""End-to-end location enrichment tests for habit logging.

These tests use a real SQLite database and the production service functions:
location ping ingest -> resolver -> HabitsService.log_habit. They verify the
contract used by Mac AI chat and iMessage/SMS logging without relying on live
device GPS or third-party geocoding.
"""

from __future__ import annotations

import tempfile
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database.models import Base, HabitDB, HabitLogDB, UserDB
from models.habit_models import HabitLogCreate
from services.habits_service import HabitsService
from services.location.ingest import ingest_location_pings
from services.location.models import LocationPing


class LocationHabitLoggingE2ETests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "location-e2e.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with self.Session() as session:
            session.add(
                UserDB(
                    id="user-location-e2e",
                    email="location-e2e@example.com",
                    full_name="Location E2E",
                )
            )
            session.add(
                HabitDB(
                    id="habit-walk",
                    user_id="user-location-e2e",
                    name="Walk",
                    category="Movement",
                    unit_type="miles",
                    sensor_type="Manual",
                )
            )
            await session.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()
        self._tmpdir.cleanup()

    @asynccontextmanager
    async def db_session(self):
        async with self.Session() as session:
            yield session

    async def _ingest_ping_then_log(self, *, source: str, lat: float, lon: float):
        target_ts = 1_780_000_000_000
        completed_at = datetime.fromtimestamp(target_ts / 1000, timezone.utc).isoformat()

        service = HabitsService()
        service.tinybird_enabled = False

        async def _noop_refresh(*_args, **_kwargs):
            return {"success": True}

        with patch("services.location.ingest.get_db_session", self.db_session), \
            patch("services.location.resolver.get_db_session", self.db_session), \
            patch("services.habits_service.get_db_session", self.db_session), \
            patch("services.location.ingest._backfill_after_accepted_pings", new=AsyncMock()), \
            patch("services.location.geocoder.enqueue_reverse_geocode", new=AsyncMock()), \
            patch.object(service, "_refresh_metric_facts_for_logs", new=_noop_refresh), \
            patch.object(service, "_fire_habit_log_side_effects", new=lambda *_args, **_kwargs: None):
            ingest_result = await ingest_location_pings(
                "user-location-e2e",
                [
                    LocationPing(
                        lat=lat,
                        lon=lon,
                        horizontal_accuracy_m=12.5,
                        source=source,
                        device_id=f"{source}-device",
                        client_ts=target_ts,
                        client_event_id=f"{source}-event-1",
                    )
                ],
            )

            log = await service.log_habit(
                "habit-walk",
                HabitLogCreate(
                    amount=2.4,
                    date="2026-06-10",
                    completed_at=completed_at,
                    status="completed",
                    notes=f"Logged from {source}",
                ),
                "user-location-e2e",
            )

            async with self.Session() as session:
                stored = await session.get(HabitLogDB, log.id)

        return ingest_result, log, stored

    async def test_mac_chat_coordinate_ping_enriches_habit_log(self):
        ingest_result, log, stored = await self._ingest_ping_then_log(
            source="mac_one_shot",
            lat=40.741061,
            lon=-73.989699,
        )

        self.assertEqual(ingest_result.accepted, 1)
        self.assertEqual(log.location_lat, 40.741061)
        self.assertEqual(log.location_lon, -73.989699)
        self.assertEqual(log.location_accuracy_m, 12.5)
        self.assertEqual(log.location_source, "mac_one_shot")
        self.assertEqual(log.location_signal_age_ms, 0)
        self.assertIsNotNone(log.location_resolved_at)
        self.assertIsNotNone(stored)
        self.assertEqual(stored.location_lat, 40.741061)
        self.assertEqual(stored.location_source, "mac_one_shot")

    async def test_iphone_ping_enriches_habit_log(self):
        ingest_result, log, stored = await self._ingest_ping_then_log(
            source="ios_one_shot",
            lat=40.7128,
            lon=-74.0060,
        )

        self.assertEqual(ingest_result.accepted, 1)
        self.assertEqual(log.location_lat, 40.7128)
        self.assertEqual(log.location_lon, -74.0060)
        self.assertEqual(log.location_accuracy_m, 12.5)
        self.assertEqual(log.location_source, "ios_one_shot")
        self.assertEqual(log.location_signal_age_ms, 0)
        self.assertIsNotNone(stored)
        self.assertEqual(stored.location_lon, -74.0060)
        self.assertEqual(stored.location_source, "ios_one_shot")


if __name__ == "__main__":
    unittest.main()
