"""Canonical interpretation of raw habit logs for daily product analytics."""

from __future__ import annotations

import hashlib
import logging
import math
import os
from typing import Any, Dict, Iterable, Optional


logger = logging.getLogger(__name__)

COMPLETED_STATUSES = frozenset({"", "completed", "success"})
SLEEP_ALIASES = frozenset({"sleep", "sleep_session", "sleep_duration", "sleep_total", "in_bed"})
WEARABLE_PROVIDERS = frozenset({"apple_health", "whoop", "oura", "fitbit", "garmin"})


def normalize_metric_key(value: Optional[str], *, habit_name: Optional[str] = None) -> str:
    raw = (value or "").strip().lower()
    name = (habit_name or "").strip().lower()
    if raw in SLEEP_ALIASES or ("sleep" in name and raw in {"", "none"}):
        return "sleep_total"
    if raw in {"daily_spending", "spending"}:
        return "daily_spending"
    if raw in {"computer_use", "computer_time"}:
        return "computer_time"
    if raw in {"iphone_time", "iphone_screen_time", "screen_time"} or ("iphone" in name and "time" in name):
        return "iphone_time"
    if not raw:
        return name.replace(" ", "_") or "manual"
    return raw


def is_sleep_like(habit: Any) -> bool:
    metric = normalize_metric_key(getattr(habit, "metric_type", None), habit_name=getattr(habit, "name", None))
    if metric == "sleep_total" or "sleep" in (getattr(habit, "name", None) or "").lower():
        return True
    category = (getattr(habit, "category", None) or "").strip().lower()
    provider = (getattr(habit, "integration_source", None) or "").strip().lower()
    return "sleep" in category and provider in WEARABLE_PROVIDERS


def is_completed_status(status: Optional[str]) -> bool:
    return (status or "").strip().lower() in COMPLETED_STATUSES


def target_unit(habit: Any, fallback: str = "count") -> str:
    return str(getattr(habit, "unit_type", None) or fallback or "count")


def _unit_kind(unit: Optional[str]) -> str:
    normalized = (unit or "").strip().lower()
    if "hour" in normalized or normalized in {"hr", "hrs", "h"}:
        return "hours"
    if "minute" in normalized or normalized in {"min", "mins", "m"}:
        return "minutes"
    if normalized in {"ms", "millisecond", "milliseconds"}:
        return "milliseconds"
    if "second" in normalized or normalized in {"sec", "secs", "s"}:
        return "seconds"
    if "dollar" in normalized or normalized in {"usd", "$"}:
        return "dollars"
    return normalized or "count"


def convert_value(value: float, from_unit: Optional[str], to_unit: Optional[str], metric_key: str) -> float:
    source = _unit_kind(from_unit)
    target = _unit_kind(to_unit)
    if not math.isfinite(value):
        return 0.0
    if source == target or target in {"", "count"}:
        return float(value)

    seconds: Optional[float] = None
    if source == "hours":
        seconds = value * 3600
    elif source == "minutes":
        seconds = value * 60
    elif source == "seconds":
        seconds = value
    elif source == "milliseconds":
        seconds = value / 1000

    if seconds is not None:
        if target == "hours":
            return seconds / 3600
        if target == "minutes":
            return seconds / 60
        if target == "seconds":
            return seconds

    if metric_key == "sleep_total" and source == "minutes" and target == "hours":
        return value / 60
    return float(value)


def log_value_for_habit(habit: Any, log: Any) -> float:
    """Return one typed sample value, preserving legacy duration precedence."""
    duration = getattr(log, "duration", None)
    amount = getattr(log, "amount", None)
    if duration is not None and amount is not None:
        logger.info(
            "habit_daily_policy ambiguous_log both_values habit=%s log=%s",
            getattr(habit, "id", None),
            getattr(log, "id", None),
        )
    elif duration is None and amount is None:
        logger.info(
            "habit_daily_policy occurrence_log neither_value habit=%s log=%s",
            getattr(habit, "id", None),
            getattr(log, "id", None),
        )

    if duration and duration > 0:
        unit = target_unit(habit).lower()
        if "hour" in unit:
            return float(duration) / 3600
        if "minute" in unit:
            return float(duration) / 60
        return float(duration)
    if amount is not None:
        return float(amount)
    return 1.0


def aggregate_logs_by_date(habit: Any, logs: Iterable[Any]) -> Dict[str, Dict[str, Any]]:
    """Reduce completed logs to the response shape used by analytics consumers."""
    result: Dict[str, Dict[str, Any]] = {}
    use_max = is_sleep_like(habit)
    for log in logs:
        if not is_completed_status(getattr(log, "status", None)):
            continue
        date_value = str(getattr(log, "date", "") or "")[:10]
        if not date_value:
            continue
        duration = getattr(log, "duration", None)
        amount = getattr(log, "amount", None)
        value = log_value_for_habit(habit, log)
        bucket = result.setdefault(
            date_value,
            {"value": 0.0, "entries": 0, "duration_seconds": 0.0, "amount": 0.0},
        )
        bucket["value"] = (
            value
            if use_max and int(bucket["entries"]) == 0
            else max(float(bucket["value"]), value) if use_max
            else float(bucket["value"]) + value
        )
        bucket["entries"] = int(bucket["entries"]) + 1
        if duration and duration > 0:
            if use_max:
                bucket["duration_seconds"] = max(float(bucket["duration_seconds"]), float(duration))
            else:
                bucket["duration_seconds"] = float(bucket["duration_seconds"]) + float(duration)
        elif amount is not None:
            if use_max:
                bucket["amount"] = (
                    float(amount)
                    if int(bucket["entries"]) == 1 and not (duration and duration > 0)
                    else max(float(bucket["amount"]), float(amount))
                )
            else:
                bucket["amount"] = float(bucket["amount"]) + float(amount)

    return result


def daily_policy_v2_enabled(subject_id: Optional[str]) -> bool:
    raw = os.getenv("RITUAL_DAILY_POLICY_V2", "0").strip().lower()
    if raw in {"", "0", "false", "off", "no"}:
        return False
    if raw in {"true", "on", "yes"}:
        percentage = 100
    else:
        try:
            percentage = max(0, min(100, int(raw.rstrip("%"))))
        except ValueError:
            logger.warning("Ignoring invalid RITUAL_DAILY_POLICY_V2 value %r", raw)
            return False
    if percentage >= 100:
        return True
    digest = hashlib.sha256((subject_id or "anonymous").encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % 100 < percentage


def log_shadow_mismatch(*, consumer: str, subject_id: Optional[str], legacy: Any, canonical: Any) -> None:
    if legacy != canonical:
        logger.info(
            "habit_daily_policy shadow_mismatch consumer=%s subject=%s legacy=%r canonical=%r",
            consumer,
            subject_id,
            legacy,
            canonical,
        )
