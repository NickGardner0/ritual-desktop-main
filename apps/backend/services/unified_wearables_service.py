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
    HabitProjectionPolicyDB,
    WearableConnectionDB,
    WearableDeviceDB,
    WearableEventDB,
    WearableIngestJobBatchDB,
    WearableIngestJobDB,
    WearableMetricDB,
    WearableRawPayloadDB,
    WearableSampleDB,
    WearableSourceDB,
    WearableSyncCursorDB,
    WearableSyncRunDB,
)
from services.token_crypto import token_crypto

logger = logging.getLogger(__name__)

WEARABLE_DAILY_TOTALS_OBJECT_LOAD_MAX_DAYS = max(
    1,
    int(os.getenv("WEARABLE_DAILY_TOTALS_OBJECT_LOAD_MAX_DAYS", "120") or "120"),
)


@dataclass(frozen=True)
class ProviderCapabilityDef:
    provider: str
    display_name: str
    auth_method: str
    delivery_modes: Tuple[str, ...] = ("rest_pull",)
    supports_webhook: bool = False
    supports_import_fallback: bool = False
    supports_metric_selection: bool = True
    supports_backfill: bool = True
    supports_async_backfill: bool = False
    supports_live_sync_mode_selection: bool = False
    max_historical_days: Optional[int] = None
    default_live_sync_mode: str = "daily_only"
    supports_anchor_confirmed_ingest: bool = False
    is_available: bool = True


PROVIDER_CAPABILITIES: Dict[str, ProviderCapabilityDef] = {
    "apple_health": ProviderCapabilityDef(
        provider="apple_health",
        display_name="Apple Health",
        auth_method="sdk",
        delivery_modes=("client_sdk",),
        supports_import_fallback=True,
        supports_async_backfill=False,
        supports_live_sync_mode_selection=True,
        max_historical_days=730,
        default_live_sync_mode="daily_only",
        supports_anchor_confirmed_ingest=True,
    ),
    "whoop": ProviderCapabilityDef(
        provider="whoop",
        display_name="Whoop",
        auth_method="oauth",
        delivery_modes=("rest_pull",),
        supports_async_backfill=True,
        max_historical_days=365,
    ),
    "garmin": ProviderCapabilityDef(
        provider="garmin",
        display_name="Garmin",
        auth_method="oauth",
        delivery_modes=("webhook_stream", "rest_pull"),
        supports_webhook=True,
        supports_import_fallback=True,
        supports_async_backfill=True,
        max_historical_days=365,
    ),
    "oura": ProviderCapabilityDef(
        provider="oura",
        display_name="Oura",
        auth_method="oauth",
        delivery_modes=("rest_pull",),
        supports_import_fallback=True,
        supports_async_backfill=True,
        max_historical_days=365,
    ),
    "fitbit": ProviderCapabilityDef(
        provider="fitbit",
        display_name="Fitbit",
        auth_method="oauth",
        delivery_modes=("rest_pull",),
        supports_async_backfill=True,
        max_historical_days=365,
        is_available=False,
    ),
}

RAW_PAYLOAD_TTL_DAYS = int(os.getenv("WEARABLE_RAW_PAYLOAD_TTL_DAYS", "14") or "14")
RAW_RETENTION_DAYS = int(os.getenv("WEARABLE_RAW_SAMPLE_RETENTION_DAYS", "30") or "30")
BUCKET_15M_RETENTION_DAYS = int(os.getenv("WEARABLE_BUCKET_15M_RETENTION_DAYS", "180") or "180")
BUCKET_1H_RETENTION_DAYS = int(os.getenv("WEARABLE_BUCKET_1H_RETENTION_DAYS", "730") or "730")

SOURCE_KIND_PRIORITY_RANKS: Dict[str, int] = {
    "watch": 10,
    "ring": 20,
    "chest_strap": 30,
    "patch": 40,
    "phone": 50,
    "import": 60,
    "account": 70,
    "device": 80,
    "unknown": 100,
}

PROVIDER_PRIORITY_RANKS: Dict[str, int] = {
    "whoop": 10,
    "oura": 20,
    "garmin": 30,
    "apple_health": 40,
    "fitbit": 50,
    "manual": 60,
}

STEPS_LIKE_METRICS = {
    "steps",
    "distance",
    "active_energy",
    "basal_energy",
    "exercise_time",
    "stand_time",
    "flights_climbed",
}
HEART_LIKE_METRICS = {
    "heart_rate",
    "hrv",
    "resting_heart_rate",
    "walking_heart_rate",
    "respiratory_rate",
    "oxygen_saturation",
}
EVENT_LIKE_METRICS = {
    "sleep_total",
    "sleep_light",
    "sleep_rem",
    "sleep_deep",
    "workout",
    "mindful_minutes",
}
RECOVERY_SIGNAL_METRICS = {"recovery_score", "readiness_score", "body_battery", "strain_score"}
INTERNAL_WEARABLE_SIGNAL_MAX_AGE_DAYS = int(
    os.getenv("INTERNAL_WEARABLE_SIGNAL_MAX_AGE_DAYS", "3") or "3"
)

APPLE_METRIC_TYPE_ALIASES: Dict[str, str] = {
    "hr": "heart_rate",
    "resting_hr": "resting_heart_rate",
    "walking_hr": "walking_heart_rate",
}


def default_sync_mode_for_provider_metric(provider: str, metric_type: str) -> str:
    definition = PROVIDER_CAPABILITIES.get(provider)
    fallback = definition.default_live_sync_mode if definition else "daily_only"
    normalized_metric_type = (metric_type or "").strip().lower()

    if provider != "apple_health" or not normalized_metric_type:
        return fallback

    canonical_metric_type = APPLE_METRIC_TYPE_ALIASES.get(
        normalized_metric_type,
        normalized_metric_type,
    )
    if canonical_metric_type in STEPS_LIKE_METRICS or canonical_metric_type in HEART_LIKE_METRICS:
        return "granular"
    return fallback


def _infer_delivery_mode(provider: str) -> str:
    definition = PROVIDER_CAPABILITIES.get(provider)
    if not definition:
        return "rest_pull"
    return definition.delivery_modes[0] if definition.delivery_modes else "rest_pull"


def _infer_backfill_mode(provider: str, *, sync_mode: str) -> str:
    if provider == "apple_health":
        return "manual_queue" if sync_mode != "off" else "none"
    definition = PROVIDER_CAPABILITIES.get(provider)
    if definition and definition.supports_async_backfill:
        return "queued"
    if definition and definition.supports_backfill:
        return "sync"
    return "none"


def _safe_history_days(provider: str, metric_type: str, sync_mode: str) -> int:
    if sync_mode == "off":
        return 0
    if provider == "apple_health":
        if sync_mode == "daily_only":
            return 730
        if metric_type in STEPS_LIKE_METRICS:
            return 30
        if metric_type in HEART_LIKE_METRICS:
            return 30
        if metric_type in EVENT_LIKE_METRICS:
            return 365
        return 30
    definition = PROVIDER_CAPABILITIES.get(provider)
    return int(definition.max_historical_days or 365) if definition else 365


def _default_source_priority_rank(
    *,
    source_kind: str,
    device_type: Optional[str] = None,
    device_name: Optional[str] = None,
    platform: Optional[str] = None,
) -> int:
    normalized_device_type = (device_type or "").strip().lower()
    normalized_name = (device_name or "").strip().lower()
    normalized_platform = (platform or "").strip().lower()
    normalized_source_kind = (source_kind or "").strip().lower()

    if "watch" in normalized_device_type or "watch" in normalized_name:
        return SOURCE_KIND_PRIORITY_RANKS["watch"]
    if "ring" in normalized_device_type or "ring" in normalized_name:
        return SOURCE_KIND_PRIORITY_RANKS["ring"]
    if "chest" in normalized_device_type or "strap" in normalized_device_type:
        return SOURCE_KIND_PRIORITY_RANKS["chest_strap"]
    if "patch" in normalized_device_type:
        return SOURCE_KIND_PRIORITY_RANKS["patch"]
    if "phone" in normalized_device_type or "iphone" in normalized_name or normalized_platform in {"ios", "android"}:
        return SOURCE_KIND_PRIORITY_RANKS["phone"]
    if normalized_source_kind == "import":
        return SOURCE_KIND_PRIORITY_RANKS["import"]
    if normalized_source_kind == "account":
        return SOURCE_KIND_PRIORITY_RANKS["account"]
    if normalized_source_kind == "device":
        return SOURCE_KIND_PRIORITY_RANKS["device"]
    return SOURCE_KIND_PRIORITY_RANKS["unknown"]


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


