"""Provider capabilities and wearable sync planning helpers."""

from .common import *

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
