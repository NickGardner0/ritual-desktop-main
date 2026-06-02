"""Internal wearable signal outbox payload builders."""

from .common import *
from .capabilities import INTERNAL_WEARABLE_SIGNAL_MAX_AGE_DAYS, RECOVERY_SIGNAL_METRICS

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