def build_wearable_sync_plan(
    *,
    provider: str,
    metric_type: str,
    sync_mode: str,
    projects_to_habit_logs: bool,
) -> Dict[str, Any]:
    definition = PROVIDER_CAPABILITIES.get(provider)
    return {
        "provider": provider,
        "metric_type": metric_type,
        "sync_mode": sync_mode,
        "delivery_mode": _infer_delivery_mode(provider),
        "backfill_mode": _infer_backfill_mode(provider, sync_mode=sync_mode),
        "safe_history_days": _safe_history_days(provider, metric_type, sync_mode),
        "projects_to_habit_logs": projects_to_habit_logs,
        "capability_provider": definition.provider if definition else provider,
    }


def _parse_json_blob(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _within_internal_signal_window(reference_time: Optional[datetime]) -> bool:
    if reference_time is None:
        return False
    now = datetime.now(timezone.utc)
    if reference_time.tzinfo is None:
        reference_time = reference_time.replace(tzinfo=timezone.utc)
    return reference_time >= now - timedelta(days=INTERNAL_WEARABLE_SIGNAL_MAX_AGE_DAYS)


def build_wearable_outbox_event_for_sample(sample: Any) -> Optional[Dict[str, Any]]:
    if getattr(sample, "deleted_at", None) is not None:
        return None

    reference_time = getattr(sample, "end_time", None) or getattr(sample, "recorded_at", None) or getattr(sample, "start_time", None)
    if not _within_internal_signal_window(reference_time):
        return None

    attributes = _parse_json_blob(getattr(sample, "attributes_json", None))
    if getattr(sample, "metric_type", None) in RECOVERY_SIGNAL_METRICS:
        return {
            "event_type": "recovery_metric_changed",
            "payload": {
                "sample_id": sample.id,
                "provider": sample.provider,
                "metric_type": sample.metric_type,
                "value": sample.value,
                "unit": sample.unit,
                "recorded_at": reference_time.isoformat() if reference_time else None,
                "attributed_date": getattr(sample, "attributed_date", None),
                "source_device_name": attributes.get("source_device_name"),
            },
        }

    if getattr(sample, "metric_type", None) == "steps" and getattr(sample, "rollup_level", None) == "bucket_15m":
        return {
            "event_type": "steps_bucket_closed",
            "payload": {
                "sample_id": sample.id,
                "provider": sample.provider,
                "metric_type": sample.metric_type,
                "value": sample.value,
                "unit": sample.unit,
                "start_time": sample.start_time.isoformat() if sample.start_time else None,
                "end_time": sample.end_time.isoformat() if sample.end_time else None,
                "rollup_level": getattr(sample, "rollup_level", None),
                "attributed_date": getattr(sample, "attributed_date", None),
                "source_device_name": attributes.get("source_device_name"),
            },
        }

    return None


def build_wearable_outbox_event_for_event(event: Any) -> Optional[Dict[str, Any]]:
    if getattr(event, "deleted_at", None) is not None:
        return None

    reference_time = getattr(event, "end_time", None) or getattr(event, "start_time", None)
    if not _within_internal_signal_window(reference_time):
        return None

    if getattr(event, "event_type", None) != "sleep_total":
        return None

    details = _parse_json_blob(getattr(event, "details_json", None))
    return {
        "event_type": "sleep_session_ingested",
        "payload": {
            "event_id": event.id,
            "provider": event.provider,
            "event_type": event.event_type,
            "start_time": event.start_time.isoformat() if event.start_time else None,
            "end_time": event.end_time.isoformat() if event.end_time else None,
            "duration_minutes": getattr(event, "summary_value", None),
            "summary_unit": getattr(event, "summary_unit", None),
            "attributed_date": getattr(event, "attributed_date", None),
            "source_device_name": details.get("source_device_name"),
        },
    }


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
            provider_capabilities = {
                item["provider"]: item for item in await self.list_provider_capabilities()
            }

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

                explicit_preferences = settings.get("metric_preferences_v2", {})
                explicit_metrics = {
                    metric_type: preference
                    for metric_type, preference in explicit_preferences.items()
                    if isinstance(metric_type, str) and isinstance(preference, dict)
                }
                tracked_metrics = sorted(
                    set(tracked_by_provider.get(connection.provider, []))
                    | {
                        metric_type
                        for metric_type, preference in explicit_metrics.items()
                        if str(preference.get("sync_mode", "")).strip().lower() in {"daily_only", "granular"}
                    }
                )
                sync_plans = []
                for metric_type in tracked_metrics:
                    sync_mode = default_sync_mode_for_provider_metric(connection.provider, metric_type)
                    if metric_type in explicit_metrics:
                        sync_mode = (
                            str(
                                explicit_metrics[metric_type].get(
                                    "sync_mode",
                                    default_sync_mode_for_provider_metric(connection.provider, metric_type),
                                )
                            )
                            .strip()
                            .lower()
                            or default_sync_mode_for_provider_metric(connection.provider, metric_type)
                        )
                    sync_plans.append(
                        build_wearable_sync_plan(
                            provider=connection.provider,
                            metric_type=metric_type,
                            sync_mode=sync_mode,
                            projects_to_habit_logs=metric_type in set(tracked_by_provider.get(connection.provider, [])),
                        )
                    )
                capability = provider_capabilities.get(connection.provider)

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
                        "tracked_metrics": tracked_metrics,
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
                        "capability": capability,
                        "sync_plans": sync_plans,
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
                    "delivery_modes": list(definition.delivery_modes),
                    "supports_webhook": definition.supports_webhook,
                    "supports_import_fallback": definition.supports_import_fallback,
                    "supports_metric_selection": definition.supports_metric_selection,
                    "supports_backfill": definition.supports_backfill,
                    "supports_async_backfill": definition.supports_async_backfill,
                    "supports_live_sync_mode_selection": definition.supports_live_sync_mode_selection,
                    "max_historical_days": definition.max_historical_days,
                    "default_live_sync_mode": definition.default_live_sync_mode,
                    "supports_anchor_confirmed_ingest": definition.supports_anchor_confirmed_ingest,
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
        if normalized_metric == "workout":
            return "workout" in habit_name or "exercise" in habit_name
        if normalized_metric in {"heart_rate", "hr"}:
            return "heart rate" in habit_name
        if normalized_metric == "steps":
            return "step" in habit_name or "walk" in habit_name
        return False

    def _canonical_metric_type(self, metric_type: Optional[str]) -> Optional[str]:
        normalized_metric = (metric_type or "").strip().lower()
        if not normalized_metric:
            return None
        for canonical_metric, aliases in self.LEGACY_METRIC_EQUIVALENTS.items():
            if normalized_metric == canonical_metric or normalized_metric in aliases:
                return canonical_metric
        return normalized_metric

    def _default_canonical_metric_type_for_habit(self, habit: HabitDB) -> Optional[str]:
        habit_metric = self._canonical_metric_type(getattr(habit, "metric_type", None))
        if habit_metric:
            return habit_metric

        habit_name = (habit.name or "").strip().lower()
        if "sleep" in habit_name:
            return "sleep_total"
        if "workout" in habit_name or "exercise" in habit_name:
            return "workout"
        if "heart rate" in habit_name:
            return "heart_rate"
        if "step" in habit_name or "walk" in habit_name:
            return "steps"
        return None

    def _normalize_projection_source_priority(
        self,
        values: Optional[Iterable[str]],
        *,
        default: Optional[Iterable[str]] = None,
    ) -> List[str]:
        normalized: List[str] = []
        for value in values or []:
            item = str(value or "").strip().lower()
            if item and item not in normalized:
                normalized.append(item)
        if normalized:
            return normalized
        return [
            item
            for item in (str(entry or "").strip().lower() for entry in (default or []))
            if item
        ]

    def _default_projection_source_priority_for_habit(self, habit: HabitDB) -> List[str]:
        canonical_metric_type = self._default_canonical_metric_type_for_habit(habit)
        integration_source = (getattr(habit, "integration_source", None) or "manual").strip().lower()

        if canonical_metric_type == "sleep_total" and integration_source == "whoop":
            return ["whoop", "apple_health"]
        if canonical_metric_type == "workout" and integration_source == "manual":
            return ["manual"]
        if integration_source:
            return [integration_source]
        return ["manual"]

    def _decode_projection_source_priority(
        self,
        projection_source_priority_json: Optional[str],
    ) -> List[str]:
        if not projection_source_priority_json:
            return []
        try:
            raw_value = json.loads(projection_source_priority_json)
        except Exception:
            return []
        if not isinstance(raw_value, list):
            return []
        return [value for value in raw_value if isinstance(value, str)]

    def _serialize_projection_policy(
        self,
        habit: HabitDB,
        policy: Optional[HabitProjectionPolicyDB] = None,
    ) -> Dict[str, Any]:
        default_canonical_metric_type = self._default_canonical_metric_type_for_habit(habit)
        default_priority = self._default_projection_source_priority_for_habit(habit)
        projection_source_priority = self._normalize_projection_source_priority(
            self._decode_projection_source_priority(
                policy.projection_source_priority_json if policy else None
            ),
            default=default_priority,
        )
        return {
            "habit_id": habit.id,
            "canonical_metric_type": (
                (policy.canonical_metric_type if policy else None) or default_canonical_metric_type
            ),
            "projection_source_priority": projection_source_priority,
        }

    async def _get_or_create_projection_policy(
        self,
        session: Any,
        *,
        habit: HabitDB,
    ) -> HabitProjectionPolicyDB:
        result = await session.execute(
            select(HabitProjectionPolicyDB).where(HabitProjectionPolicyDB.habit_id == habit.id)
        )
        policy = result.scalar_one_or_none()
        default_canonical_metric_type = self._default_canonical_metric_type_for_habit(habit)
        default_priority = self._default_projection_source_priority_for_habit(habit)

        if policy is None:
            policy = HabitProjectionPolicyDB(
                id=str(uuid.uuid4()),
                user_id=habit.user_id,
                habit_id=habit.id,
                canonical_metric_type=default_canonical_metric_type,
                projection_source_priority_json=json.dumps(default_priority),
            )
            session.add(policy)
            await session.flush()
            return policy

        updated = False
        if not policy.canonical_metric_type and default_canonical_metric_type:
            policy.canonical_metric_type = default_canonical_metric_type
            updated = True

        normalized_priority = self._normalize_projection_source_priority(
            self._decode_projection_source_priority(policy.projection_source_priority_json),
            default=default_priority,
        )
        normalized_priority_json = json.dumps(normalized_priority)
        if policy.projection_source_priority_json != normalized_priority_json:
            policy.projection_source_priority_json = normalized_priority_json
            updated = True

        if updated:
            await session.flush()
        return policy

    async def get_projection_policy(
        self,
        *,
        user_id: str,
        habit_id: str,
    ) -> Optional[Dict[str, Any]]:
        async with get_db_session() as session:
            habit = await session.get(HabitDB, habit_id)
            if habit is None or habit.user_id != user_id:
                return None
            policy = await self._get_or_create_projection_policy(session, habit=habit)
            await session.commit()
            return self._serialize_projection_policy(habit, policy)

    async def update_projection_policy(
        self,
        *,
        user_id: str,
        habit_id: str,
        projection_source_priority: Optional[Iterable[str]],
        canonical_metric_type: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        async with get_db_session() as session:
            habit = await session.get(HabitDB, habit_id)
            if habit is None or habit.user_id != user_id:
                return None

            policy = await self._get_or_create_projection_policy(session, habit=habit)
            default_priority = self._default_projection_source_priority_for_habit(habit)
            normalized_priority = self._normalize_projection_source_priority(
                projection_source_priority,
                default=default_priority,
            )
            policy.projection_source_priority_json = json.dumps(normalized_priority)
            policy.canonical_metric_type = (
                self._canonical_metric_type(canonical_metric_type)
                or policy.canonical_metric_type
                or self._default_canonical_metric_type_for_habit(habit)
            )
            await session.commit()
            await session.refresh(policy)
            return self._serialize_projection_policy(habit, policy)

    async def _habit_accepts_projection(
        self,
        session: Any,
        *,
        habit: HabitDB,
        provider: str,
        metric_type: str,
    ) -> bool:
        if not self._habit_matches_metric_type(habit, metric_type):
            return False

        policy = await self._get_or_create_projection_policy(session, habit=habit)
        serialized_policy = self._serialize_projection_policy(habit, policy)
        canonical_metric_type = self._canonical_metric_type(metric_type)
        if (
            serialized_policy["canonical_metric_type"]
            and canonical_metric_type
            and serialized_policy["canonical_metric_type"] != canonical_metric_type
        ):
            return False

        projection_source_priority = serialized_policy["projection_source_priority"]
        return bool(projection_source_priority) and provider.strip().lower() == projection_source_priority[0]

    async def project_sample(
        self,
        *,
        user_id: str,
        provider: str,
        sample: WearableSampleDB,
    ) -> None:
        if sample.should_project_to_habit_logs in {False, 0}:
            return
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
                select(HabitDB).where(HabitDB.user_id == user_id)
            )
            habits: List[HabitDB] = []
            for habit in habits_result.scalars().all():
                if await self._habit_accepts_projection(
                    session,
                    habit=habit,
                    provider=provider,
                    metric_type=metric_type,
                ):
                    habits.append(habit)
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
    CUMULATIVE_METRICS = {
        "steps",
        "active_energy",
        "basal_energy",
        "distance",
        "flights_climbed",
        "exercise_time",
        "stand_time",
        "dietary_energy",
        "dietary_protein",
        "dietary_carbs",
        "dietary_fat",
        "dietary_fiber",
        "dietary_sugar",
        "dietary_water",
        "dietary_caffeine",
        "sleep_total",
        "sleep_awake",
        "sleep_rem",
        "sleep_deep",
        "sleep_light",
        "workout",
        "mindful_minutes",
    }
    MIN_METRICS = {"resting_heart_rate"}

    @staticmethod
    def _isoformat(value: Optional[datetime]) -> Optional[str]:
        return value.isoformat() if value else None

    @staticmethod
    def _safe_json_loads(value: Optional[str]) -> Optional[Dict[str, Any]]:
        if not value:
            return None
        try:
            parsed = json.loads(value)
        except Exception:
            return {"raw": value}
        return parsed if isinstance(parsed, dict) else {"value": parsed}

    @classmethod
    def _source_device_name_from_sample(cls, sample: WearableSampleDB) -> Optional[str]:
        attributes = cls._safe_json_loads(sample.attributes_json)
        if isinstance(attributes, dict):
            return attributes.get("source_device_name")
        return None

    @classmethod
    def _source_device_name_from_event(cls, event: WearableEventDB) -> Optional[str]:
        details = cls._safe_json_loads(event.details_json)
        if isinstance(details, dict):
            return details.get("source_device_name")
        return None

    @staticmethod
    def _parse_habit_log_completed_at(log: HabitLogDB) -> str:
        if log.completed_at:
            return log.completed_at
        return f"{log.date}T00:00:00"

    @classmethod
    def _timeline_sort_key(cls, item: Dict[str, Any]) -> Tuple[str, str]:
        return (item.get("timestamp") or "", item.get("id") or "")

    @classmethod
    def _aggregate_metric_values(cls, metric_type: str, values: List[float]) -> Tuple[Optional[float], Optional[str]]:
        if not values:
            return None, None
        if metric_type in cls.MIN_METRICS:
            return min(values), "daily_min"
        if metric_type in cls.CUMULATIVE_METRICS:
            return sum(values), "daily_total"
        return (sum(values) / len(values)), "daily_average"

    @classmethod
    def _select_rows_for_daily_totals(
        cls,
        metric_type: str,
        rows: List[Any],
    ) -> List[Any]:
        if not rows:
            return []
        daily_rows = [
            row for row in rows
            if str(getattr(row, "rollup_level", "") or "").strip().lower() == "daily"
            or str(getattr(row, "aggregation_kind", "") or "").strip().lower() in {"daily", "daily_aggregate"}
        ]
        non_daily_rows = [row for row in rows if row not in daily_rows]
        if metric_type in cls.CUMULATIVE_METRICS:
            return non_daily_rows or daily_rows
        return daily_rows or non_daily_rows

    @staticmethod
    def _serialize_source(source: Optional[WearableSourceDB]) -> Optional[Dict[str, Any]]:
        if source is None:
            return None
        metadata = None
        if source.metadata_json:
            try:
                metadata = json.loads(source.metadata_json)
            except Exception:
                metadata = {"raw": source.metadata_json}
        return {
            "id": source.id,
            "provider": source.provider,
            "source_kind": source.source_kind,
            "device_name": source.device_name,
            "device_model": source.device_model,
            "device_type": source.device_type,
            "platform": source.platform,
            "priority_rank": source.priority_rank,
            "source_bundle_id": source.source_bundle_id,
            "metadata": metadata,
        }

    async def _source_map(
        self,
        session: Any,
        *,
        user_id: str,
        source_ids: Iterable[Optional[str]],
    ) -> Dict[str, WearableSourceDB]:
        ids = sorted({source_id for source_id in source_ids if source_id})
        if not ids:
            return {}
        result = await session.execute(
            select(WearableSourceDB).where(
                WearableSourceDB.user_id == user_id,
                WearableSourceDB.id.in_(ids),
            )
        )
        return {source.id: source for source in result.scalars().all()}

    @staticmethod
    def _row_source_priority(row: Any, source_map: Dict[str, WearableSourceDB]) -> Tuple[int, int]:
        source = source_map.get(getattr(row, "source_id", None))
        source_rank = source.priority_rank if source is not None else SOURCE_KIND_PRIORITY_RANKS["unknown"]
        provider_rank = PROVIDER_PRIORITY_RANKS.get(getattr(row, "provider", None), 999)
        return source_rank, provider_rank

    def _best_ranked_rows(
        self,
        rows: List[Any],
        source_map: Dict[str, WearableSourceDB],
    ) -> Tuple[List[Any], Optional[WearableSourceDB]]:
        if not rows:
            return [], None
        ranked_rows = sorted(rows, key=lambda row: self._row_source_priority(row, source_map))
        best_rank = self._row_source_priority(ranked_rows[0], source_map)
        selected = [row for row in ranked_rows if self._row_source_priority(row, source_map) == best_rank]
        selected_source = source_map.get(getattr(selected[0], "source_id", None))
        return selected, selected_source

    @classmethod
    def _select_provider_rows(
        cls,
        grouped_rows: Dict[str, List[Any]],
        preferred_provider: Optional[str],
        source_map: Optional[Dict[str, WearableSourceDB]] = None,
    ) -> Tuple[List[Any], Optional[str], Optional[Dict[str, Any]]]:
        source_map = source_map or {}
        if preferred_provider and preferred_provider in grouped_rows:
            ranked_rows = sorted(
                grouped_rows[preferred_provider],
                key=lambda row: (
                    source_map.get(getattr(row, "source_id", None)).priority_rank
                    if source_map.get(getattr(row, "source_id", None))
                    else SOURCE_KIND_PRIORITY_RANKS["unknown"],
                    PROVIDER_PRIORITY_RANKS.get(preferred_provider, 999),
                ),
            )
            if not ranked_rows:
                return [], preferred_provider, None
            best_rank = (
                source_map.get(getattr(ranked_rows[0], "source_id", None)).priority_rank
                if source_map.get(getattr(ranked_rows[0], "source_id", None))
                else SOURCE_KIND_PRIORITY_RANKS["unknown"]
            )
            selected = [
                row
                for row in ranked_rows
                if (
                    source_map.get(getattr(row, "source_id", None)).priority_rank
                    if source_map.get(getattr(row, "source_id", None))
                    else SOURCE_KIND_PRIORITY_RANKS["unknown"]
                )
                == best_rank
            ]
            selected_source = source_map.get(getattr(selected[0], "source_id", None)) if selected else None
            return selected, preferred_provider, cls._serialize_source(selected_source)
        if len(grouped_rows) == 1:
            provider = next(iter(grouped_rows.keys()))
            service = cls()
            selected, selected_source = service._best_ranked_rows(grouped_rows[provider], source_map)
            return selected, provider, service._serialize_source(selected_source)

        provider_candidates: List[Tuple[Tuple[int, int], str, List[Any], Optional[WearableSourceDB]]] = []
        service = cls()
        for provider, rows in grouped_rows.items():
            ranked_rows, selected_source = service._best_ranked_rows(rows, source_map)
            if not ranked_rows:
                continue
            rank = service._row_source_priority(ranked_rows[0], source_map)
            provider_candidates.append((rank, provider, ranked_rows, selected_source))

        if not provider_candidates:
            return [], None, None
        provider_candidates.sort(key=lambda item: item[0])
        _rank, provider, rows, selected_source = provider_candidates[0]
        return rows, provider, service._serialize_source(selected_source)

    async def _preferred_provider_by_metric(
        self,
        session: Any,
        *,
        user_id: str,
    ) -> Dict[str, str]:
        result = await session.execute(
            select(HabitDB, HabitProjectionPolicyDB)
            .join(HabitProjectionPolicyDB, HabitProjectionPolicyDB.habit_id == HabitDB.id, isouter=True)
            .where(HabitDB.user_id == user_id)
        )
        preferred_by_metric: Dict[str, str] = {}
        for habit, policy in result.all():
            serialized = wearable_projection_service._serialize_projection_policy(habit, policy)
            metric_type = serialized.get("canonical_metric_type")
            priority = serialized.get("projection_source_priority") or []
            if metric_type and priority and metric_type not in preferred_by_metric:
                preferred_by_metric[metric_type] = priority[0]
        return preferred_by_metric

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

    async def get_timeline(
        self,
        *,
        user_id: str,
        providers: Optional[List[str]] = None,
        metric_types: Optional[List[str]] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        include_manual_logs: bool = True,
        include_deleted: bool = False,
        limit: int = 200,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        async with get_db_session() as session:
            query_limit = max(limit * 2, 200)
            provider_filter = [item for item in (providers or []) if item]
            metric_filter = [item for item in (metric_types or []) if item]

            sample_query = select(WearableSampleDB).where(WearableSampleDB.user_id == user_id)
            if provider_filter:
                sample_query = sample_query.where(WearableSampleDB.provider.in_(provider_filter))
            if metric_filter:
                sample_query = sample_query.where(WearableSampleDB.metric_type.in_(metric_filter))
            if start_time:
                sample_query = sample_query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time) >= start_time)
            if end_time:
                sample_query = sample_query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.end_time) <= end_time)
            if not include_deleted:
                sample_query = sample_query.where(WearableSampleDB.deleted_at.is_(None))
            sample_query = sample_query.order_by(
                func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time).desc(),
                WearableSampleDB.id.desc(),
            ).limit(query_limit)
            samples = list((await session.execute(sample_query)).scalars().all())

            event_query = select(WearableEventDB).where(WearableEventDB.user_id == user_id)
            if provider_filter:
                event_query = event_query.where(WearableEventDB.provider.in_(provider_filter))
            if metric_filter:
                event_query = event_query.where(WearableEventDB.event_type.in_(metric_filter))
            if start_time:
                event_query = event_query.where(WearableEventDB.start_time >= start_time)
            if end_time:
                event_query = event_query.where(WearableEventDB.end_time <= end_time)
            if not include_deleted:
                event_query = event_query.where(WearableEventDB.deleted_at.is_(None))
            event_query = event_query.order_by(WearableEventDB.start_time.desc(), WearableEventDB.id.desc()).limit(query_limit)
            events = list((await session.execute(event_query)).scalars().all())
            source_map = await self._source_map(
                session,
                user_id=user_id,
                source_ids=[sample.source_id for sample in samples] + [event.source_id for event in events],
            )

            items: List[Dict[str, Any]] = []

            for sample in samples:
                timestamp = self._isoformat(sample.recorded_at or sample.start_time or sample.end_time)
                if not timestamp:
                    continue
                items.append(
                    {
                        "id": sample.id,
                        "kind": "wearable_sample",
                        "provider": sample.provider,
                        "metric_type": sample.metric_type,
                        "title": sample.metric_type.replace("_", " ").title(),
                        "timestamp": timestamp,
                        "start_time": self._isoformat(sample.start_time),
                        "end_time": self._isoformat(sample.end_time),
                        "attributed_date": sample.attributed_date,
                        "value": sample.value,
                        "unit": sample.unit,
                        "aggregation_kind": sample.aggregation_kind,
                        "rollup_level": sample.rollup_level,
                        "rollup_window_minutes": sample.rollup_window_minutes,
                        "source_device_name": (
                            source_map.get(sample.source_id).device_name
                            if sample.source_id and source_map.get(sample.source_id)
                            else self._source_device_name_from_sample(sample)
                        ),
                    }
                )

            for event in events:
                timestamp = self._isoformat(event.start_time)
                if not timestamp:
                    continue
                items.append(
                    {
                        "id": event.id,
                        "kind": "wearable_event",
                        "provider": event.provider,
                        "metric_type": event.event_type,
                        "event_type": event.event_type,
                        "title": event.title or event.event_type.replace("_", " ").title(),
                        "timestamp": timestamp,
                        "start_time": self._isoformat(event.start_time),
                        "end_time": self._isoformat(event.end_time),
                        "attributed_date": event.attributed_date,
                        "value": event.summary_value,
                        "unit": event.summary_unit,
                        "aggregation_kind": "interval",
                        "source_device_name": (
                            source_map.get(event.source_id).device_name
                            if event.source_id and source_map.get(event.source_id)
                            else self._source_device_name_from_event(event)
                        ),
                    }
                )

            if include_manual_logs:
                log_query = select(HabitLogDB).join(HabitDB, HabitDB.id == HabitLogDB.habit_id).where(
                    HabitDB.user_id == user_id,
                    HabitLogDB.origin_record_kind.is_(None),
                )
                if start_time:
                    log_query = log_query.where(HabitLogDB.date >= start_time.strftime("%Y-%m-%d"))
                if end_time:
                    log_query = log_query.where(HabitLogDB.date <= end_time.strftime("%Y-%m-%d"))
                if metric_filter:
                    log_query = log_query.where(HabitDB.metric_type.in_(metric_filter))
                log_query = log_query.order_by(HabitLogDB.completed_at.desc(), HabitLogDB.id.desc()).limit(query_limit)
                logs = list((await session.execute(log_query)).scalars().all())
                for log in logs:
                    items.append(
                        {
                            "id": log.id,
                            "kind": "habit_log",
                            "habit_id": log.habit_id,
                            "habit_name": log.habit_name,
                            "title": log.habit_name,
                            "timestamp": self._parse_habit_log_completed_at(log),
                            "start_time": log.completed_at,
                            "end_time": log.completed_at,
                            "attributed_date": log.date,
                            "value": log.amount,
                            "unit": None,
                            "status": log.status,
                            "notes": log.notes,
                        }
                    )

            items.sort(key=self._timeline_sort_key, reverse=True)
            next_cursor = None
            if len(items) > limit:
                trailing_item = items[limit]
                next_cursor = f"{trailing_item['timestamp']}|{trailing_item['id']}"
            return items[:limit], next_cursor

    async def get_series(
        self,
        *,
        user_id: str,
        metric_type: str,
        provider: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        resolution: str = "raw",
        limit: int = 2000,
    ) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            preferred_provider_by_metric = await self._preferred_provider_by_metric(session, user_id=user_id)
            selected_provider = provider or preferred_provider_by_metric.get(metric_type)

            if resolution == "daily":
                totals = await self.get_daily_totals(
                    user_id=user_id,
                    metric_types=[metric_type],
                    providers=[selected_provider] if selected_provider else None,
                    start_date=(start_time or datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d"),
                    end_date=(end_time or datetime.now(timezone.utc)).strftime("%Y-%m-%d"),
                )
                points: List[Dict[str, Any]] = []
                for item in totals:
                    metric_payload = item["metrics"].get(metric_type)
                    if not metric_payload:
                        continue
                    points.append(
                        {
                            "timestamp": item["date"],
                            "start_time": item["date"],
                            "end_time": item["date"],
                            "value": metric_payload["value"],
                            "unit": metric_payload.get("unit"),
                            "provider": metric_payload.get("provider"),
                            "metric_type": metric_type,
                            "aggregation_kind": metric_payload.get("aggregation"),
                            "rollup_level": "daily",
                            "rollup_window_minutes": 1440,
                            "attributed_date": item["date"],
                            "source_device_name": None,
                            "selected_source": metric_payload.get("selected_source"),
                        }
                    )
                return points

            sample_query = select(WearableSampleDB).where(
                WearableSampleDB.user_id == user_id,
                WearableSampleDB.metric_type == metric_type,
            )
            if selected_provider:
                sample_query = sample_query.where(WearableSampleDB.provider == selected_provider)
            if start_time:
                sample_query = sample_query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time) >= start_time)
            if end_time:
                sample_query = sample_query.where(func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.end_time) <= end_time)
            sample_query = sample_query.where(WearableSampleDB.deleted_at.is_(None))
            resolution_candidates = {
                "raw": ["raw", "bucket_15m", "bucket_1h", "daily"],
                "15m": ["bucket_15m", "bucket_1h", "daily"],
                "1h": ["bucket_1h", "daily"],
            }.get(resolution, ["raw", "bucket_15m", "bucket_1h", "daily"])

            samples: List[WearableSampleDB] = []
            resolved_resolution = resolution
            for rollup_level in resolution_candidates:
                candidate_query = sample_query.where(WearableSampleDB.rollup_level == rollup_level)
                candidate_query = candidate_query.order_by(
                    func.coalesce(WearableSampleDB.recorded_at, WearableSampleDB.start_time).asc(),
                    WearableSampleDB.id.asc(),
                ).limit(limit)
                candidate_rows = list((await session.execute(candidate_query)).scalars().all())
                if candidate_rows:
                    samples = candidate_rows
                    resolved_resolution = rollup_level if rollup_level != "raw" else "raw"
                    break

            if samples:
                source_map = await self._source_map(
                    session,
                    user_id=user_id,
                    source_ids=[sample.source_id for sample in samples],
                )
                grouped_by_provider: Dict[str, List[WearableSampleDB]] = {}
                for sample in samples:
                    grouped_by_provider.setdefault(sample.provider, []).append(sample)
                selected_rows, selected_provider, selected_source = self._select_provider_rows(
                    grouped_by_provider,
                    selected_provider,
                    source_map,
                )
                return [
                    {
                        "timestamp": self._isoformat(sample.recorded_at or sample.start_time or sample.end_time),
                        "start_time": self._isoformat(sample.start_time),
                        "end_time": self._isoformat(sample.end_time),
                        "value": sample.value,
                        "unit": sample.unit,
                        "provider": selected_provider or sample.provider,
                        "metric_type": sample.metric_type,
                        "aggregation_kind": sample.aggregation_kind,
                        "rollup_level": sample.rollup_level,
                        "rollup_window_minutes": sample.rollup_window_minutes,
                        "attributed_date": sample.attributed_date,
                        "source_device_name": (
                            source_map.get(sample.source_id).device_name
                            if sample.source_id and source_map.get(sample.source_id)
                            else self._source_device_name_from_sample(sample)
                        ),
                        "selected_source": selected_source,
                    }
                    for sample in selected_rows
                    if sample.recorded_at or sample.start_time or sample.end_time
                ]

            event_query = select(WearableEventDB).where(
                WearableEventDB.user_id == user_id,
                WearableEventDB.event_type == metric_type,
                WearableEventDB.deleted_at.is_(None),
            )
            if selected_provider:
                event_query = event_query.where(WearableEventDB.provider == selected_provider)
            if start_time:
                event_query = event_query.where(WearableEventDB.start_time >= start_time)
            if end_time:
                event_query = event_query.where(WearableEventDB.end_time <= end_time)
            event_query = event_query.order_by(WearableEventDB.start_time.asc(), WearableEventDB.id.asc()).limit(limit)
            events = list((await session.execute(event_query)).scalars().all())
            source_map = await self._source_map(
                session,
                user_id=user_id,
                source_ids=[event.source_id for event in events],
            )
            grouped_by_provider: Dict[str, List[WearableEventDB]] = {}
            for event in events:
                grouped_by_provider.setdefault(event.provider, []).append(event)
            selected_rows, selected_provider, selected_source = self._select_provider_rows(
                grouped_by_provider,
                selected_provider,
                source_map,
            )
            return [
                {
                    "timestamp": self._isoformat(event.start_time),
                    "start_time": self._isoformat(event.start_time),
                    "end_time": self._isoformat(event.end_time),
                    "value": float(event.summary_value or 0.0),
                    "unit": event.summary_unit,
                    "provider": selected_provider or event.provider,
                    "metric_type": event.event_type,
                    "aggregation_kind": "interval",
                    "rollup_level": "raw",
                    "rollup_window_minutes": None,
                    "attributed_date": event.attributed_date,
                    "source_device_name": (
                        source_map.get(event.source_id).device_name
                        if event.source_id and source_map.get(event.source_id)
                        else self._source_device_name_from_event(event)
                    ),
                    "selected_source": selected_source,
                }
                for event in selected_rows
            ]

    @staticmethod
    def _choose_preferred_provider_rows(
        rows_by_provider: Dict[str, List[Any]],
        preferred_provider: Optional[str],
    ) -> Tuple[List[Any], Optional[str]]:
        if not rows_by_provider:
            return [], None
        if preferred_provider and preferred_provider in rows_by_provider:
            return rows_by_provider[preferred_provider], preferred_provider
        provider = sorted(rows_by_provider.keys())[0]
        return rows_by_provider[provider], provider

    @staticmethod
    def _row_value(row: Any, key: str, default: Any = None) -> Any:
        mapping = getattr(row, "_mapping", None)
        if mapping is not None and key in mapping:
            return mapping[key]
        return getattr(row, key, default)

    @classmethod
    def _aggregate_preaggregated_rows(
        cls,
        metric_type: str,
        rows: List[Any],
    ) -> Tuple[Optional[float], Optional[str], Optional[str]]:
        if not rows:
            return None, None, None

        daily_rows = [
            row for row in rows
            if str(cls._row_value(row, "rollup_level", "") or "").strip().lower() == "daily"
            or str(cls._row_value(row, "aggregation_kind", "") or "").strip().lower() in {"daily", "daily_aggregate"}
        ]
        non_daily_rows = [row for row in rows if row not in daily_rows]
        selected_rows = (non_daily_rows or daily_rows) if metric_type in cls.CUMULATIVE_METRICS else (daily_rows or non_daily_rows)
        if not selected_rows:
            return None, None, None

        unit = next((cls._row_value(row, "unit", None) for row in selected_rows if cls._row_value(row, "unit", None)), None)
        if metric_type in cls.MIN_METRICS:
            values = [float(cls._row_value(row, "min_value", 0.0) or 0.0) for row in selected_rows]
            return (min(values), "daily_min", unit) if values else (None, None, unit)
        if metric_type in cls.CUMULATIVE_METRICS:
            return (
                sum(float(cls._row_value(row, "sum_value", 0.0) or 0.0) for row in selected_rows),
                "daily_total",
                unit,
            )

        weighted_sum = 0.0
        weight = 0
        for row in selected_rows:
            count = int(cls._row_value(row, "value_count", 0) or 0)
            if count <= 0:
                continue
            weighted_sum += float(cls._row_value(row, "avg_value", 0.0) or 0.0) * count
            weight += count
        if weight <= 0:
            return None, None, unit
        return weighted_sum / weight, "daily_average", unit

    async def _get_daily_totals_aggregated(
        self,
        *,
        user_id: str,
        metric_types: Optional[List[str]] = None,
        providers: Optional[List[str]] = None,
        start_date: str,
        end_date: str,
    ) -> List[Dict[str, Any]]:
        async with get_db_session() as session:
            preferred_provider_by_metric = await self._preferred_provider_by_metric(session, user_id=user_id)
            provider_filter = [item for item in (providers or []) if item]
            metric_filter = [item for item in (metric_types or []) if item]

            sample_query = (
                select(
                    WearableSampleDB.attributed_date.label("date_value"),
                    WearableSampleDB.metric_type.label("metric_type"),
                    WearableSampleDB.provider.label("provider"),
                    WearableSampleDB.unit.label("unit"),
                    WearableSampleDB.rollup_level.label("rollup_level"),
                    WearableSampleDB.aggregation_kind.label("aggregation_kind"),
                    func.sum(WearableSampleDB.value).label("sum_value"),
                    func.avg(WearableSampleDB.value).label("avg_value"),
                    func.min(WearableSampleDB.value).label("min_value"),
                    func.count(WearableSampleDB.id).label("value_count"),
                )
                .where(
                    WearableSampleDB.user_id == user_id,
                    WearableSampleDB.deleted_at.is_(None),
                    WearableSampleDB.attributed_date.is_not(None),
                    WearableSampleDB.attributed_date >= start_date,
                    WearableSampleDB.attributed_date <= end_date,
                )
                .group_by(
                    WearableSampleDB.attributed_date,
                    WearableSampleDB.metric_type,
                    WearableSampleDB.provider,
                    WearableSampleDB.unit,
                    WearableSampleDB.rollup_level,
                    WearableSampleDB.aggregation_kind,
                )
            )
            if provider_filter:
                sample_query = sample_query.where(WearableSampleDB.provider.in_(provider_filter))
            if metric_filter:
                sample_query = sample_query.where(WearableSampleDB.metric_type.in_(metric_filter))
            sample_rows = list((await session.execute(sample_query)).all())

            event_query = (
                select(
                    WearableEventDB.attributed_date.label("date_value"),
                    WearableEventDB.event_type.label("metric_type"),
                    WearableEventDB.provider.label("provider"),
                    WearableEventDB.summary_unit.label("unit"),
                    func.sum(WearableEventDB.summary_value).label("sum_value"),
                    func.avg(WearableEventDB.summary_value).label("avg_value"),
                    func.min(WearableEventDB.summary_value).label("min_value"),
                    func.count(WearableEventDB.id).label("value_count"),
                )
                .where(
                    WearableEventDB.user_id == user_id,
                    WearableEventDB.deleted_at.is_(None),
                    WearableEventDB.attributed_date.is_not(None),
                    WearableEventDB.summary_value.is_not(None),
                    WearableEventDB.attributed_date >= start_date,
                    WearableEventDB.attributed_date <= end_date,
                )
                .group_by(
                    WearableEventDB.attributed_date,
                    WearableEventDB.event_type,
                    WearableEventDB.provider,
                    WearableEventDB.summary_unit,
                )
            )
            if provider_filter:
                event_query = event_query.where(WearableEventDB.provider.in_(provider_filter))
            if metric_filter:
                event_query = event_query.where(WearableEventDB.event_type.in_(metric_filter))
            event_rows = list((await session.execute(event_query)).all())

        grouped_samples: Dict[Tuple[str, str, str], List[Any]] = {}
        for row in sample_rows:
            grouped_samples.setdefault((row.date_value or "", row.metric_type, row.provider), []).append(row)

        grouped_events: Dict[Tuple[str, str, str], List[Any]] = {}
        for row in event_rows:
            grouped_events.setdefault((row.date_value or "", row.metric_type, row.provider), []).append(row)

        metric_keys = set((date_value, metric_type) for date_value, metric_type, _provider in grouped_samples.keys())
        metric_keys.update((date_value, metric_type) for date_value, metric_type, _provider in grouped_events.keys())

        per_day: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for date_value, metric_type in sorted(metric_keys):
            if not date_value:
                continue
            providers_for_samples = {
                provider_name: rows
                for (sample_date, sample_metric, provider_name), rows in grouped_samples.items()
                if sample_date == date_value and sample_metric == metric_type
            }
            providers_for_events = {
                provider_name: rows
                for (event_date, event_metric, provider_name), rows in grouped_events.items()
                if event_date == date_value and event_metric == metric_type
            }

            preferred_provider = preferred_provider_by_metric.get(metric_type)
            if provider_filter and len(provider_filter) == 1:
                preferred_provider = provider_filter[0]

            selected_sample_rows, selected_sample_provider = self._choose_preferred_provider_rows(
                providers_for_samples,
                preferred_provider,
            )
            selected_event_rows, selected_event_provider = self._choose_preferred_provider_rows(
                providers_for_events,
                preferred_provider,
            )

            value, aggregation_label, unit = self._aggregate_preaggregated_rows(metric_type, selected_sample_rows)
            provider_name = selected_sample_provider
            if value is None:
                value, aggregation_label, unit = self._aggregate_preaggregated_rows(metric_type, selected_event_rows)
                provider_name = selected_event_provider
            if value is None:
                continue

            per_day.setdefault(date_value, {})[metric_type] = {
                "value": value,
                "unit": unit,
                "aggregation": aggregation_label,
                "provider": provider_name,
                "selected_source": None,
            }

        return [
            {"date": date_value, "metrics": metrics}
            for date_value, metrics in sorted(per_day.items(), key=lambda item: item[0])
        ]

    async def get_daily_totals(
        self,
        *,
        user_id: str,
        metric_types: Optional[List[str]] = None,
        providers: Optional[List[str]] = None,
        start_date: str,
        end_date: str,
    ) -> List[Dict[str, Any]]:
        range_days = (datetime.strptime(end_date, "%Y-%m-%d") - datetime.strptime(start_date, "%Y-%m-%d")).days + 1
        if range_days > WEARABLE_DAILY_TOTALS_OBJECT_LOAD_MAX_DAYS:
            return await self._get_daily_totals_aggregated(
                user_id=user_id,
                metric_types=metric_types,
                providers=providers,
                start_date=start_date,
                end_date=end_date,
            )

        async with get_db_session() as session:
            preferred_provider_by_metric = await self._preferred_provider_by_metric(session, user_id=user_id)
            provider_filter = [item for item in (providers or []) if item]
            metric_filter = [item for item in (metric_types or []) if item]

            sample_query = select(WearableSampleDB).where(
                WearableSampleDB.user_id == user_id,
                WearableSampleDB.deleted_at.is_(None),
                WearableSampleDB.attributed_date.is_not(None),
                WearableSampleDB.attributed_date >= start_date,
                WearableSampleDB.attributed_date <= end_date,
            )
            if provider_filter:
                sample_query = sample_query.where(WearableSampleDB.provider.in_(provider_filter))
            if metric_filter:
                sample_query = sample_query.where(WearableSampleDB.metric_type.in_(metric_filter))
            samples = list((await session.execute(sample_query)).scalars().all())

            event_query = select(WearableEventDB).where(
                WearableEventDB.user_id == user_id,
                WearableEventDB.deleted_at.is_(None),
                WearableEventDB.attributed_date.is_not(None),
                WearableEventDB.attributed_date >= start_date,
                WearableEventDB.attributed_date <= end_date,
            )
            if provider_filter:
                event_query = event_query.where(WearableEventDB.provider.in_(provider_filter))
            if metric_filter:
                event_query = event_query.where(WearableEventDB.event_type.in_(metric_filter))
            events = list((await session.execute(event_query)).scalars().all())
            source_map = await self._source_map(
                session,
                user_id=user_id,
                source_ids=[sample.source_id for sample in samples] + [event.source_id for event in events],
            )

            grouped_samples: Dict[Tuple[str, str, str], List[WearableSampleDB]] = {}
            for sample in samples:
                key = (sample.attributed_date or "", sample.metric_type, sample.provider)
                grouped_samples.setdefault(key, []).append(sample)

            grouped_events: Dict[Tuple[str, str, str], List[WearableEventDB]] = {}
            for event in events:
                key = (event.attributed_date or "", event.event_type, event.provider)
                grouped_events.setdefault(key, []).append(event)

            metric_keys = set((date_value, metric_type) for date_value, metric_type, _provider in grouped_samples.keys())
            metric_keys.update((date_value, metric_type) for date_value, metric_type, _provider in grouped_events.keys())

            per_day: Dict[str, Dict[str, Dict[str, Any]]] = {}

            for date_value, metric_type in sorted(metric_keys):
                providers_for_samples: Dict[str, List[WearableSampleDB]] = {
                    provider_name: rows
                    for (sample_date, sample_metric, provider_name), rows in grouped_samples.items()
                    if sample_date == date_value and sample_metric == metric_type
                }
                providers_for_events: Dict[str, List[WearableEventDB]] = {
                    provider_name: rows
                    for (event_date, event_metric, provider_name), rows in grouped_events.items()
                    if event_date == date_value and event_metric == metric_type
                }

                preferred_provider = preferred_provider_by_metric.get(metric_type)
                if provider_filter and len(provider_filter) == 1:
                    preferred_provider = provider_filter[0]

                selected_sample_rows, selected_sample_provider, selected_sample_source = self._select_provider_rows(
                    providers_for_samples,
                    preferred_provider,
                    source_map,
                )
                selected_event_rows, selected_event_provider, selected_event_source = self._select_provider_rows(
                    providers_for_events,
                    preferred_provider,
                    source_map,
                )

                chosen_values: List[float] = []
                unit: Optional[str] = None
                provider_name: Optional[str] = None

                preferred_sample_rows = self._select_rows_for_daily_totals(metric_type, selected_sample_rows)

                if preferred_sample_rows:
                    chosen_values = [float(row.value) for row in preferred_sample_rows]
                    unit = preferred_sample_rows[0].unit
                    provider_name = selected_sample_provider
                elif selected_event_rows:
                    chosen_values = [float(row.summary_value or 0.0) for row in selected_event_rows if row.summary_value is not None]
                    unit = selected_event_rows[0].summary_unit
                    provider_name = selected_event_provider

                aggregated_value, aggregation_label = self._aggregate_metric_values(metric_type, chosen_values)
                if aggregated_value is None:
                    continue

                per_day.setdefault(date_value, {})[metric_type] = {
                    "value": aggregated_value,
                    "unit": unit,
                    "aggregation": aggregation_label,
                    "provider": provider_name,
                    "selected_source": selected_sample_source or selected_event_source,
                }

            return [
                {"date": date_value, "metrics": metrics}
                for date_value, metrics in sorted(per_day.items(), key=lambda item: item[0])
            ]

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
            source.priority_rank = _default_source_priority_rank(
                source_kind=source_kind,
                device_type=device_type,
                device_name=device_name,
                platform=platform,
            )
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
        expires_at: Optional[datetime] = None,
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
                expires_at=expires_at or (datetime.now(timezone.utc) + timedelta(days=RAW_PAYLOAD_TTL_DAYS)),
            )
            session.add(record)
            await session.commit()
            await session.refresh(record)
            return record

    async def get_raw_payload(self, payload_id: str) -> Optional[WearableRawPayloadDB]:
        async with get_db_session() as session:
            result = await session.execute(select(WearableRawPayloadDB).where(WearableRawPayloadDB.id == payload_id))
            return result.scalar_one_or_none()

    async def list_raw_payloads(
        self,
        *,
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        has_error: Optional[bool] = None,
        limit: int = 100,
    ) -> List[WearableRawPayloadDB]:
        async with get_db_session() as session:
            query = select(WearableRawPayloadDB)
            if user_id:
                query = query.where(WearableRawPayloadDB.user_id == user_id)
            if provider:
                query = query.where(WearableRawPayloadDB.provider == provider)
            if start_time:
                query = query.where(WearableRawPayloadDB.received_at >= start_time)
            if end_time:
                query = query.where(WearableRawPayloadDB.received_at <= end_time)
            if has_error is True:
                query = query.where(WearableRawPayloadDB.normalization_error_json.is_not(None))
            elif has_error is False:
                query = query.where(WearableRawPayloadDB.normalization_error_json.is_(None))
            query = query.order_by(WearableRawPayloadDB.received_at.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def record_raw_payload_error(
        self,
        *,
        payload_id: str,
        error: Dict[str, Any],
    ) -> None:
        async with get_db_session() as session:
            result = await session.execute(select(WearableRawPayloadDB).where(WearableRawPayloadDB.id == payload_id))
            payload = result.scalar_one_or_none()
            if payload is None:
                return
            payload.normalization_error_json = json.dumps(error)
            await session.commit()

    async def clear_raw_payload_error(self, payload_id: str) -> None:
        async with get_db_session() as session:
            result = await session.execute(select(WearableRawPayloadDB).where(WearableRawPayloadDB.id == payload_id))
            payload = result.scalar_one_or_none()
            if payload is None:
                return
            payload.normalization_error_json = None
            await session.commit()

    async def replay_raw_payload(
        self,
        *,
        payload_id: str,
    ) -> Dict[str, Any]:
        payload_record = await self.get_raw_payload(payload_id)
        if payload_record is None:
            raise ValueError("Raw payload not found")

        try:
            payload = json.loads(payload_record.payload_json)
        except Exception as exc:
            await self.record_raw_payload_error(
                payload_id=payload_id,
                error={"message": "Raw payload is not valid JSON", "detail": str(exc)},
            )
            raise ValueError("Raw payload is not valid JSON") from exc

        try:
            if payload_record.provider == "garmin" and payload_record.direction == "webhook":
                provider_user_id = payload_record.external_id or "garmin-replay"
                result = await self.ingest_garmin_payload(
                    user_id=payload_record.user_id,
                    provider_user_id=provider_user_id,
                    payload=payload,
                    access_token=None,
                    refresh_token=None,
                    token_expires_at=None,
                )
            elif payload_record.provider == "whoop" and payload_record.direction == "oauth_pull":
                result = await self.ingest_whoop_data(
                    user_id=payload_record.user_id,
                    provider_user_id=payload_record.external_id or "whoop-replay",
                    recovery_data=payload.get("recovery_data"),
                    sleep_data=payload.get("sleep_data"),
                    workout_data=payload.get("workout_data"),
                    cycle_data=payload.get("cycle_data"),
                    access_token=None,
                    refresh_token=None,
                    token_expires_at=None,
                )
            elif payload_record.provider == "oura" and payload_record.direction == "oauth_pull":
                result = await self.ingest_oura_data(
                    user_id=payload_record.user_id,
                    provider_user_id=payload_record.external_id or "oura-replay",
                    personal_info=payload.get("personal_info"),
                    access_token=None,
                    refresh_token=None,
                    token_expires_at=None,
                    daily_sleep_records=payload.get("daily_sleep_records") or [],
                    sleep_records=payload.get("sleep_records") or [],
                    daily_readiness_records=payload.get("daily_readiness_records") or [],
                    daily_activity_records=payload.get("daily_activity_records") or [],
                    workout_records=payload.get("workout_records") or [],
                    heartrate_records=payload.get("heartrate_records") or [],
                )
            else:
                raise ValueError(
                    f"Replay is not supported for provider={payload_record.provider} direction={payload_record.direction}"
                )
            await self.clear_raw_payload_error(payload_id)
            return {"success": True, "payload_id": payload_id, "result": result}
        except Exception as exc:
            await self.record_raw_payload_error(
                payload_id=payload_id,
                error={
                    "message": "Normalization replay failed",
                    "detail": str(exc),
                    "provider": payload_record.provider,
                    "direction": payload_record.direction,
                    "failed_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            raise

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
            aggregation_kind = metric.aggregation_kind or (
                "interval" if metric.start_time != metric.end_time else "point"
            )
            if aggregation_kind == "daily":
                rollup_level = "daily"
            elif aggregation_kind == "bucket_15m":
                rollup_level = "bucket_15m"
            elif aggregation_kind == "bucket_1h":
                rollup_level = "bucket_1h"
            else:
                rollup_level = "raw"
            should_project_to_habit_logs = (
                True if metric.should_project_to_habit_logs is None else bool(metric.should_project_to_habit_logs)
            )

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
                await self._project_and_emit_event(
                    user_id=user_id,
                    provider="apple_health",
                    event_id=event_id,
                    created=created,
                )
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
                aggregation_kind=aggregation_kind,
                rollup_level=rollup_level,
                rollup_window_minutes=metric.rollup_window_minutes,
                sample_count=metric.sample_count,
                should_project_to_habit_logs=should_project_to_habit_logs,
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
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="apple_health",
                sample_id=sample_id,
                created=created,
            )
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
        await self.store_raw_payload(
            user_id=user_id,
            provider="whoop",
            direction="oauth_pull",
            payload={
                "provider_user_id": provider_user_id,
                "recovery_data": recovery_data,
                "sleep_data": sleep_data,
                "workout_data": workout_data,
                "cycle_data": cycle_data,
            },
            connection_id=connection.id,
            external_id=provider_user_id,
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
        await self.store_raw_payload(
            user_id=user_id,
            provider="oura",
            direction="oauth_pull",
            payload={
                "provider_user_id": provider_user_id,
                "personal_info": personal_info,
                "daily_sleep_records": daily_sleep_records,
                "sleep_records": sleep_records,
                "daily_readiness_records": daily_readiness_records,
                "daily_activity_records": daily_activity_records,
                "workout_records": workout_records,
                "heartrate_records": heartrate_records,
            },
            connection_id=connection.id,
            external_id=provider_user_id,
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
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="whoop",
                sample_id=sample_id,
                created=created,
            )
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
        await self._project_and_emit_event(
            user_id=user_id,
            provider="whoop",
            event_id=event_id,
            created=created,
        )
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
        await self._project_and_emit_event(
            user_id=user_id,
            provider="whoop",
            event_id=event_id,
            created=created,
        )
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
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="oura",
                sample_id=sample_id,
                created=created,
            )
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
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="oura",
                sample_id=sample_id,
                created=created,
            )
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
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="oura",
                sample_id=sample_id,
                created=created,
            )
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
        await self._project_and_emit_event(
            user_id=user_id,
            provider="oura",
            event_id=event_id,
            created=created,
        )

        sample_fields = [
            ("average_hrv", record.get("average_hrv"), "ms"),
            ("lowest_heart_rate", record.get("lowest_heart_rate"), "bpm"),
        ]
        for provider_metric_type, value, unit in sample_fields:
            if value in (None, ""):
                continue
            sample_id, sample_created = await self._upsert_sample(
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
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="oura",
                sample_id=sample_id,
                created=sample_created,
            )
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
        await self._project_and_emit_event(
            user_id=user_id,
            provider="oura",
            event_id=event_id,
            created=created,
        )
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
        await self._project_and_emit_sample(
            user_id=user_id,
            provider="oura",
            sample_id=sample_id,
            created=created,
        )
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
            await self._project_and_emit_sample(
                user_id=user_id,
                provider="garmin",
                sample_id=sample_id,
                created=created,
            )
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
            await self._project_and_emit_event(
                user_id=user_id,
                provider="garmin",
                event_id=event_id,
                created=created,
            )
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
        await self._project_and_emit_event(
            user_id=user_id,
            provider="garmin",
            event_id=event_id,
            created=created,
        )
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

    async def _emit_internal_signal_for_sample(self, sample: WearableSampleDB, *, created: bool) -> None:
        if not created:
            return
        outbox_event = build_wearable_outbox_event_for_sample(sample)
        if not outbox_event:
            return
        from services.wearable_event_outbox_service import wearable_event_outbox_service

        await wearable_event_outbox_service.enqueue_event(
            user_id=sample.user_id,
            provider=sample.provider,
            connection_id=sample.connection_id,
            source_id=sample.source_id,
            event_type=outbox_event["event_type"],
            related_record_kind="sample",
            related_record_id=sample.id,
            payload=outbox_event.get("payload"),
        )

    async def _emit_internal_signal_for_event(self, event: WearableEventDB, *, created: bool) -> None:
        if not created:
            return
        outbox_event = build_wearable_outbox_event_for_event(event)
        if not outbox_event:
            return
        from services.wearable_event_outbox_service import wearable_event_outbox_service

        await wearable_event_outbox_service.enqueue_event(
            user_id=event.user_id,
            provider=event.provider,
            connection_id=event.connection_id,
            source_id=event.source_id,
            event_type=outbox_event["event_type"],
            related_record_kind="event",
            related_record_id=event.id,
            payload=outbox_event.get("payload"),
        )

    async def _project_and_emit_sample(
        self,
        *,
        user_id: str,
        provider: str,
        sample_id: str,
        created: bool,
    ) -> None:
        sample = await self.get_sample(sample_id)
        if sample and sample.deleted_at is None:
            await self.projection_service.project_sample(user_id=user_id, provider=provider, sample=sample)
            await self._emit_internal_signal_for_sample(sample, created=created)

    async def _project_and_emit_event(
        self,
        *,
        user_id: str,
        provider: str,
        event_id: str,
        created: bool,
    ) -> None:
        event = await self.get_event(event_id)
        if event and event.deleted_at is None:
            await self.projection_service.project_event(user_id=user_id, provider=provider, event=event)
            await self._emit_internal_signal_for_event(event, created=created)

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
