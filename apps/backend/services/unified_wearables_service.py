"""
Unified wearable domain services.

These services own canonical wearable storage and the projection bridge back into
the existing habit_logs + Tinybird compatibility layer.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import delete, func, select

from database.connection import get_db_session
from database.models import (
    HabitDB,
    HabitLogDB,
    WearableConnectionDB,
    WearableDeviceDB,
    WearableEventDB,
    WearableMetricDB,
    WearableRawPayloadDB,
    WearableSampleDB,
    WearableSourceDB,
    WearableSyncCursorDB,
    WearableSyncRunDB,
)
from services.token_crypto import token_crypto

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderCapabilityDef:
    provider: str
    display_name: str
    auth_method: str
    supports_webhook: bool = False
    supports_import_fallback: bool = False
    supports_metric_selection: bool = True
    supports_backfill: bool = True
    is_available: bool = True


PROVIDER_CAPABILITIES: Dict[str, ProviderCapabilityDef] = {
    "apple_health": ProviderCapabilityDef(
        provider="apple_health",
        display_name="Apple Health",
        auth_method="sdk",
        supports_import_fallback=True,
    ),
    "whoop": ProviderCapabilityDef(
        provider="whoop",
        display_name="Whoop",
        auth_method="oauth",
    ),
    "garmin": ProviderCapabilityDef(
        provider="garmin",
        display_name="Garmin",
        auth_method="oauth",
        supports_webhook=True,
        supports_import_fallback=True,
    ),
    "oura": ProviderCapabilityDef(
        provider="oura",
        display_name="Oura",
        auth_method="oauth",
        supports_import_fallback=True,
    ),
    "fitbit": ProviderCapabilityDef(
        provider="fitbit",
        display_name="Fitbit",
        auth_method="oauth",
        is_available=False,
    ),
}


class WearableNormalizationService:
    """Canonical metric/event naming helpers."""

    APPLE_METRIC_ALIASES = {
        "hr": "heart_rate",
        "resting_hr": "resting_heart_rate",
        "walking_hr": "walking_heart_rate",
        "sleep_session": "sleep_total",
        "sleep_core": "sleep_light",
        "active_energy": "active_energy",
        "basal_energy": "basal_energy",
    }

    WHOOP_METRIC_ALIASES = {
        "recovery_score": "recovery_score",
        "strain": "strain_score",
        "sleep_session": "sleep_total",
        "hrv_rmssd": "hrv",
        "resting_heart_rate": "resting_heart_rate",
        "spo2_percentage": "oxygen_saturation",
        "skin_temp_celsius": "temperature_delta",
    }

    OURA_METRIC_ALIASES = {
        "score": "readiness_score",
        "readiness_score": "readiness_score",
        "sleep_score": "sleep_score",
        "activity_score": "activity_score",
        "average_hrv": "hrv",
        "hrv": "hrv",
        "lowest_heart_rate": "resting_heart_rate",
        "average_heart_rate": "heart_rate",
        "temperature_deviation": "temperature_delta",
    }

    GARMIN_METRIC_ALIASES = {
        "resting_heart_rate": "resting_heart_rate",
        "steps": "steps",
        "distance": "distance",
        "active_energy": "active_energy",
        "stress": "stress_score",
        "body_battery": "body_battery",
        "oxygen_saturation": "oxygen_saturation",
        "respiration": "respiratory_rate",
    }

    DURATION_METRIC_TYPES = {
        "sleep_total",
        "mindful_minutes",
        "exercise_time",
        "stand_time",
        "workout_duration",
    }

    def canonicalize_metric_type(self, provider: str, metric_type: str) -> str:
        aliases = {}
        if provider == "apple_health":
            aliases = self.APPLE_METRIC_ALIASES
        elif provider == "whoop":
            aliases = self.WHOOP_METRIC_ALIASES
        elif provider == "oura":
            aliases = self.OURA_METRIC_ALIASES
        elif provider == "garmin":
            aliases = self.GARMIN_METRIC_ALIASES
        return aliases.get(metric_type, metric_type)

    def sample_attributes(
        self,
        *,
        provider_metric_type: Optional[str] = None,
        raw_payload: Any = None,
        source_bundle_id: Optional[str] = None,
        source_device_name: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        payload: Dict[str, Any] = {}
        if provider_metric_type:
            payload["provider_metric_type"] = provider_metric_type
        if source_bundle_id:
            payload["source_bundle_id"] = source_bundle_id
        if source_device_name:
            payload["source_device_name"] = source_device_name
        if extra:
            payload.update(extra)
        if raw_payload is not None:
            payload["raw_payload_preview"] = raw_payload
        return json.dumps(payload) if payload else None

    def log_values(self, metric_type: str, unit: str, value: float) -> Tuple[Optional[int], Optional[float]]:
        if metric_type in self.DURATION_METRIC_TYPES or metric_type.startswith("sleep_"):
            if unit == "hours":
                return int(value * 3600), None
            if unit == "minutes":
                return int(value * 60), None
            if unit == "seconds":
                return int(value), None
        return None, value


class WearableConnectionService:
    def __init__(self):
        self.logger = logger

    async def get_or_create_connection(
        self,
        *,
        user_id: str,
        provider: str,
        auth_method: str,
        provider_user_id: Optional[str] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[datetime] = None,
        scopes: Optional[List[str]] = None,
        settings: Optional[Dict[str, Any]] = None,
        status: str = "active",
        reset_sync_state: bool = False,
    ) -> WearableConnectionDB:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == provider,
                )
            )
            connection = result.scalar_one_or_none()
            now = datetime.now(timezone.utc)
            if connection is None:
                connection = WearableConnectionDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    provider=provider,
                    auth_method=auth_method,
                    created_at=now,
                )
                session.add(connection)

            connection.auth_method = auth_method
            connection.provider_user_id = provider_user_id
            connection.status = status
            connection.access_token = token_crypto.encrypt(access_token) if access_token else connection.access_token
            connection.refresh_token = token_crypto.encrypt(refresh_token) if refresh_token else connection.refresh_token
            connection.token_expires_at = token_expires_at
            if scopes is not None:
                connection.scopes_json = json.dumps(scopes)
            if settings is not None:
                merged_settings: Dict[str, Any] = {}
                if connection.settings_json:
                    try:
                        merged_settings.update(json.loads(connection.settings_json))
                    except Exception:
                        merged_settings = {}
                merged_settings.update(settings)
                connection.settings_json = json.dumps(merged_settings)
            if reset_sync_state:
                connection.last_sync_at = None
                connection.last_successful_sync_at = None
                connection.last_error_json = None
            connection.updated_at = now

            await session.commit()
            await session.refresh(connection)
            return connection

    async def get_connection(self, user_id: str, provider: str) -> Optional[WearableConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == provider,
                )
            )
            return result.scalar_one_or_none()

    async def list_connections(self, user_id: str) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(WearableConnectionDB.user_id == user_id)
            )
            connections = result.scalars().all()

            counts_result = await session.execute(
                select(WearableSourceDB.connection_id, func.count(WearableSourceDB.id))
                .where(WearableSourceDB.user_id == user_id)
                .group_by(WearableSourceDB.connection_id)
            )
            source_counts = {row[0]: row[1] for row in counts_result.fetchall()}

            tracked_result = await session.execute(
                select(HabitDB.integration_source, HabitDB.metric_type)
                .where(HabitDB.user_id == user_id)
                .where(HabitDB.integration_source.isnot(None))
                .where(HabitDB.metric_type.isnot(None))
            )
            tracked_by_provider: Dict[str, List[str]] = {}
            for provider, metric_type in tracked_result.fetchall():
                tracked_by_provider.setdefault(provider, []).append(metric_type)

            event_latest_result = await session.execute(
                select(WearableEventDB.provider, func.max(WearableEventDB.attributed_date))
                .where(WearableEventDB.user_id == user_id)
                .where(WearableEventDB.deleted_at.is_(None))
                .where(WearableEventDB.attributed_date.is_not(None))
                .group_by(WearableEventDB.provider)
            )
            latest_event_dates = {row[0]: row[1] for row in event_latest_result.fetchall()}

            sample_latest_result = await session.execute(
                select(WearableSampleDB.provider, func.max(WearableSampleDB.attributed_date))
                .where(WearableSampleDB.user_id == user_id)
                .where(WearableSampleDB.deleted_at.is_(None))
                .where(WearableSampleDB.attributed_date.is_not(None))
                .group_by(WearableSampleDB.provider)
            )
            latest_sample_dates = {row[0]: row[1] for row in sample_latest_result.fetchall()}

            sleep_latest_result = await session.execute(
                select(WearableEventDB.provider, func.max(WearableEventDB.attributed_date))
                .where(WearableEventDB.user_id == user_id)
                .where(WearableEventDB.deleted_at.is_(None))
                .where(WearableEventDB.event_type == "sleep_total")
                .where(WearableEventDB.attributed_date.is_not(None))
                .group_by(WearableEventDB.provider)
            )
            latest_sleep_dates = {row[0]: row[1] for row in sleep_latest_result.fetchall()}

            items = []
            for connection in connections:
                settings: Dict[str, Any] = {}
                if connection.settings_json:
                    try:
                        settings = json.loads(connection.settings_json)
                    except Exception:
                        settings = {}

                latest_data_date = max(
                    [value for value in [latest_event_dates.get(connection.provider), latest_sample_dates.get(connection.provider)] if value],
                    default=None,
                )
                latest_sleep_date = latest_sleep_dates.get(connection.provider)
                latest_upstream_sleep_date = settings.get("latest_upstream_sleep_date")
                sync_hour = settings.get("sync_hour")
                if sync_hour is None and connection.provider == "whoop":
                    sync_hour = settings.get("whoop_sync_hour", 9)
                auto_sync_enabled = bool(settings.get("auto_sync_enabled", connection.provider != "apple_health"))
                auto_sync_mode = "device" if connection.provider == "apple_health" else "trigger"
                auto_sync_note = None
                if connection.provider == "apple_health":
                    auto_sync_note = (
                        "Apple Health uploads are driven by the iPhone companion app. "
                        "This saved schedule is reserved for device-managed sync windows."
                    )
                elif connection.provider == "garmin":
                    auto_sync_note = "Garmin data is primarily webhook-driven; scheduled sync refreshes the connected account."

                is_upstream_stale = False
                stale_message = None
                if connection.provider == "whoop" and latest_upstream_sleep_date:
                    stale_threshold = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
                    if latest_upstream_sleep_date < stale_threshold:
                        is_upstream_stale = True
                        stale_message = f"Whoop has not returned sleep after {latest_upstream_sleep_date} yet."

                items.append(
                    {
                        "id": connection.id,
                        "provider": connection.provider,
                        "auth_method": connection.auth_method,
                        "status": connection.status,
                        "provider_user_id": connection.provider_user_id,
                        "last_sync_at": connection.last_sync_at.isoformat() if connection.last_sync_at else None,
                        "last_successful_sync_at": connection.last_successful_sync_at.isoformat()
                        if connection.last_successful_sync_at
                        else None,
                        "last_error_json": json.loads(connection.last_error_json)
                        if connection.last_error_json
                        else None,
                        "tracked_metrics": sorted(set(tracked_by_provider.get(connection.provider, []))),
                        "source_count": source_counts.get(connection.id, 0),
                        "auto_sync_enabled": auto_sync_enabled,
                        "sync_hour": sync_hour,
                        "auto_sync_mode": auto_sync_mode,
                        "auto_sync_note": auto_sync_note,
                        "latest_data_date": latest_data_date,
                        "latest_sleep_date": latest_sleep_date,
                        "latest_upstream_sleep_date": latest_upstream_sleep_date,
                        "is_upstream_stale": is_upstream_stale,
                        "stale_message": stale_message,
                    }
                )

            return items

    async def disconnect(self, user_id: str, provider: str) -> Optional[WearableConnectionDB]:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == user_id,
                    WearableConnectionDB.provider == provider,
                )
            )
            connection = result.scalar_one_or_none()
            if connection is None:
                return None
            connection.status = "revoked"
            connection.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(connection)
            return connection

    async def list_provider_capabilities(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for definition in PROVIDER_CAPABILITIES.values():
            items.append(
                {
                    "provider": definition.provider,
                    "display_name": definition.display_name,
                    "auth_method": definition.auth_method,
                    "supports_sync": True,
                    "supports_webhook": definition.supports_webhook,
                    "supports_import_fallback": definition.supports_import_fallback,
                    "supports_metric_selection": definition.supports_metric_selection,
                    "supports_backfill": definition.supports_backfill,
                }
            )
        return items


class WearableProjectionService:
    LEGACY_METRIC_EQUIVALENTS: Dict[str, set[str]] = {
        "sleep_total": {"sleep_total", "sleep_session", "sleep_duration", "sleep", "in_bed"},
        "sleep_light": {"sleep_light", "sleep_core"},
        "heart_rate": {"heart_rate", "hr"},
        "resting_heart_rate": {"resting_heart_rate", "resting_hr"},
        "walking_heart_rate": {"walking_heart_rate", "walking_hr"},
        "hrv": {"hrv", "hrv_rmssd"},
        "strain_score": {"strain_score", "strain"},
        "oxygen_saturation": {"oxygen_saturation", "spo2_percentage"},
        "temperature_delta": {"temperature_delta", "skin_temp_celsius"},
    }

    def __init__(self, normalization: WearableNormalizationService):
        self.normalization = normalization

    def _candidate_metric_types(self, metric_type: str) -> set[str]:
        normalized_metric = (metric_type or "").strip().lower()
        if not normalized_metric:
            return set()
        return set(self.LEGACY_METRIC_EQUIVALENTS.get(normalized_metric, {normalized_metric}))

    def _habit_matches_metric_type(self, habit: HabitDB, metric_type: str) -> bool:
        normalized_metric = (metric_type or "").strip().lower()
        habit_metric = (habit.metric_type or "").strip().lower()

        if habit_metric:
            return habit_metric in self._candidate_metric_types(normalized_metric)

        habit_name = (habit.name or "").strip().lower()
        if normalized_metric == "sleep_total":
            return "sleep" in habit_name
        if normalized_metric.startswith("sleep_"):
            metric_hint = normalized_metric.replace("sleep_", "").replace("_", " ")
            return "sleep" in habit_name and metric_hint in habit_name
        return False

    async def project_sample(
        self,
        *,
        user_id: str,
        provider: str,
        sample: WearableSampleDB,
    ) -> None:
        date_value = sample.attributed_date
        if not date_value:
            reference_dt = sample.start_time or sample.recorded_at or sample.end_time
            if reference_dt is None:
                return
            date_value = reference_dt.strftime("%Y-%m-%d")

        duration, amount = self.normalization.log_values(sample.metric_type, sample.unit, sample.value)
        await self._upsert_habit_logs(
            user_id=user_id,
            provider=provider,
            metric_type=sample.metric_type,
            date_value=date_value,
            completed_at=(sample.end_time or sample.recorded_at or sample.start_time),
            duration=duration,
            amount=amount,
            origin_kind="sample",
            origin_id=sample.id,
            note=f"Auto-synced from {provider}",
        )

    async def project_event(
        self,
        *,
        user_id: str,
        provider: str,
        event: WearableEventDB,
    ) -> None:
        date_value = event.attributed_date or event.start_time.strftime("%Y-%m-%d")
        duration_seconds = int((event.end_time - event.start_time).total_seconds())
        amount = event.summary_value
        if event.summary_value is not None and event.summary_unit:
            normalized_duration, normalized_amount = self.normalization.log_values(
                event.event_type,
                event.summary_unit,
                float(event.summary_value),
            )
            if normalized_duration is not None:
                duration_seconds = normalized_duration
                amount = None
            elif normalized_amount is not None:
                amount = normalized_amount
        await self._upsert_habit_logs(
            user_id=user_id,
            provider=provider,
            metric_type=event.event_type,
            date_value=date_value,
            completed_at=event.end_time,
            duration=duration_seconds,
            amount=amount,
            origin_kind="event",
            origin_id=event.id,
            note=f"Auto-synced from {provider}",
        )

    async def delete_projection(self, origin_kind: str, origin_id: str) -> int:
        async with get_db_session() as session:
            result = await session.execute(
                select(HabitLogDB).where(
                    HabitLogDB.origin_record_kind == origin_kind,
                    HabitLogDB.origin_record_id == origin_id,
                )
            )
            logs = list(result.scalars().all())
            deleted = len(logs)
            for log in logs:
                await session.delete(log)
            await session.commit()
            return deleted

    async def backfill_projections(
        self,
        *,
        user_id: str,
        provider: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, int]:
        def in_range(date_value: Optional[str]) -> bool:
            if not date_value:
                return False
            if start_date and date_value < start_date:
                return False
            if end_date and date_value > end_date:
                return False
            return True

        async with get_db_session() as session:
            sample_query = select(WearableSampleDB).where(WearableSampleDB.user_id == user_id)
            event_query = select(WearableEventDB).where(WearableEventDB.user_id == user_id)

            if provider:
                sample_query = sample_query.where(WearableSampleDB.provider == provider)
                event_query = event_query.where(WearableEventDB.provider == provider)

            sample_query = sample_query.where(WearableSampleDB.deleted_at.is_(None))
            event_query = event_query.where(WearableEventDB.deleted_at.is_(None))

            samples_result = await session.execute(sample_query)
            events_result = await session.execute(event_query)
            samples = list(samples_result.scalars().all())
            events = list(events_result.scalars().all())

        projected_samples = 0
        projected_events = 0

        for sample in samples:
            date_value = sample.attributed_date or (
                sample.start_time or sample.recorded_at or sample.end_time
            ).strftime("%Y-%m-%d")
            if not in_range(date_value):
                continue
            await self.project_sample(user_id=user_id, provider=sample.provider, sample=sample)
            projected_samples += 1

        for event in events:
            date_value = event.attributed_date or event.start_time.strftime("%Y-%m-%d")
            if not in_range(date_value):
                continue
            await self.project_event(user_id=user_id, provider=event.provider, event=event)
            projected_events += 1

        return {
            "projected_samples": projected_samples,
            "projected_events": projected_events,
            "total": projected_samples + projected_events,
        }

    async def _upsert_habit_logs(
        self,
        *,
        user_id: str,
        provider: str,
        metric_type: str,
        date_value: str,
        completed_at: Optional[datetime],
        duration: Optional[int],
        amount: Optional[float],
        origin_kind: str,
        origin_id: str,
        note: str,
    ) -> None:
        async with get_db_session() as session:
            tinybird_payloads: List[Dict[str, Any]] = []
            habits_result = await session.execute(
                select(HabitDB).where(
                    HabitDB.user_id == user_id,
                    HabitDB.integration_source == provider,
                )
            )
            habits = [
                habit
                for habit in habits_result.scalars().all()
                if self._habit_matches_metric_type(habit, metric_type)
            ]
            if not habits:
                return

            for habit in habits:
                existing_result = await session.execute(
                    select(HabitLogDB).where(
                        HabitLogDB.habit_id == habit.id,
                        HabitLogDB.origin_record_kind == origin_kind,
                        HabitLogDB.origin_record_id == origin_id,
                    )
                )
                existing = existing_result.scalar_one_or_none()
                if existing is None and metric_type.startswith("sleep_"):
                    legacy_result = await session.execute(
                        select(HabitLogDB).where(
                            HabitLogDB.habit_id == habit.id,
                            HabitLogDB.date == date_value,
                            HabitLogDB.origin_record_kind.is_(None),
                            HabitLogDB.origin_record_id.is_(None),
                        ).order_by(HabitLogDB.completed_at.desc())
                    )
                    existing = legacy_result.scalar_one_or_none()
                completed_at_str = completed_at.isoformat() if completed_at else None
                if existing is None:
                    existing = HabitLogDB(
                        id=str(uuid.uuid4()),
                        habit_id=habit.id,
                        habit_name=habit.name,
                        date=date_value,
                        status="completed",
                        source=provider,
                        notes=note,
                        origin_record_kind=origin_kind,
                        origin_record_id=origin_id,
                    )
                    session.add(existing)

                existing.date = date_value
                existing.completed_at = completed_at_str
                existing.duration = duration
                existing.amount = amount
                existing.notes = note
                existing.source = provider
                existing.origin_record_kind = origin_kind
                existing.origin_record_id = origin_id
                tinybird_payloads.append(
                    {
                        "id": existing.id,
                        "habit_id": existing.habit_id,
                        "habit_name": existing.habit_name,
                        "user_id": user_id,
                        "date": existing.date,
                        "duration": existing.duration,
                        "amount": existing.amount,
                        "unit": habit.unit_type or "",
                        "status": existing.status,
                        "notes": existing.notes,
                        "source": provider,
                        "integration_source": habit.integration_source or provider,
                        "metric_type": habit.metric_type,
                        "metadata": existing.log_metadata,
                        "completed_at": existing.completed_at or existing.date,
                    }
                )

            await session.commit()

            try:
                from services.tinybird_service import TinybirdService

                tinybird = TinybirdService()
            except Exception:
                tinybird = None

            if tinybird is not None and tinybird_payloads:
                try:
                    result = await tinybird.ingest_habit_logs_batch(tinybird_payloads)
                    if not result.get("success"):
                        logger.warning(
                            "Tinybird sync failed for projected wearable logs: %s",
                            result.get("errors") or result.get("error"),
                        )
                except Exception as exc:
                    logger.warning("Tinybird sync failed for projected wearable logs: %s", exc)


class WearableQueryService:
    async def get_samples(
        self,
        *,
        user_id: str,
        provider: Optional[str] = None,
        metric_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        include_deleted: bool = False,
        limit: int = 100,
    ) -> List[WearableSampleDB]:
        async with get_db_session() as session:
            query = select(WearableSampleDB).where(WearableSampleDB.user_id == user_id)
            if provider:
                query = query.where(WearableSampleDB.provider == provider)
            if metric_type:
                query = query.where(WearableSampleDB.metric_type == metric_type)
            if start_time:
                query = query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time) >= start_time)
            if end_time:
                query = query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.end_time) <= end_time)
            if not include_deleted:
                query = query.where(WearableSampleDB.deleted_at.is_(None))
            query = query.order_by(WearableSampleDB.recorded_at.desc(), WearableSampleDB.start_time.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def get_events(
        self,
        *,
        user_id: str,
        provider: Optional[str] = None,
        event_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        include_deleted: bool = False,
        limit: int = 100,
    ) -> List[WearableEventDB]:
        async with get_db_session() as session:
            query = select(WearableEventDB).where(WearableEventDB.user_id == user_id)
            if provider:
                query = query.where(WearableEventDB.provider == provider)
            if event_type:
                query = query.where(WearableEventDB.event_type == event_type)
            if start_time:
                query = query.where(WearableEventDB.start_time >= start_time)
            if end_time:
                query = query.where(WearableEventDB.end_time <= end_time)
            if not include_deleted:
                query = query.where(WearableEventDB.deleted_at.is_(None))
            query = query.order_by(WearableEventDB.start_time.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def get_sync_runs(self, *, user_id: str, provider: Optional[str] = None, limit: int = 50) -> List[WearableSyncRunDB]:
        async with get_db_session() as session:
            query = (
                select(WearableSyncRunDB)
                .join(WearableConnectionDB, WearableConnectionDB.id == WearableSyncRunDB.connection_id, isouter=True)
                .where(
                    (WearableConnectionDB.user_id == user_id)
                    | ((WearableConnectionDB.id.is_(None)) & (WearableSyncRunDB.provider == "apple_health"))
                )
            )
            if provider:
                query = query.where(WearableSyncRunDB.provider == provider)
            query = query.order_by(WearableSyncRunDB.started_at.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())


class WearableSyncService:
    def __init__(
        self,
        connection_service: WearableConnectionService,
        normalization: WearableNormalizationService,
        projection_service: WearableProjectionService,
    ):
        self.connection_service = connection_service
        self.normalization = normalization
        self.projection_service = projection_service

    async def start_sync_run(
        self,
        *,
        provider: str,
        trigger: str,
        connection_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WearableSyncRunDB:
        async with get_db_session() as session:
            run = WearableSyncRunDB(
                id=str(uuid.uuid4()),
                connection_id=connection_id,
                provider=provider,
                trigger=trigger,
                status="running",
                started_at=datetime.now(timezone.utc),
                metadata_json=json.dumps(metadata or {}),
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            return run

    async def finish_sync_run(
        self,
        run_id: str,
        *,
        status: str,
        items_seen: int = 0,
        items_written: int = 0,
        items_updated: int = 0,
        items_deleted: int = 0,
        error: Optional[Dict[str, Any]] = None,
    ) -> None:
        async with get_db_session() as session:
            result = await session.execute(select(WearableSyncRunDB).where(WearableSyncRunDB.id == run_id))
            run = result.scalar_one_or_none()
            if run is None:
                return
            run.status = status
            run.completed_at = datetime.now(timezone.utc)
            run.items_seen = items_seen
            run.items_written = items_written
            run.items_updated = items_updated
            run.items_deleted = items_deleted
            run.error_json = json.dumps(error) if error is not None else None
            await session.commit()

    async def upsert_source(
        self,
        *,
        user_id: str,
        provider: str,
        connection_id: Optional[str],
        source_kind: str,
        external_source_id: Optional[str],
        external_source_name: Optional[str] = None,
        device_name: Optional[str] = None,
        device_model: Optional[str] = None,
        device_type: Optional[str] = None,
        platform: Optional[str] = None,
        source_bundle_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WearableSourceDB:
        async with get_db_session() as session:
            query = select(WearableSourceDB).where(
                WearableSourceDB.user_id == user_id,
                WearableSourceDB.provider == provider,
            )
            if external_source_id:
                query = query.where(WearableSourceDB.external_source_id == external_source_id)
            else:
                query = query.where(WearableSourceDB.device_name == device_name)
            result = await session.execute(query.limit(1))
            source = result.scalar_one_or_none()
            if source is None:
                source = WearableSourceDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    provider=provider,
                    created_at=datetime.now(timezone.utc),
                )
                session.add(source)
            source.connection_id = connection_id
            source.source_kind = source_kind
            source.external_source_id = external_source_id
            source.external_source_name = external_source_name
            source.device_name = device_name
            source.device_model = device_model
            source.device_type = device_type
            source.platform = platform
            source.source_bundle_id = source_bundle_id
            source.metadata_json = json.dumps(metadata) if metadata else source.metadata_json
            source.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(source)
            return source

    async def store_raw_payload(
        self,
        *,
        user_id: str,
        provider: str,
        direction: str,
        payload: Any,
        connection_id: Optional[str] = None,
        external_id: Optional[str] = None,
    ) -> WearableRawPayloadDB:
        payload_json = payload if isinstance(payload, str) else json.dumps(payload, default=str)
        digest = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
        async with get_db_session() as session:
            record = WearableRawPayloadDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                connection_id=connection_id,
                provider=provider,
                direction=direction,
                external_id=external_id,
                payload_sha256=digest,
                payload_json=payload_json,
                received_at=datetime.now(timezone.utc),
            )
            session.add(record)
            await session.commit()
            await session.refresh(record)
            return record

    async def update_connection_sync_state(
        self,
        *,
        connection_id: Optional[str],
        status: str = "active",
        error: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not connection_id:
            return
        async with get_db_session() as session:
            result = await session.execute(select(WearableConnectionDB).where(WearableConnectionDB.id == connection_id))
            connection = result.scalar_one_or_none()
            if connection is None:
                return
            now = datetime.now(timezone.utc)
            connection.last_sync_at = now
            connection.updated_at = now
            connection.status = status
            if error is None:
                connection.last_successful_sync_at = now
                connection.last_error_json = None
            else:
                connection.last_error_json = json.dumps(error)
            await session.commit()

    async def upsert_sync_cursor(
        self,
        *,
        connection_id: str,
        cursor_key: str,
        cursor_type: str,
        cursor_value: str,
        source_id: Optional[str] = None,
    ) -> WearableSyncCursorDB:
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableSyncCursorDB).where(
                    WearableSyncCursorDB.connection_id == connection_id,
                    WearableSyncCursorDB.cursor_key == cursor_key,
                    WearableSyncCursorDB.source_id == source_id,
                )
            )
            cursor = result.scalar_one_or_none()
            if cursor is None:
                cursor = WearableSyncCursorDB(
                    id=str(uuid.uuid4()),
                    connection_id=connection_id,
                    source_id=source_id,
                    cursor_key=cursor_key,
                    created_at=datetime.now(timezone.utc),
                )
                session.add(cursor)
            cursor.cursor_type = cursor_type
            cursor.cursor_value = cursor_value
            cursor.last_synced_at = datetime.now(timezone.utc)
            cursor.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(cursor)
            return cursor

    async def ingest_apple_metrics(
        self,
        *,
        user_id: str,
        device_id: str,
        metrics: Iterable[Any],
    ) -> List[Tuple[str, str]]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="apple_health",
            auth_method="sdk",
            status="active",
        )
        source = await self.upsert_source(
            user_id=user_id,
            provider="apple_health",
            connection_id=connection.id,
            source_kind="device",
            external_source_id=device_id,
            device_name="Apple Health Device",
            platform="ios",
        )

        stored: List[Tuple[str, str]] = []
        for metric in metrics:
            canonical_type = self.normalization.canonicalize_metric_type("apple_health", metric.metric_type.value)
            raw_payload = metric.raw_payload
            raw_record = None
            if raw_payload is not None:
                raw_record = await self.store_raw_payload(
                    user_id=user_id,
                    provider="apple_health",
                    direction="sdk_ingest",
                    connection_id=connection.id,
                    payload=raw_payload,
                    external_id=metric.external_id,
                )

            start_time = datetime.fromisoformat(metric.start_time.replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(metric.end_time.replace("Z", "+00:00"))
            recorded_at = None
            if metric.recorded_at:
                recorded_at = datetime.fromisoformat(metric.recorded_at.replace("Z", "+00:00"))

            if metric.metric_type.value in {"sleep_session", "workout"}:
                event_id, created = await self._upsert_event(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=source.id,
                    provider="apple_health",
                    event_type=canonical_type if metric.metric_type.value != "workout" else "workout",
                    provider_event_type=metric.metric_type.value,
                    external_id=metric.external_id,
                    start_time=start_time,
                    end_time=end_time,
                    attributed_date=metric.attributed_date,
                    timezone=metric.timezone,
                    title=metric.metric_type.value.replace("_", " ").title(),
                    summary_value=metric.value,
                    summary_unit=metric.unit.value,
                    details={
                        "source_bundle_id": metric.source_bundle_id,
                        "source_device_name": metric.source_device_name,
                        "recorded_at": metric.recorded_at,
                        "raw_payload": raw_payload,
                    },
                    raw_payload_id=raw_record.id if raw_record else None,
                )
                event = await self.get_event(event_id)
                if event and event.deleted_at is None:
                    await self.projection_service.project_event(user_id=user_id, provider="apple_health", event=event)
                stored.append((event_id, "event"))
                continue

            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                provider="apple_health",
                metric_type=canonical_type,
                provider_metric_type=metric.metric_type.value,
                external_id=metric.external_id,
                recorded_at=recorded_at,
                start_time=start_time,
                end_time=end_time,
                attributed_date=metric.attributed_date,
                value=metric.value,
                unit=metric.unit.value,
                aggregation_kind="interval" if metric.start_time != metric.end_time else "point",
                confidence=metric.confidence,
                timezone=metric.timezone,
                attributes_json=self.normalization.sample_attributes(
                    provider_metric_type=metric.metric_type.value,
                    raw_payload=raw_payload,
                    source_bundle_id=metric.source_bundle_id,
                    source_device_name=metric.source_device_name,
                ),
                raw_payload_id=raw_record.id if raw_record else None,
            )
            sample = await self.get_sample(sample_id)
            if sample and sample.deleted_at is None:
                await self.projection_service.project_sample(user_id=user_id, provider="apple_health", sample=sample)
            stored.append((sample_id, "sample"))

        await self.update_connection_sync_state(connection_id=connection.id)
        return stored

    async def delete_records_by_external_ids(
        self,
        *,
        user_id: str,
        provider: str,
        external_ids: Iterable[str],
    ) -> Dict[str, int]:
        deleted_samples = 0
        deleted_events = 0
        async with get_db_session() as session:
            for external_id in external_ids:
                samples_result = await session.execute(
                    select(WearableSampleDB).where(
                        WearableSampleDB.user_id == user_id,
                        WearableSampleDB.provider == provider,
                        WearableSampleDB.external_id == external_id,
                        WearableSampleDB.deleted_at.is_(None),
                    )
                )
                for sample in samples_result.scalars().all():
                    sample.deleted_at = datetime.now(timezone.utc)
                    deleted_samples += 1

                events_result = await session.execute(
                    select(WearableEventDB).where(
                        WearableEventDB.user_id == user_id,
                        WearableEventDB.provider == provider,
                        WearableEventDB.external_id == external_id,
                        WearableEventDB.deleted_at.is_(None),
                    )
                )
                for event in events_result.scalars().all():
                    event.deleted_at = datetime.now(timezone.utc)
                    deleted_events += 1
            await session.commit()

        async with get_db_session() as session:
            samples_result = await session.execute(
                select(WearableSampleDB.id).where(
                    WearableSampleDB.user_id == user_id,
                    WearableSampleDB.provider == provider,
                    WearableSampleDB.external_id.in_(list(external_ids)),
                )
            )
            for sample_id in [row[0] for row in samples_result.fetchall()]:
                await self.projection_service.delete_projection("sample", sample_id)

            events_result = await session.execute(
                select(WearableEventDB.id).where(
                    WearableEventDB.user_id == user_id,
                    WearableEventDB.provider == provider,
                    WearableEventDB.external_id.in_(list(external_ids)),
                )
            )
            for event_id in [row[0] for row in events_result.fetchall()]:
                await self.projection_service.delete_projection("event", event_id)

        return {"samples": deleted_samples, "events": deleted_events}

    async def backfill_legacy_apple_metrics(self, user_id: str) -> Dict[str, int]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="apple_health",
            auth_method="sdk",
            status="active",
        )
        source = await self.upsert_source(
            user_id=user_id,
            provider="apple_health",
            connection_id=connection.id,
            source_kind="device",
            external_source_id="legacy-apple-health",
            device_name="Legacy Apple Health",
            platform="ios",
        )
        written = 0
        skipped = 0
        async with get_db_session() as session:
            result = await session.execute(
                select(WearableMetricDB).where(
                    WearableMetricDB.user_id == user_id,
                    WearableMetricDB.source == "apple_health",
                )
            )
            legacy_rows = result.scalars().all()

        for row in legacy_rows:
            canonical_type = self.normalization.canonicalize_metric_type("apple_health", row.metric_type)
            if row.metric_type in {"sleep_session", "workout"}:
                _, created = await self._upsert_event(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=source.id,
                    provider="apple_health",
                    event_type=canonical_type if row.metric_type != "workout" else "workout",
                    provider_event_type=row.metric_type,
                    external_id=row.external_id,
                    start_time=row.start_time,
                    end_time=row.end_time,
                    attributed_date=None,
                    timezone=row.timezone,
                    title=row.metric_type.replace("_", " ").title(),
                    summary_value=row.value,
                    summary_unit=row.unit,
                    details=json.loads(row.raw_payload) if row.raw_payload else None,
                    raw_payload_id=None,
                )
                written += 1 if created else 0
                skipped += 0 if created else 1
                continue

            _, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                provider="apple_health",
                metric_type=canonical_type,
                provider_metric_type=row.metric_type,
                external_id=row.external_id,
                recorded_at=row.recorded_at,
                start_time=row.start_time,
                end_time=row.end_time,
                attributed_date=None,
                value=row.value,
                unit=row.unit,
                aggregation_kind="interval" if row.start_time != row.end_time else "point",
                confidence=row.confidence,
                timezone=row.timezone,
                attributes_json=row.raw_payload,
                raw_payload_id=None,
            )
            written += 1 if created else 0
            skipped += 0 if created else 1
        return {"written": written, "skipped": skipped}

    async def ingest_whoop_data(
        self,
        *,
        user_id: str,
        provider_user_id: str,
        recovery_data: Optional[Dict[str, Any]],
        sleep_data: Optional[Dict[str, Any]],
        workout_data: Optional[Dict[str, Any]],
        cycle_data: Optional[Dict[str, Any]],
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[datetime] = None,
    ) -> Dict[str, int]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="whoop",
            auth_method="oauth",
            provider_user_id=provider_user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            status="active",
        )
        account_source = await self.upsert_source(
            user_id=user_id,
            provider="whoop",
            connection_id=connection.id,
            source_kind="account",
            external_source_id=provider_user_id,
            external_source_name="Whoop Account",
        )
        counts = {"samples": 0, "events": 0}

        if recovery_data and recovery_data.get("records"):
            for record in recovery_data["records"]:
                score = record.get("score") or {}
                created_count = await self._ingest_whoop_recovery_record(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=account_source.id,
                    record=record,
                    score=score,
                )
                counts["samples"] += created_count

        if sleep_data and sleep_data.get("records"):
            for record in sleep_data["records"]:
                created = await self._ingest_whoop_sleep_record(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=account_source.id,
                    record=record,
                )
                counts["events"] += created

        if workout_data and workout_data.get("records"):
            for record in workout_data["records"]:
                created = await self._ingest_whoop_workout_record(
                    user_id=user_id,
                    connection_id=connection.id,
                    source_id=account_source.id,
                    record=record,
                )
                counts["events"] += created

        await self.update_connection_sync_state(connection_id=connection.id)
        return counts

    async def ingest_oura_data(
        self,
        *,
        user_id: str,
        provider_user_id: str,
        personal_info: Optional[Dict[str, Any]],
        access_token: Optional[str],
        refresh_token: Optional[str],
        token_expires_at: Optional[datetime],
        daily_sleep_records: List[Dict[str, Any]],
        sleep_records: List[Dict[str, Any]],
        daily_readiness_records: List[Dict[str, Any]],
        daily_activity_records: List[Dict[str, Any]],
        workout_records: List[Dict[str, Any]],
        heartrate_records: List[Dict[str, Any]],
    ) -> Dict[str, int]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="oura",
            auth_method="oauth",
            provider_user_id=provider_user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            settings={"personal_info": personal_info or {}},
            status="active",
        )
        source = await self.upsert_source(
            user_id=user_id,
            provider="oura",
            connection_id=connection.id,
            source_kind="account",
            external_source_id=provider_user_id,
            external_source_name=(personal_info or {}).get("email") or "Oura Account",
            device_name=(personal_info or {}).get("device_model"),
        )

        counts = {"samples": 0, "events": 0}
        sleep_daily_by_day = {
            str(record.get("day")): record
            for record in daily_sleep_records
            if record.get("day")
        }

        for record in daily_activity_records:
            counts["samples"] += await self._ingest_oura_daily_activity_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        for record in daily_readiness_records:
            counts["samples"] += await self._ingest_oura_daily_readiness_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        for record in sleep_records:
            counts["events"] += await self._ingest_oura_sleep_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
                daily_sleep_record=sleep_daily_by_day.get(str(record.get("day"))),
            )

        for record in daily_sleep_records:
            counts["samples"] += await self._ingest_oura_daily_sleep_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        for record in workout_records:
            counts["events"] += await self._ingest_oura_workout_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        for record in heartrate_records:
            counts["samples"] += await self._ingest_oura_heartrate_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
            )

        await self.update_connection_sync_state(connection_id=connection.id)
        return counts

    async def ingest_garmin_payload(
        self,
        *,
        user_id: str,
        provider_user_id: str,
        payload: Dict[str, Any],
        access_token: Optional[str],
        refresh_token: Optional[str],
        token_expires_at: Optional[datetime],
    ) -> Dict[str, int]:
        connection = await self.connection_service.get_or_create_connection(
            user_id=user_id,
            provider="garmin",
            auth_method="oauth",
            provider_user_id=provider_user_id,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            status="active",
        )
        source = await self.upsert_source(
            user_id=user_id,
            provider="garmin",
            connection_id=connection.id,
            source_kind="account",
            external_source_id=provider_user_id,
            external_source_name="Garmin Account",
        )
        raw_payload = await self.store_raw_payload(
            user_id=user_id,
            provider="garmin",
            direction="webhook",
            payload=payload,
            connection_id=connection.id,
            external_id=provider_user_id,
        )

        counts = {"samples": 0, "events": 0}
        for record in self._extract_collection(payload, "dailySummaries", "summaries", "daily_summary", "daily_summaries"):
            sample_count, event_count = await self._ingest_garmin_daily_summary_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
                raw_payload_id=raw_payload.id,
            )
            counts["samples"] += sample_count
            counts["events"] += event_count

        for record in self._extract_collection(payload, "activities", "activityDetails", "activity_details"):
            counts["events"] += await self._ingest_garmin_activity_record(
                user_id=user_id,
                connection_id=connection.id,
                source_id=source.id,
                record=record,
                raw_payload_id=raw_payload.id,
            )

        await self.update_connection_sync_state(connection_id=connection.id)
        return counts

    async def _ingest_whoop_recovery_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
        score: Dict[str, Any],
    ) -> int:
        created_count = 0
        recorded_at = None
        created_at = record.get("created_at")
        if created_at:
            recorded_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        attributed_date = created_at[:10] if created_at else None
        for provider_metric_type, unit in (
            ("recovery_score", "count"),
            ("hrv_rmssd", "ms"),
            ("resting_heart_rate", "bpm"),
            ("spo2_percentage", "percent"),
            ("skin_temp_celsius", "count"),
        ):
            value = {
                "recovery_score": score.get("recovery_score"),
                "hrv_rmssd": score.get("hrv_rmssd_milli"),
                "resting_heart_rate": score.get("resting_heart_rate"),
                "spo2_percentage": score.get("spo2_percentage"),
                "skin_temp_celsius": score.get("skin_temp_celsius"),
            }.get(provider_metric_type)
            if value in (None, ""):
                continue
            metric_type = self.normalization.canonicalize_metric_type("whoop", provider_metric_type)
            external_id = f"{record.get('cycle_id', '')}:{provider_metric_type}"
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="whoop",
                metric_type=metric_type,
                provider_metric_type=provider_metric_type,
                external_id=external_id,
                recorded_at=recorded_at,
                start_time=recorded_at,
                end_time=recorded_at,
                attributed_date=attributed_date,
                value=float(value),
                unit=unit,
                aggregation_kind="point",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"cycle_id": record.get("cycle_id"), "raw_payload": record}),
                raw_payload_id=None,
            )
            sample = await self.get_sample(sample_id)
            if sample and sample.deleted_at is None:
                await self.projection_service.project_sample(user_id=user_id, provider="whoop", sample=sample)
            created_count += 1 if created else 0
        return created_count

    async def _ingest_whoop_sleep_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        start_raw = record.get("start")
        end_raw = record.get("end")
        if not start_raw or not end_raw:
            return 0
        start_time = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
        score = record.get("score") or {}
        stage_summary = score.get("stage_summary") or {}
        total_sleep_minutes = (
            stage_summary.get("total_rem_sleep_time_milli", 0)
            + stage_summary.get("total_slow_wave_sleep_time_milli", 0)
            + stage_summary.get("total_light_sleep_time_milli", 0)
        ) / 60000.0
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="whoop",
            event_type="sleep_total",
            provider_event_type="sleep_session",
            external_id=record.get("id"),
            start_time=start_time,
            end_time=end_time,
            attributed_date=end_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title="Whoop Sleep",
            summary_value=total_sleep_minutes,
            summary_unit="minutes",
            details={
                "sleep_efficiency": score.get("sleep_efficiency_percentage"),
                "sleep_performance": score.get("sleep_performance_percentage"),
                "cycle_id": record.get("cycle_id"),
                "stage_summary": stage_summary,
            },
            raw_payload_id=None,
        )
        event = await self.get_event(event_id)
        if event and event.deleted_at is None:
            await self.projection_service.project_event(user_id=user_id, provider="whoop", event=event)
        return 1 if created else 0

    async def _ingest_whoop_workout_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        start_raw = record.get("start")
        end_raw = record.get("end")
        if not start_raw or not end_raw:
            return 0
        start_time = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
        score = record.get("score") or {}
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="whoop",
            event_type="workout",
            provider_event_type=f"sport_{record.get('sport_id', 'unknown')}",
            external_id=record.get("id"),
            start_time=start_time,
            end_time=end_time,
            attributed_date=start_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title="Whoop Workout",
            summary_value=score.get("strain"),
            summary_unit="count",
            details={
                "distance_meter": score.get("distance_meter"),
                "kilojoule": score.get("kilojoule"),
                "average_heart_rate": score.get("average_heart_rate"),
                "max_heart_rate": score.get("max_heart_rate"),
            },
            raw_payload_id=None,
        )
        event = await self.get_event(event_id)
        if event and event.deleted_at is None:
            await self.projection_service.project_event(user_id=user_id, provider="whoop", event=event)
        return 1 if created else 0

    async def _ingest_oura_daily_activity_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        created_count = 0
        day = str(record.get("day") or record.get("summary_date") or "")
        if not day:
            return 0
        record_dt = datetime.fromisoformat(f"{day}T12:00:00+00:00")
        fields = [
            ("steps", record.get("steps"), "count"),
            ("active_energy", record.get("active_calories") or record.get("cal_active"), "kcal"),
            ("distance", record.get("equivalent_walking_distance"), "meters"),
            ("activity_score", record.get("score"), "count"),
        ]
        for provider_metric_type, value, unit in fields:
            if value in (None, ""):
                continue
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="oura",
                metric_type=self.normalization.canonicalize_metric_type("oura", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{record.get('id', day)}:{provider_metric_type}",
                recorded_at=record_dt,
                start_time=record_dt,
                end_time=record_dt,
                attributed_date=day,
                value=float(value),
                unit=unit,
                aggregation_kind="daily_aggregate",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=None,
            )
            sample = await self.get_sample(sample_id)
            if sample and sample.deleted_at is None:
                await self.projection_service.project_sample(user_id=user_id, provider="oura", sample=sample)
            created_count += 1 if created else 0
        return created_count

    async def _ingest_oura_daily_readiness_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        created_count = 0
        day = str(record.get("day") or record.get("summary_date") or "")
        if not day:
            return 0
        record_dt = datetime.fromisoformat(f"{day}T12:00:00+00:00")
        fields = [
            ("readiness_score", record.get("score"), "count"),
            ("temperature_deviation", record.get("temperature_deviation"), "celsius"),
        ]
        for provider_metric_type, value, unit in fields:
            if value in (None, ""):
                continue
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="oura",
                metric_type=self.normalization.canonicalize_metric_type("oura", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{record.get('id', day)}:{provider_metric_type}",
                recorded_at=record_dt,
                start_time=record_dt,
                end_time=record_dt,
                attributed_date=day,
                value=float(value),
                unit=unit,
                aggregation_kind="daily_aggregate",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=None,
            )
            sample = await self.get_sample(sample_id)
            if sample and sample.deleted_at is None:
                await self.projection_service.project_sample(user_id=user_id, provider="oura", sample=sample)
            created_count += 1 if created else 0
        return created_count

    async def _ingest_oura_daily_sleep_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        created_count = 0
        day = str(record.get("day") or "")
        if not day:
            return 0
        record_dt = datetime.fromisoformat(f"{day}T12:00:00+00:00")
        fields = [
            ("sleep_score", record.get("score"), "count"),
            ("sleep_deep", self._duration_to_minutes(record.get("deep_sleep_duration")), "minutes"),
            ("sleep_rem", self._duration_to_minutes(record.get("rem_sleep_duration")), "minutes"),
            ("sleep_light", self._duration_to_minutes(record.get("light_sleep_duration")), "minutes"),
        ]
        for provider_metric_type, value, unit in fields:
            if value in (None, ""):
                continue
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="oura",
                metric_type=self.normalization.canonicalize_metric_type("oura", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{record.get('id', day)}:{provider_metric_type}",
                recorded_at=record_dt,
                start_time=record_dt,
                end_time=record_dt,
                attributed_date=day,
                value=float(value),
                unit=unit,
                aggregation_kind="daily_aggregate",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=None,
            )
            sample = await self.get_sample(sample_id)
            if sample and sample.deleted_at is None:
                await self.projection_service.project_sample(user_id=user_id, provider="oura", sample=sample)
            created_count += 1 if created else 0
        return created_count

    async def _ingest_oura_sleep_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
        daily_sleep_record: Optional[Dict[str, Any]],
    ) -> int:
        start_raw = record.get("bedtime_start") or record.get("start_datetime") or record.get("start_time")
        end_raw = record.get("bedtime_end") or record.get("end_datetime") or record.get("end_time")
        day = str(record.get("day") or record.get("summary_date") or "")
        if not start_raw or not end_raw:
            return 0
        start_time = self._parse_dt(start_raw)
        end_time = self._parse_dt(end_raw)
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="oura",
            event_type="sleep_total",
            provider_event_type="sleep_session",
            external_id=str(record.get("id") or f"{day}:{start_raw}"),
            start_time=start_time,
            end_time=end_time,
            attributed_date=day or end_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title="Oura Sleep",
            summary_value=self._duration_to_minutes(record.get("total_sleep_duration")),
            summary_unit="minutes",
            details={
                "average_hrv": record.get("average_hrv"),
                "average_heart_rate": record.get("average_heart_rate"),
                "lowest_heart_rate": record.get("lowest_heart_rate"),
                "daily_sleep": daily_sleep_record,
                "raw_payload": record,
            },
            raw_payload_id=None,
        )
        event = await self.get_event(event_id)
        if event and event.deleted_at is None:
            await self.projection_service.project_event(user_id=user_id, provider="oura", event=event)

        sample_fields = [
            ("average_hrv", record.get("average_hrv"), "ms"),
            ("lowest_heart_rate", record.get("lowest_heart_rate"), "bpm"),
        ]
        for provider_metric_type, value, unit in sample_fields:
            if value in (None, ""):
                continue
            sample_id, _ = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="oura",
                metric_type=self.normalization.canonicalize_metric_type("oura", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{record.get('id', day)}:{provider_metric_type}",
                recorded_at=end_time,
                start_time=end_time,
                end_time=end_time,
                attributed_date=day or end_time.strftime("%Y-%m-%d"),
                value=float(value),
                unit=unit,
                aggregation_kind="point",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=None,
            )
            sample = await self.get_sample(sample_id)
            if sample and sample.deleted_at is None:
                await self.projection_service.project_sample(user_id=user_id, provider="oura", sample=sample)
        return 1 if created else 0

    async def _ingest_oura_workout_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        start_raw = record.get("start_datetime") or record.get("start_time")
        end_raw = record.get("end_datetime") or record.get("end_time")
        if not start_raw or not end_raw:
            return 0
        start_time = self._parse_dt(start_raw)
        end_time = self._parse_dt(end_raw)
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="oura",
            event_type="workout",
            provider_event_type=str(record.get("sport_name") or record.get("type") or "workout"),
            external_id=str(record.get("id") or f"workout:{start_raw}"),
            start_time=start_time,
            end_time=end_time,
            attributed_date=start_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title=str(record.get("sport_name") or "Oura Workout"),
            summary_value=float(record.get("calories") or 0) if record.get("calories") is not None else None,
            summary_unit="kcal" if record.get("calories") is not None else None,
            details=record,
            raw_payload_id=None,
        )
        event = await self.get_event(event_id)
        if event and event.deleted_at is None:
            await self.projection_service.project_event(user_id=user_id, provider="oura", event=event)
        return 1 if created else 0

    async def _ingest_oura_heartrate_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
    ) -> int:
        bpm = record.get("bpm") or record.get("heart_rate")
        timestamp = record.get("timestamp") or record.get("datetime")
        if bpm in (None, "") or not timestamp:
            return 0
        recorded_at = self._parse_dt(timestamp)
        sample_id, created = await self._upsert_sample(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="oura",
            metric_type="heart_rate",
            provider_metric_type="heartrate",
            external_id=str(record.get("id") or f"heartrate:{timestamp}"),
            recorded_at=recorded_at,
            start_time=recorded_at,
            end_time=recorded_at,
            attributed_date=recorded_at.strftime("%Y-%m-%d"),
            value=float(bpm),
            unit="bpm",
            aggregation_kind="point",
            confidence=None,
            timezone="UTC",
            attributes_json=json.dumps({"raw_payload": record}),
            raw_payload_id=None,
        )
        sample = await self.get_sample(sample_id)
        if sample and sample.deleted_at is None:
            await self.projection_service.project_sample(user_id=user_id, provider="oura", sample=sample)
        return 1 if created else 0

    async def _ingest_garmin_daily_summary_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
        raw_payload_id: Optional[str],
    ) -> Tuple[int, int]:
        sample_count = 0
        event_count = 0
        date_value = self._extract_date_value(record)
        if not date_value:
            return (0, 0)
        record_dt = datetime.fromisoformat(f"{date_value}T12:00:00+00:00")
        field_map = [
            ("steps", self._get_first(record, "steps"), "count"),
            ("distance", self._get_first(record, "distanceInMeters", "distance", "totalDistanceMeters"), "meters"),
            ("active_energy", self._get_first(record, "activeKilocalories", "activeCalories", "calories", "active_energy"), "kcal"),
            ("resting_heart_rate", self._get_first(record, "restingHeartRateInBeatsPerMinute", "restingHeartRate", "resting_heart_rate"), "bpm"),
            ("stress", self._get_first(record, "averageStressLevel", "stressLevel", "stress"), "count"),
            ("body_battery", self._get_first(record, "bodyBatteryMostRecentValue", "bodyBattery", "bodyBatteryHighestValue"), "count"),
        ]
        base_external_id = str(self._get_first(record, "summaryId", "calendarDate", "wellnessStartTimeGmt", "startTimeInSeconds", default=date_value))
        for provider_metric_type, value, unit in field_map:
            if value in (None, ""):
                continue
            sample_id, created = await self._upsert_sample(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="garmin",
                metric_type=self.normalization.canonicalize_metric_type("garmin", provider_metric_type),
                provider_metric_type=provider_metric_type,
                external_id=f"{base_external_id}:{provider_metric_type}",
                recorded_at=record_dt,
                start_time=record_dt,
                end_time=record_dt,
                attributed_date=date_value,
                value=float(value),
                unit=unit,
                aggregation_kind="daily_aggregate",
                confidence=None,
                timezone="UTC",
                attributes_json=json.dumps({"raw_payload": record}),
                raw_payload_id=raw_payload_id,
            )
            sample = await self.get_sample(sample_id)
            if sample and sample.deleted_at is None:
                await self.projection_service.project_sample(user_id=user_id, provider="garmin", sample=sample)
            sample_count += 1 if created else 0

        sleep_start = self._get_first(record, "sleepStartTimestampGMT", "sleepStartTimeGmt", "sleepStart")
        sleep_end = self._get_first(record, "sleepEndTimestampGMT", "sleepEndTimeGmt", "sleepEnd")
        if sleep_start and sleep_end:
            start_time = self._parse_dt(sleep_start)
            end_time = self._parse_dt(sleep_end)
            event_id, created = await self._upsert_event(
                user_id=user_id,
                connection_id=connection_id,
                source_id=source_id,
                provider="garmin",
                event_type="sleep_total",
                provider_event_type="sleep_session",
                external_id=f"{base_external_id}:sleep",
                start_time=start_time,
                end_time=end_time,
                attributed_date=date_value,
                timezone="UTC",
                title="Garmin Sleep",
                summary_value=(end_time - start_time).total_seconds() / 60.0,
                summary_unit="minutes",
                details=record,
                raw_payload_id=raw_payload_id,
            )
            event = await self.get_event(event_id)
            if event and event.deleted_at is None:
                await self.projection_service.project_event(user_id=user_id, provider="garmin", event=event)
            event_count += 1 if created else 0
        return (sample_count, event_count)

    async def _ingest_garmin_activity_record(
        self,
        *,
        user_id: str,
        connection_id: str,
        source_id: str,
        record: Dict[str, Any],
        raw_payload_id: Optional[str],
    ) -> int:
        start_raw = self._get_first(record, "activityStartTimeGMT", "startTimeGMT", "startTimeLocal", "startTime")
        end_raw = self._get_first(record, "activityEndTimeGMT", "endTimeGMT", "endTimeLocal", "endTime")
        if not start_raw or not end_raw:
            return 0
        start_time = self._parse_dt(start_raw)
        end_time = self._parse_dt(end_raw)
        external_id = str(self._get_first(record, "activityId", "summaryId", "activityUUID", default=f"activity:{start_raw}"))
        event_id, created = await self._upsert_event(
            user_id=user_id,
            connection_id=connection_id,
            source_id=source_id,
            provider="garmin",
            event_type="workout",
            provider_event_type=str(self._get_first(record, "activityType", "activityName", default="garmin_activity")),
            external_id=external_id,
            start_time=start_time,
            end_time=end_time,
            attributed_date=start_time.strftime("%Y-%m-%d"),
            timezone="UTC",
            title=str(self._get_first(record, "activityName", "activityType", default="Garmin Activity")),
            summary_value=float(self._get_first(record, "activeKilocalories", "calories", default=0) or 0),
            summary_unit="kcal",
            details=record,
            raw_payload_id=raw_payload_id,
        )
        event = await self.get_event(event_id)
        if event and event.deleted_at is None:
            await self.projection_service.project_event(user_id=user_id, provider="garmin", event=event)
        return 1 if created else 0

    @staticmethod
    def _duration_to_minutes(value: Any) -> Optional[float]:
        if value in (None, ""):
            return None
        try:
            numeric = float(value)
        except Exception:
            return None
        if numeric > 100000:
            return numeric / 60000.0
        if numeric > 1000:
            return numeric / 60.0
        return numeric

    @staticmethod
    def _parse_dt(value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        text = str(value)
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        return datetime.fromisoformat(text)

    @staticmethod
    def _extract_collection(payload: Dict[str, Any], *keys: str) -> List[Dict[str, Any]]:
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict) and isinstance(value.get("records"), list):
                return [item for item in value["records"] if isinstance(item, dict)]
        return []

    @staticmethod
    def _extract_date_value(record: Dict[str, Any]) -> Optional[str]:
        for key in ("calendarDate", "day", "summary_date", "date"):
            value = record.get(key)
            if value:
                return str(value)[:10]
        for key in ("wellnessStartTimeGmt", "timestamp", "startTimeGMT"):
            value = record.get(key)
            if value:
                return str(value)[:10]
        return None

    @staticmethod
    def _get_first(record: Dict[str, Any], *keys: str, default: Any = None) -> Any:
        for key in keys:
            if key in record and record.get(key) not in (None, ""):
                return record.get(key)
        return default

    async def _upsert_sample(self, **kwargs: Any) -> Tuple[str, bool]:
        async with get_db_session() as session:
            existing = None
            external_id = kwargs.get("external_id")
            if external_id:
                result = await session.execute(
                    select(WearableSampleDB).where(
                        WearableSampleDB.user_id == kwargs["user_id"],
                        WearableSampleDB.provider == kwargs["provider"],
                        WearableSampleDB.external_id == external_id,
                    )
                )
                existing = result.scalar_one_or_none()

            created = existing is None
            sample = existing or WearableSampleDB(
                id=str(uuid.uuid4()),
                user_id=kwargs["user_id"],
                provider=kwargs["provider"],
                created_at=datetime.now(timezone.utc),
            )
            if created:
                session.add(sample)

            for key, value in kwargs.items():
                setattr(sample, key, value)
            sample.updated_at = datetime.now(timezone.utc)
            sample.deleted_at = None
            await session.commit()
            await session.refresh(sample)
            return sample.id, created

    async def _upsert_event(self, **kwargs: Any) -> Tuple[str, bool]:
        async with get_db_session() as session:
            existing = None
            external_id = kwargs.get("external_id")
            if external_id:
                result = await session.execute(
                    select(WearableEventDB).where(
                        WearableEventDB.user_id == kwargs["user_id"],
                        WearableEventDB.provider == kwargs["provider"],
                        WearableEventDB.external_id == external_id,
                    )
                )
                existing = result.scalar_one_or_none()

            created = existing is None
            event = existing or WearableEventDB(
                id=str(uuid.uuid4()),
                user_id=kwargs["user_id"],
                provider=kwargs["provider"],
                created_at=datetime.now(timezone.utc),
            )
            if created:
                session.add(event)

            details = kwargs.pop("details", None)
            if details is not None:
                kwargs["details_json"] = json.dumps(details)
            for key, value in kwargs.items():
                setattr(event, key, value)
            event.updated_at = datetime.now(timezone.utc)
            event.deleted_at = None
            await session.commit()
            await session.refresh(event)
            return event.id, created

    async def get_sample(self, sample_id: str) -> Optional[WearableSampleDB]:
        async with get_db_session() as session:
            result = await session.execute(select(WearableSampleDB).where(WearableSampleDB.id == sample_id))
            return result.scalar_one_or_none()

    async def get_event(self, event_id: str) -> Optional[WearableEventDB]:
        async with get_db_session() as session:
            result = await session.execute(select(WearableEventDB).where(WearableEventDB.id == event_id))
            return result.scalar_one_or_none()


normalization_service = WearableNormalizationService()
wearable_connection_service = WearableConnectionService()
wearable_projection_service = WearableProjectionService(normalization_service)
wearable_query_service = WearableQueryService()
wearable_sync_service = WearableSyncService(
    wearable_connection_service,
    normalization_service,
    wearable_projection_service,
)
