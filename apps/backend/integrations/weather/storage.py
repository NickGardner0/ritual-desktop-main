"""Database storage helpers for weather integration."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, desc, select

from database.connection import get_db_session
from database.models import IntegrationDB, WeatherDailyDB, WeatherObservationDB

from .schemas import WeatherCurrent, WeatherDailySummary, WeatherStatusResponse

WEATHER_PROVIDER = "weather"


def _to_naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _loads_metadata(raw: Optional[str]) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _dumps_metadata(data: Dict[str, Any]) -> str:
    return json.dumps(data, separators=(",", ":"))


def _row_to_current(row: WeatherObservationDB) -> WeatherCurrent:
    return WeatherCurrent(
        observed_at=row.observed_at,
        tz=row.tz,
        location_label=row.location_label,
        condition_code=row.condition_code,
        temperature_c=float(row.temperature_c),
        feels_like_c=float(row.feels_like_c),
        humidity=float(row.humidity),
        wind_speed_mps=float(row.wind_speed_mps),
        wind_gust_mps=float(row.wind_gust_mps) if row.wind_gust_mps is not None else None,
        wind_direction_deg=float(row.wind_direction_deg),
        precip_probability=float(row.precip_probability),
        precip_intensity=float(row.precip_intensity) if row.precip_intensity is not None else None,
        cloud_cover=float(row.cloud_cover) if row.cloud_cover is not None else None,
        pressure_hpa=float(row.pressure_hpa) if row.pressure_hpa is not None else None,
        visibility_m=float(row.visibility_m) if row.visibility_m is not None else None,
    )


def _row_to_daily(row: WeatherDailyDB) -> WeatherDailySummary:
    return WeatherDailySummary(
        date_local=row.date_local,
        tz=row.tz,
        location_label=row.location_label,
        condition_code=row.condition_code,
        high_c=float(row.high_c),
        low_c=float(row.low_c),
        sunrise=row.sunrise,
        sunset=row.sunset,
        uv_index_max=float(row.uv_index_max) if row.uv_index_max is not None else None,
    )


class WeatherStorage:
    def __init__(self, session_factory=get_db_session):
        self._session_factory = session_factory

    async def _fetch_integration(self, session, user_id: str) -> Optional[IntegrationDB]:
        result = await session.execute(
            select(IntegrationDB).where(
                and_(
                    IntegrationDB.user_id == user_id,
                    IntegrationDB.provider == WEATHER_PROVIDER,
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_status(self, user_id: str) -> WeatherStatusResponse:
        async with self._session_factory() as session:
            integration = await self._fetch_integration(session, user_id)
            if not integration:
                return WeatherStatusResponse(enabled=False)

            metadata = _loads_metadata(integration.metadata_json)
            return WeatherStatusResponse(
                enabled=bool(integration.enabled),
                last_sync_at=integration.last_sync_at,
                last_error=integration.last_error,
                last_location_label=metadata.get("last_location_label"),
                store_precise_location=bool(metadata.get("store_precise_location", False)),
            )

    async def connect(self, user_id: str) -> WeatherStatusResponse:
        now = datetime.utcnow()
        async with self._session_factory() as session:
            integration = await self._fetch_integration(session, user_id)
            if integration is None:
                integration = IntegrationDB(
                    user_id=user_id,
                    provider=WEATHER_PROVIDER,
                    enabled=True,
                    connected_at=now,
                    disabled_at=None,
                    metadata_json=_dumps_metadata({"store_precise_location": False}),
                    last_error=None,
                )
                session.add(integration)
            else:
                integration.enabled = True
                integration.connected_at = now
                integration.disabled_at = None
                integration.last_error = None
                metadata = _loads_metadata(integration.metadata_json)
                metadata.setdefault("store_precise_location", False)
                integration.metadata_json = _dumps_metadata(metadata)

            await session.commit()

        return await self.get_status(user_id)

    async def disconnect(self, user_id: str) -> WeatherStatusResponse:
        now = datetime.utcnow()
        async with self._session_factory() as session:
            integration = await self._fetch_integration(session, user_id)
            if integration is None:
                integration = IntegrationDB(
                    user_id=user_id,
                    provider=WEATHER_PROVIDER,
                    enabled=False,
                    connected_at=None,
                    disabled_at=now,
                    metadata_json=_dumps_metadata({"store_precise_location": False}),
                )
                session.add(integration)
            else:
                integration.enabled = False
                integration.disabled_at = now

            await session.commit()

        return await self.get_status(user_id)

    async def mark_last_error(self, user_id: str, message: str) -> None:
        async with self._session_factory() as session:
            integration = await self._fetch_integration(session, user_id)
            if integration is None:
                integration = IntegrationDB(
                    user_id=user_id,
                    provider=WEATHER_PROVIDER,
                    enabled=False,
                    last_error=message,
                )
                session.add(integration)
            else:
                integration.last_error = message
            await session.commit()

    async def get_sync_gate(
        self,
        user_id: str,
        lat_bucket: str,
        min_interval_seconds: int,
    ) -> Dict[str, Any]:
        now = datetime.utcnow()
        async with self._session_factory() as session:
            integration = await self._fetch_integration(session, user_id)
            if integration is None:
                return {
                    "enabled": False,
                    "skip_fetch": False,
                    "current": None,
                    "today": None,
                    "metadata": {},
                }

            metadata = _loads_metadata(integration.metadata_json)
            enabled = bool(integration.enabled)
            skip_fetch = False
            current = None
            today = None

            if enabled and integration.last_sync_at:
                elapsed = (now - integration.last_sync_at).total_seconds()
                same_bucket = metadata.get("last_lat_bucket") == lat_bucket
                if same_bucket and elapsed < min_interval_seconds:
                    current, today = await self._get_latest_snapshot_in_session(session, user_id)
                    if current is not None:
                        skip_fetch = True

            return {
                "enabled": enabled,
                "skip_fetch": skip_fetch,
                "current": current,
                "today": today,
                "metadata": metadata,
            }

    async def store_sync_result(
        self,
        user_id: str,
        current: WeatherCurrent,
        today: Optional[WeatherDailySummary],
        metadata_updates: Dict[str, Any],
    ) -> Tuple[WeatherCurrent, Optional[WeatherDailySummary]]:
        now = datetime.utcnow()
        observed_at = _to_naive_utc(current.observed_at) or now

        async with self._session_factory() as session:
            integration = await self._fetch_integration(session, user_id)
            if integration is None:
                integration = IntegrationDB(
                    user_id=user_id,
                    provider=WEATHER_PROVIDER,
                    enabled=True,
                    connected_at=now,
                    metadata_json=_dumps_metadata({}),
                )
                session.add(integration)

            metadata = _loads_metadata(integration.metadata_json)
            metadata.update(metadata_updates)
            integration.metadata_json = _dumps_metadata(metadata)
            integration.last_sync_at = now
            integration.last_error = None

            observation = WeatherObservationDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                observed_at=observed_at,
                tz=current.tz,
                location_label=current.location_label,
                condition_code=current.condition_code,
                temperature_c=float(current.temperature_c),
                feels_like_c=float(current.feels_like_c),
                humidity=float(current.humidity),
                wind_speed_mps=float(current.wind_speed_mps),
                wind_gust_mps=float(current.wind_gust_mps) if current.wind_gust_mps is not None else None,
                wind_direction_deg=float(current.wind_direction_deg),
                precip_probability=float(current.precip_probability),
                precip_intensity=float(current.precip_intensity) if current.precip_intensity is not None else None,
                cloud_cover=float(current.cloud_cover) if current.cloud_cover is not None else None,
                pressure_hpa=float(current.pressure_hpa) if current.pressure_hpa is not None else None,
                visibility_m=float(current.visibility_m) if current.visibility_m is not None else None,
                source="weatherkit",
            )
            session.add(observation)

            if today is not None:
                daily_result = await session.execute(
                    select(WeatherDailyDB).where(
                        and_(
                            WeatherDailyDB.user_id == user_id,
                            WeatherDailyDB.date_local == today.date_local,
                        )
                    )
                )
                daily_row = daily_result.scalar_one_or_none()
                if daily_row is None:
                    daily_row = WeatherDailyDB(
                        id=str(uuid.uuid4()),
                        user_id=user_id,
                        date_local=today.date_local,
                        tz=today.tz,
                        location_label=today.location_label,
                        condition_code=today.condition_code,
                        high_c=float(today.high_c),
                        low_c=float(today.low_c),
                        sunrise=_to_naive_utc(today.sunrise),
                        sunset=_to_naive_utc(today.sunset),
                        uv_index_max=float(today.uv_index_max) if today.uv_index_max is not None else None,
                        source="weatherkit",
                    )
                    session.add(daily_row)
                else:
                    daily_row.tz = today.tz
                    daily_row.location_label = today.location_label
                    daily_row.condition_code = today.condition_code
                    daily_row.high_c = float(today.high_c)
                    daily_row.low_c = float(today.low_c)
                    daily_row.sunrise = _to_naive_utc(today.sunrise)
                    daily_row.sunset = _to_naive_utc(today.sunset)
                    daily_row.uv_index_max = float(today.uv_index_max) if today.uv_index_max is not None else None
                    daily_row.updated_at = now

            await session.commit()

        return await self.get_latest_snapshot(user_id)

    async def _get_latest_snapshot_in_session(
        self,
        session,
        user_id: str,
    ) -> Tuple[Optional[WeatherCurrent], Optional[WeatherDailySummary]]:
        obs_result = await session.execute(
            select(WeatherObservationDB)
            .where(WeatherObservationDB.user_id == user_id)
            .order_by(desc(WeatherObservationDB.observed_at))
            .limit(1)
        )
        obs_row = obs_result.scalar_one_or_none()
        current = _row_to_current(obs_row) if obs_row else None

        daily_result = await session.execute(
            select(WeatherDailyDB)
            .where(WeatherDailyDB.user_id == user_id)
            .order_by(desc(WeatherDailyDB.date_local))
            .limit(1)
        )
        daily_row = daily_result.scalar_one_or_none()
        today = _row_to_daily(daily_row) if daily_row else None

        return current, today

    async def get_latest_snapshot(
        self,
        user_id: str,
    ) -> Tuple[Optional[WeatherCurrent], Optional[WeatherDailySummary]]:
        async with self._session_factory() as session:
            return await self._get_latest_snapshot_in_session(session, user_id)

    async def get_current_payload(self, user_id: str) -> Dict[str, Any]:
        status = await self.get_status(user_id)
        current, today = await self.get_latest_snapshot(user_id)
        return {
            "enabled": status.enabled,
            "current": current,
            "today": today,
        }

    async def get_range(
        self,
        user_id: str,
        start: datetime,
        end: datetime,
    ) -> List[WeatherCurrent]:
        async with self._session_factory() as session:
            result = await session.execute(
                select(WeatherObservationDB)
                .where(WeatherObservationDB.user_id == user_id)
                .where(WeatherObservationDB.observed_at >= _to_naive_utc(start))
                .where(WeatherObservationDB.observed_at <= _to_naive_utc(end))
                .order_by(WeatherObservationDB.observed_at.asc())
            )
            rows = result.scalars().all()
            return [_row_to_current(row) for row in rows]

    async def delete_user_weather_data(self, user_id: str) -> None:
        async with self._session_factory() as session:
            obs_rows = await session.execute(
                select(WeatherObservationDB).where(WeatherObservationDB.user_id == user_id)
            )
            for row in obs_rows.scalars().all():
                session.delete(row)

            daily_rows = await session.execute(
                select(WeatherDailyDB).where(WeatherDailyDB.user_id == user_id)
            )
            for row in daily_rows.scalars().all():
                session.delete(row)

            await session.commit()
