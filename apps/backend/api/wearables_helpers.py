"""Shared helpers for the wearables API router.

These helpers are route-neutral policy/parsing utilities. Keeping them outside
the router keeps endpoint handlers focused on request/response behavior.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

VALID_METRIC_SYNC_MODES = {"off", "daily_only", "granular"}

METRIC_CATALOG: list[dict[str, Any]] = [
    {"category": "Activity", "metrics": [
        {"type": "steps", "name": "Steps", "unit": "count"},
        {"type": "active_energy", "name": "Active energy", "unit": "kcal"},
        {"type": "basal_energy", "name": "Basal energy", "unit": "kcal"},
        {"type": "distance", "name": "Distance", "unit": "meters"},
        {"type": "flights_climbed", "name": "Flights climbed", "unit": "count"},
        {"type": "exercise_time", "name": "Exercise time", "unit": "minutes"},
        {"type": "stand_time", "name": "Stand time", "unit": "minutes"},
    ]},
    {"category": "Heart", "metrics": [
        {"type": "hr", "name": "Heart rate", "unit": "bpm"},
        {"type": "hrv", "name": "HRV", "unit": "ms"},
        {"type": "resting_hr", "name": "Resting heart rate", "unit": "bpm"},
        {"type": "walking_hr", "name": "Walking heart rate", "unit": "bpm"},
    ]},
    {"category": "Sleep", "metrics": [
        {"type": "sleep_session", "name": "Sleep session", "unit": "hours"},
        {"type": "sleep_asleep", "name": "Asleep", "unit": "hours"},
        {"type": "sleep_awake", "name": "Awake", "unit": "hours"},
        {"type": "sleep_rem", "name": "REM sleep", "unit": "hours"},
        {"type": "sleep_deep", "name": "Deep sleep", "unit": "hours"},
        {"type": "sleep_core", "name": "Core sleep", "unit": "hours"},
    ]},
    {"category": "Respiratory", "metrics": [
        {"type": "respiratory_rate", "name": "Respiratory rate", "unit": "breaths/min"},
        {"type": "oxygen_saturation", "name": "Oxygen saturation", "unit": "%"},
    ]},
    {"category": "Body Measurements", "metrics": [
        {"type": "body_mass", "name": "Weight", "unit": "kg"},
        {"type": "body_mass_index", "name": "BMI", "unit": ""},
        {"type": "body_fat_percentage", "name": "Body fat", "unit": "%"},
        {"type": "lean_body_mass", "name": "Lean body mass", "unit": "kg"},
        {"type": "height", "name": "Height", "unit": "cm"},
        {"type": "waist_circumference", "name": "Waist circumference", "unit": "cm"},
    ]},
    {"category": "Nutrition", "metrics": [
        {"type": "dietary_energy", "name": "Calories consumed", "unit": "kcal"},
        {"type": "dietary_protein", "name": "Protein", "unit": "g"},
        {"type": "dietary_carbs", "name": "Carbohydrates", "unit": "g"},
        {"type": "dietary_fat", "name": "Fat", "unit": "g"},
        {"type": "dietary_fiber", "name": "Fiber", "unit": "g"},
        {"type": "dietary_sugar", "name": "Sugar", "unit": "g"},
        {"type": "dietary_water", "name": "Water", "unit": "ml"},
        {"type": "dietary_caffeine", "name": "Caffeine", "unit": "mg"},
    ]},
    {"category": "Vitals", "metrics": [
        {"type": "blood_pressure_systolic", "name": "Blood pressure (systolic)", "unit": "mmHg"},
        {"type": "blood_pressure_diastolic", "name": "Blood pressure (diastolic)", "unit": "mmHg"},
        {"type": "blood_glucose", "name": "Blood glucose", "unit": "mmol/L"},
        {"type": "body_temperature", "name": "Body temperature", "unit": "°C"},
    ]},
    {"category": "Mobility", "metrics": [
        {"type": "walking_speed", "name": "Walking speed", "unit": "m/s"},
        {"type": "walking_step_length", "name": "Step length", "unit": "cm"},
        {"type": "walking_asymmetry", "name": "Walking asymmetry", "unit": "%"},
    ]},
    {"category": "Workouts", "metrics": [
        {"type": "workout", "name": "Workout", "unit": "minutes"},
    ]},
    {"category": "Mindfulness", "metrics": [
        {"type": "mindful_minutes", "name": "Mindful minutes", "unit": "minutes"},
    ]},
]

METRIC_INFO: dict[str, dict[str, str]] = {
    metric["type"]: {
        "name": metric["name"],
        "unit": metric["unit"],
        "category": catalog_item["category"],
    }
    for catalog_item in METRIC_CATALOG
    for metric in catalog_item["metrics"]
}

ALL_METRIC_TYPES = set(METRIC_INFO.keys())


def default_apple_metric_sync_mode(metric_type: str) -> str:
    from services.wearables_unified import default_sync_mode_for_provider_metric

    return default_sync_mode_for_provider_metric("apple_health", metric_type)


def parse_csv_list(raw_value: Optional[str]) -> list[str]:
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def parse_iso_datetime(raw_value: Optional[str], *, field_name: str) -> Optional[datetime]:
    if not raw_value:
        return None
    try:
        return datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a valid ISO8601 timestamp") from exc


def coerce_settings_payload(settings_json: Any) -> dict[str, Any]:
    if isinstance(settings_json, dict):
        return settings_json
    if isinstance(settings_json, str):
        try:
            parsed = json.loads(settings_json)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def connection_matches_sync_schedule(connection: Any, *, provider: str, requested_hour: Optional[int]) -> bool:
    settings = coerce_settings_payload(getattr(connection, "settings_json", None))
    enabled = bool(settings.get("auto_sync_enabled", provider != "apple_health"))
    if not enabled:
        return False
    configured_hour = settings.get("sync_hour")
    if configured_hour is None and provider == "whoop":
        configured_hour = settings.get("whoop_sync_hour", 9)
    if requested_hour is None:
        return True
    return int(configured_hour if configured_hour is not None else 9) == int(requested_hour)


def metric_category(metric_type: str) -> str:
    """Map metric type string to a human-readable category."""
    categories = {
        "steps": "Activity", "active_energy": "Activity", "basal_energy": "Activity",
        "distance": "Activity", "flights_climbed": "Activity", "exercise_time": "Activity",
        "stand_time": "Activity",
        "hr": "Heart", "hrv": "Heart", "resting_hr": "Heart", "walking_hr": "Heart",
        "sleep_session": "Sleep", "sleep_asleep": "Sleep", "sleep_awake": "Sleep",
        "sleep_rem": "Sleep", "sleep_deep": "Sleep", "sleep_core": "Sleep",
        "respiratory_rate": "Respiratory", "oxygen_saturation": "Respiratory",
        "body_mass": "Body Measurements", "body_mass_index": "Body Measurements",
        "body_fat_percentage": "Body Measurements", "lean_body_mass": "Body Measurements",
        "height": "Body Measurements", "waist_circumference": "Body Measurements",
        "dietary_energy": "Nutrition", "dietary_protein": "Nutrition",
        "dietary_carbs": "Nutrition", "dietary_fat": "Nutrition",
        "dietary_fiber": "Nutrition", "dietary_sugar": "Nutrition",
        "dietary_water": "Nutrition", "dietary_caffeine": "Nutrition",
        "blood_pressure_systolic": "Vitals", "blood_pressure_diastolic": "Vitals",
        "blood_glucose": "Vitals", "body_temperature": "Vitals",
        "walking_speed": "Mobility", "walking_step_length": "Mobility",
        "walking_asymmetry": "Mobility",
        "workout": "Workouts", "mindful_minutes": "Mindfulness",
    }
    return categories.get(metric_type, "Other")


def metric_display_name(metric_type: str) -> str:
    """Map metric type string to a human-readable display name."""
    labels = {
        "steps": "Steps", "active_energy": "Active energy", "basal_energy": "Basal energy",
        "distance": "Distance", "flights_climbed": "Flights climbed",
        "exercise_time": "Exercise time", "stand_time": "Stand time",
        "hr": "Heart rate", "hrv": "HRV", "resting_hr": "Resting heart rate",
        "walking_hr": "Walking heart rate",
        "respiratory_rate": "Respiratory rate", "oxygen_saturation": "Oxygen saturation",
        "sleep_session": "Sleep session", "sleep_asleep": "Asleep", "sleep_awake": "Awake",
        "sleep_rem": "REM", "sleep_deep": "Deep sleep", "sleep_core": "Core sleep",
        "body_mass": "Weight", "body_mass_index": "BMI",
        "body_fat_percentage": "Body fat", "lean_body_mass": "Lean body mass",
        "height": "Height", "waist_circumference": "Waist circumference",
        "dietary_energy": "Calories consumed", "dietary_protein": "Protein",
        "dietary_carbs": "Carbohydrates", "dietary_fat": "Fat",
        "dietary_fiber": "Fiber", "dietary_sugar": "Sugar",
        "dietary_water": "Water", "dietary_caffeine": "Caffeine",
        "blood_pressure_systolic": "Blood pressure (systolic)",
        "blood_pressure_diastolic": "Blood pressure (diastolic)",
        "blood_glucose": "Blood glucose", "body_temperature": "Body temperature",
        "walking_speed": "Walking speed", "walking_step_length": "Step length",
        "walking_asymmetry": "Walking asymmetry",
        "workout": "Workout", "mindful_minutes": "Mindful minutes",
    }
    return labels.get(metric_type, metric_type.replace("_", " ").title())


def _json_or_raw(raw_value: Any) -> Any:
    if not raw_value:
        return None
    if not isinstance(raw_value, str):
        return raw_value
    try:
        return json.loads(raw_value)
    except Exception:
        return {"raw": raw_value}


def serialize_connection(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **item,
        "provider": item["provider"],
        "auth_method": item["auth_method"],
        "status": item["status"],
    }


def serialize_sample(sample: Any) -> dict[str, Any]:
    return {
        "id": sample.id,
        "provider": sample.provider,
        "metric_type": sample.metric_type,
        "provider_metric_type": sample.provider_metric_type,
        "external_id": sample.external_id,
        "recorded_at": sample.recorded_at.isoformat() if sample.recorded_at else None,
        "start_time": sample.start_time.isoformat() if sample.start_time else None,
        "end_time": sample.end_time.isoformat() if sample.end_time else None,
        "attributed_date": sample.attributed_date,
        "value": sample.value,
        "unit": sample.unit,
        "aggregation_kind": sample.aggregation_kind,
        "rollup_level": getattr(sample, "rollup_level", None),
        "rollup_window_minutes": getattr(sample, "rollup_window_minutes", None),
        "sample_count": getattr(sample, "sample_count", None),
        "should_project_to_habit_logs": getattr(sample, "should_project_to_habit_logs", None),
        "confidence": sample.confidence,
        "timezone": sample.timezone,
        "source_id": sample.source_id,
        "attributes_json": _json_or_raw(sample.attributes_json),
        "deleted_at": sample.deleted_at.isoformat() if sample.deleted_at else None,
    }


def serialize_event(event: Any) -> dict[str, Any]:
    return {
        "id": event.id,
        "provider": event.provider,
        "event_type": event.event_type,
        "provider_event_type": event.provider_event_type,
        "external_id": event.external_id,
        "start_time": event.start_time.isoformat(),
        "end_time": event.end_time.isoformat(),
        "attributed_date": event.attributed_date,
        "timezone": event.timezone,
        "title": event.title,
        "summary_value": event.summary_value,
        "summary_unit": event.summary_unit,
        "source_id": event.source_id,
        "details_json": _json_or_raw(event.details_json),
        "deleted_at": event.deleted_at.isoformat() if event.deleted_at else None,
    }


def serialize_sync_run(run: Any) -> dict[str, Any]:
    return {
        "id": run.id,
        "provider": run.provider,
        "trigger": run.trigger,
        "status": run.status,
        "started_at": run.started_at.isoformat(),
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "items_seen": run.items_seen or 0,
        "items_written": run.items_written or 0,
        "items_updated": run.items_updated or 0,
        "items_deleted": run.items_deleted or 0,
        "error_json": _json_or_raw(run.error_json),
        "metadata_json": _json_or_raw(run.metadata_json),
    }


def serialize_outbox_event(item: Any) -> dict[str, Any]:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "provider": item.provider,
        "event_type": item.event_type,
        "delivery_target": item.delivery_target,
        "related_record_kind": item.related_record_kind,
        "related_record_id": item.related_record_id,
        "status": item.status,
        "attempts": int(item.attempts or 0),
        "max_attempts": int(item.max_attempts or 0),
        "payload": _json_or_raw(item.payload_json),
        "result": _json_or_raw(item.result_json),
        "error": _json_or_raw(item.error_json),
        "created_at": item.created_at.isoformat(),
        "available_at": item.available_at.isoformat() if item.available_at else None,
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
    }


def serialize_ingest_job(job: Any) -> dict[str, Any]:
    return {
        "id": job.id,
        "batch_id": job.batch_id,
        "user_id": job.user_id,
        "provider": job.provider,
        "job_type": job.job_type,
        "trigger": job.trigger,
        "status": job.status,
        "metric_scope": _json_or_raw(job.metric_scope_json),
        "start_date": job.start_date,
        "end_date": job.end_date,
        "attempts": int(job.attempts or 0),
        "max_attempts": int(job.max_attempts or 0),
        "payload": _json_or_raw(job.payload_json),
        "result": _json_or_raw(job.result_json),
        "error": _json_or_raw(job.error_json),
        "idempotency_key": job.idempotency_key,
        "sync_run_id": job.sync_run_id,
        "created_at": job.created_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


def serialize_raw_payload(payload: Any) -> dict[str, Any]:
    return {
        "id": payload.id,
        "user_id": payload.user_id,
        "provider": payload.provider,
        "direction": payload.direction,
        "external_id": payload.external_id,
        "payload_sha256": payload.payload_sha256,
        "received_at": payload.received_at.isoformat(),
        "expires_at": payload.expires_at.isoformat() if payload.expires_at else None,
        "normalization_error": _json_or_raw(payload.normalization_error_json),
    }


def require_internal_key(internal_key: Optional[str]) -> None:
    expected_internal_key = os.getenv("INTERNAL_API_KEY")
    if not expected_internal_key:
        logger.error("INTERNAL_API_KEY is not configured")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")
    if internal_key != expected_internal_key:
        raise HTTPException(status_code=403, detail="Invalid internal API key")


def normalize_metric_preferences_v2(
    settings: Optional[dict[str, Any]],
    allowed_metric_types: set[str],
) -> dict[str, dict[str, str]]:
    normalized_preferences: dict[str, dict[str, str]] = {}
    settings = settings or {}

    raw_v2 = settings.get("metric_preferences_v2")
    if isinstance(raw_v2, dict):
        for metric_type, raw_preference in raw_v2.items():
            if metric_type not in allowed_metric_types:
                continue
            sync_mode = ""
            if isinstance(raw_preference, dict):
                sync_mode = str(raw_preference.get("sync_mode", "")).strip().lower()
            elif isinstance(raw_preference, str):
                sync_mode = raw_preference.strip().lower()
            if sync_mode in VALID_METRIC_SYNC_MODES:
                normalized_preferences[metric_type] = {"sync_mode": sync_mode}

    if normalized_preferences:
        return normalized_preferences

    raw_selected = settings.get("metric_preferences", [])
    if isinstance(raw_selected, list):
        for metric_type in raw_selected:
            if isinstance(metric_type, str) and metric_type in allowed_metric_types:
                normalized_preferences[metric_type] = {
                    "sync_mode": default_apple_metric_sync_mode(metric_type)
                }

    return normalized_preferences


def selected_metrics_from_preferences(
    preferences: dict[str, dict[str, str]]
) -> list[str]:
    return sorted(
        metric_type
        for metric_type, preference in preferences.items()
        if preference.get("sync_mode") in {"daily_only", "granular"}
    )


def build_tracked_metrics_contract(
    preferences: dict[str, dict[str, str]],
    habit_metric_types: set[str],
) -> dict[str, dict[str, Any]]:
    from services.wearables_unified import build_wearable_sync_plan

    metrics: dict[str, dict[str, Any]] = {
        metric_type: {
            "sync_mode": preference.get("sync_mode", default_apple_metric_sync_mode(metric_type)),
            "sync_plan": build_wearable_sync_plan(
                provider="apple_health",
                metric_type=metric_type,
                sync_mode=preference.get("sync_mode", default_apple_metric_sync_mode(metric_type)),
                projects_to_habit_logs=False,
            ),
        }
        for metric_type, preference in preferences.items()
        if preference.get("sync_mode") in {"daily_only", "granular"}
    }

    for metric_type in sorted(habit_metric_types):
        metrics.setdefault(
            metric_type,
            {
                "sync_mode": default_apple_metric_sync_mode(metric_type),
                "sync_plan": build_wearable_sync_plan(
                    provider="apple_health",
                    metric_type=metric_type,
                    sync_mode=default_apple_metric_sync_mode(metric_type),
                    projects_to_habit_logs=True,
                ),
            },
        )
        if "sync_plan" in metrics[metric_type]:
            metrics[metric_type]["sync_plan"]["projects_to_habit_logs"] = True

    return metrics


def decode_projection_source_priority(raw_value: Any) -> list[str]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value) if isinstance(raw_value, str) else raw_value
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [
        str(source).strip().lower()
        for source in parsed
        if str(source).strip()
    ]


def apple_owned_habit_metric_types(
    habit_policy_rows: list[tuple[Any, Any]],
    allowed_metric_types: set[str],
) -> set[str]:
    owned_metric_types: set[str] = set()
    for habit, policy in habit_policy_rows:
        metric_type = str(getattr(habit, "metric_type", "") or "").strip().lower()
        if not metric_type or metric_type not in allowed_metric_types:
            continue
        integration_source = str(getattr(habit, "integration_source", "") or "").strip().lower()
        if integration_source == "apple_health":
            owned_metric_types.add(metric_type)
            continue
        priority = decode_projection_source_priority(
            getattr(policy, "projection_source_priority_json", None)
        )
        if priority and priority[0] == "apple_health":
            owned_metric_types.add(metric_type)
    return owned_metric_types


def parse_metric_preferences_payload(
    body: dict[str, Any],
    allowed_metric_types: set[str],
) -> dict[str, dict[str, str]]:
    if not isinstance(body, dict):
        raise ValueError("request body must be an object")

    if "preferences" in body:
        raw_preferences = body.get("preferences")
        if not isinstance(raw_preferences, dict):
            raise ValueError("preferences must be an object")

        normalized_preferences: dict[str, dict[str, str]] = {}
        invalid_metric_types = [
            metric_type for metric_type in raw_preferences.keys() if metric_type not in allowed_metric_types
        ]
        if invalid_metric_types:
            raise ValueError(f"Unknown metric types: {sorted(invalid_metric_types)}")

        for metric_type, raw_preference in raw_preferences.items():
            if not isinstance(raw_preference, dict):
                raise ValueError(f"Preference for '{metric_type}' must be an object")
            sync_mode = str(raw_preference.get("sync_mode", "")).strip().lower()
            if sync_mode not in VALID_METRIC_SYNC_MODES:
                raise ValueError(
                    f"Preference for '{metric_type}' must include sync_mode in {sorted(VALID_METRIC_SYNC_MODES)}"
                )
            normalized_preferences[metric_type] = {"sync_mode": sync_mode}
        return normalized_preferences

    raw_selected = body.get("selected_metrics", [])
    if not isinstance(raw_selected, list):
        raise ValueError("selected_metrics must be an array")

    invalid_metric_types = [
        metric_type
        for metric_type in raw_selected
        if not isinstance(metric_type, str) or metric_type not in allowed_metric_types
    ]
    if invalid_metric_types:
        raise ValueError(f"Unknown metric types: {sorted(str(metric_type) for metric_type in invalid_metric_types)}")

    return {
        metric_type: {"sync_mode": default_apple_metric_sync_mode(metric_type)}
        for metric_type in dict.fromkeys(raw_selected)
    }
