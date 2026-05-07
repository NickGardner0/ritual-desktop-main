"""Canonical wearable metric and log normalization helpers."""

from .common import *

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

