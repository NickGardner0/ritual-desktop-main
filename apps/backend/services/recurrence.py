"""Deterministic recurrence helpers for routines."""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo


DEFAULT_TIMEZONE = "America/New_York"
VALID_TRIGGER_TYPES = {"daily", "weekly", "monthly", "yearly", "on_completion"}


def utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_timezone(timezone_name: Optional[str]) -> str:
    candidate = (timezone_name or "").strip() or DEFAULT_TIMEZONE
    try:
        ZoneInfo(candidate)
        return candidate
    except Exception:
        return DEFAULT_TIMEZONE


def ensure_utc_naive(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def to_local(value: datetime, timezone_name: str) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(ZoneInfo(normalize_timezone(timezone_name)))


def from_local(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("Local datetime must include tzinfo")
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def start_of_day_local(value: datetime, timezone_name: str) -> datetime:
    local = to_local(value, timezone_name)
    return datetime.combine(local.date(), time.min, tzinfo=local.tzinfo)


def _interval(config: Dict[str, Any], key: str = "interval") -> int:
    try:
        return max(1, int(config.get(key) or 1))
    except Exception:
        return 1


def _time_parts(config: Dict[str, Any]) -> tuple[int, int]:
    try:
        hour = int(config.get("hour") or 9)
    except Exception:
        hour = 9
    try:
        minute = int(config.get("minute") or 0)
    except Exception:
        minute = 0
    return max(0, min(hour, 23)), max(0, min(minute, 59))


def _candidate_on_date(base: datetime, config: Dict[str, Any]) -> datetime:
    hour, minute = _time_parts(config)
    return datetime.combine(base.date(), time(hour=hour, minute=minute), tzinfo=base.tzinfo)


def _add_months(local_dt: datetime, months: int) -> datetime:
    month_index = (local_dt.month - 1) + months
    year = local_dt.year + month_index // 12
    month = (month_index % 12) + 1
    day = min(local_dt.day, monthrange(year, month)[1])
    return local_dt.replace(year=year, month=month, day=day)


def _nth_weekday(year: int, month: int, ordinal: int, weekday: int) -> int:
    ordinal = max(1, min(int(ordinal or 1), 5))
    weekday = max(0, min(int(weekday or 0), 6))
    first_weekday, days_in_month = monthrange(year, month)
    first_offset = (weekday - first_weekday) % 7
    day = 1 + first_offset + (ordinal - 1) * 7
    if day > days_in_month:
        day -= 7
    return day


def _monthly_candidate(base: datetime, config: Dict[str, Any]) -> datetime:
    mode = str(config.get("mode") or config.get("monthlyMode") or "day_of_month")
    hour, minute = _time_parts(config)
    if mode == "nth_weekday":
        day = _nth_weekday(
            base.year,
            base.month,
            int(config.get("ordinal") or 1),
            int(config.get("weekday") or 0),
        )
    else:
        requested_day = int(config.get("day") or config.get("dayOfMonth") or 1)
        day = min(max(1, requested_day), monthrange(base.year, base.month)[1])
    return datetime(base.year, base.month, day, hour, minute, tzinfo=base.tzinfo)


def _yearly_candidate(base: datetime, config: Dict[str, Any]) -> datetime:
    month = min(max(1, int(config.get("month") or 1)), 12)
    hour, minute = _time_parts(config)
    mode = str(config.get("mode") or "day_of_month")
    if mode == "nth_weekday":
        day = _nth_weekday(
            base.year,
            month,
            int(config.get("ordinal") or 1),
            int(config.get("weekday") or 0),
        )
    else:
        requested_day = int(config.get("day") or config.get("dayOfMonth") or 1)
        day = min(max(1, requested_day), monthrange(base.year, month)[1])
    return datetime(base.year, month, day, hour, minute, tzinfo=base.tzinfo)


def _next_daily(after_local: datetime, anchor_local: datetime, config: Dict[str, Any]) -> datetime:
    interval = _interval(config)
    cursor = _candidate_on_date(anchor_local, config)
    if cursor <= after_local:
        days = max(0, (after_local.date() - cursor.date()).days)
        steps = days // interval
        cursor = cursor + timedelta(days=steps * interval)
        while cursor <= after_local:
            cursor += timedelta(days=interval)
    return cursor


def _next_weekly(after_local: datetime, anchor_local: datetime, config: Dict[str, Any]) -> datetime:
    interval = _interval(config)
    raw_weekdays = config.get("weekdays")
    weekdays = sorted({int(day) for day in raw_weekdays}) if isinstance(raw_weekdays, list) and raw_weekdays else [anchor_local.weekday()]
    anchor_week_start = anchor_local.date() - timedelta(days=anchor_local.weekday())
    cursor_date = after_local.date()
    for offset in range(0, 371):
        candidate_date = cursor_date + timedelta(days=offset)
        week_delta = (candidate_date - anchor_week_start).days // 7
        if week_delta % interval != 0 or candidate_date.weekday() not in weekdays:
            continue
        candidate = _candidate_on_date(datetime.combine(candidate_date, time.min, tzinfo=after_local.tzinfo), config)
        if candidate > after_local:
            return candidate
    raise ValueError("Could not resolve next weekly run")


def _next_monthly(after_local: datetime, anchor_local: datetime, config: Dict[str, Any]) -> datetime:
    interval = _interval(config)
    cursor = datetime(after_local.year, after_local.month, 1, tzinfo=after_local.tzinfo)
    anchor_index = anchor_local.year * 12 + anchor_local.month
    for offset in range(0, 240):
        month_cursor = _add_months(cursor, offset)
        month_index = month_cursor.year * 12 + month_cursor.month
        if (month_index - anchor_index) % interval != 0:
            continue
        candidate = _monthly_candidate(month_cursor, config)
        if candidate > after_local:
            return candidate
    raise ValueError("Could not resolve next monthly run")


def _next_yearly(after_local: datetime, anchor_local: datetime, config: Dict[str, Any]) -> datetime:
    interval = _interval(config)
    for offset in range(0, 80):
        year = after_local.year + offset
        if (year - anchor_local.year) % interval != 0:
            continue
        candidate = _yearly_candidate(datetime(year, 1, 1, tzinfo=after_local.tzinfo), config)
        if candidate > after_local:
            return candidate
    raise ValueError("Could not resolve next yearly run")


def next_run_at(
    *,
    trigger_type: str,
    trigger_config: Dict[str, Any],
    timezone_name: str,
    reference_utc: Optional[datetime] = None,
    first_run_at: Optional[datetime] = None,
    ends_at: Optional[datetime] = None,
    last_completed_at: Optional[datetime] = None,
) -> Optional[datetime]:
    """Return the next run as a naive UTC datetime."""

    if trigger_type not in VALID_TRIGGER_TYPES:
        raise ValueError(f"Unsupported trigger_type: {trigger_type}")

    reference = ensure_utc_naive(reference_utc) or utc_now_naive()
    end = ensure_utc_naive(ends_at)
    if end is not None and end <= reference:
        return None

    tz = normalize_timezone(timezone_name)
    config = trigger_config or {}

    if trigger_type == "on_completion":
        base = ensure_utc_naive(last_completed_at) or ensure_utc_naive(first_run_at) or reference
        unit = str(config.get("unit") or "days")
        interval = _interval(config, key="interval")
        if unit.startswith("week"):
            candidate = base + timedelta(weeks=interval)
        elif unit.startswith("month"):
            local_base = to_local(base, tz)
            candidate = from_local(_add_months(local_base, interval))
        else:
            candidate = base + timedelta(days=interval)
        if candidate <= reference and last_completed_at is None:
            candidate = reference
        return None if end is not None and candidate > end else candidate

    first = ensure_utc_naive(first_run_at)
    anchor_utc = first or reference
    after_utc = max(reference, first - timedelta(seconds=1) if first else reference)
    after_local = to_local(after_utc, tz)
    anchor_local = to_local(anchor_utc, tz)

    if trigger_type == "daily":
        candidate_local = _next_daily(after_local, anchor_local, config)
    elif trigger_type == "weekly":
        candidate_local = _next_weekly(after_local, anchor_local, config)
    elif trigger_type == "monthly":
        candidate_local = _next_monthly(after_local, anchor_local, config)
    else:
        candidate_local = _next_yearly(after_local, anchor_local, config)

    candidate = from_local(candidate_local)
    if end is not None and candidate > end:
        return None
    return candidate


def next_run_preview(
    *,
    trigger_type: str,
    trigger_config: Dict[str, Any],
    timezone_name: str,
    reference_utc: Optional[datetime] = None,
    first_run_at: Optional[datetime] = None,
    ends_at: Optional[datetime] = None,
    last_completed_at: Optional[datetime] = None,
    count: int = 6,
) -> List[datetime]:
    results: List[datetime] = []
    reference = ensure_utc_naive(reference_utc) or utc_now_naive()
    previous_completion = last_completed_at
    for _ in range(max(1, min(count, 24))):
        candidate = next_run_at(
            trigger_type=trigger_type,
            trigger_config=trigger_config,
            timezone_name=timezone_name,
            reference_utc=reference,
            first_run_at=first_run_at,
            ends_at=ends_at,
            last_completed_at=previous_completion,
        )
        if candidate is None:
            break
        results.append(candidate)
        reference = candidate + timedelta(seconds=1)
        if trigger_type == "on_completion":
            previous_completion = candidate
    return results


def humanize_recurrence(trigger_type: str, config: Dict[str, Any]) -> str:
    interval = _interval(config)
    if trigger_type == "daily":
        return "Every day" if interval == 1 else f"Every {interval} days"
    if trigger_type == "weekly":
        weekdays = config.get("weekdays")
        if interval == 1 and weekdays == [0, 1, 2, 3, 4]:
            return "Every weekday"
        if isinstance(weekdays, list) and weekdays:
            labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            selected = [labels[int(day)] for day in weekdays if 0 <= int(day) <= 6]
            return f"Every {' and '.join(selected)}" if interval == 1 else f"Every {interval} weeks on {', '.join(selected)}"
        return "Every week" if interval == 1 else f"Every {interval} weeks"
    if trigger_type == "monthly":
        mode = str(config.get("mode") or "day_of_month")
        if mode == "nth_weekday":
            return f"Every month on the {config.get('ordinal', 1)} weekday" if interval == 1 else f"Every {interval} months"
        day = int(config.get("day") or config.get("dayOfMonth") or 1)
        suffix = "st" if day == 1 else "nd" if day == 2 else "rd" if day == 3 else "th"
        return f"Every month on the {day}{suffix}" if interval == 1 else f"Every {interval} months on the {day}{suffix}"
    if trigger_type == "yearly":
        return "Every year" if interval == 1 else f"Every {interval} years"
    if trigger_type == "on_completion":
        unit = str(config.get("unit") or "days")
        singular = unit[:-1] if unit.endswith("s") else unit
        label = singular if interval == 1 else unit
        return f"{interval} {label} after completion"
    return trigger_type.replace("_", " ")


def normalize_weekdays(values: Iterable[Any]) -> List[int]:
    days = sorted({int(value) for value in values if 0 <= int(value) <= 6})
    return days or [0]
