"""Unified wearable service modules."""

from .capabilities import (
    APPLE_METRIC_TYPE_ALIASES,
    BUCKET_15M_RETENTION_DAYS,
    BUCKET_1H_RETENTION_DAYS,
    EVENT_LIKE_METRICS,
    HEART_LIKE_METRICS,
    INTERNAL_WEARABLE_SIGNAL_MAX_AGE_DAYS,
    PROVIDER_CAPABILITIES,
    PROVIDER_PRIORITY_RANKS,
    RAW_PAYLOAD_TTL_DAYS,
    RAW_RETENTION_DAYS,
    RECOVERY_SIGNAL_METRICS,
    SOURCE_KIND_PRIORITY_RANKS,
    STEPS_LIKE_METRICS,
    ProviderCapabilityDef,
    _default_source_priority_rank,
    build_wearable_sync_plan,
    default_sync_mode_for_provider_metric,
)
from .connection import WearableConnectionService
from .normalization import WearableNormalizationService
from .outbox import build_wearable_outbox_event_for_event, build_wearable_outbox_event_for_sample
from .projection import WearableProjectionService
from .query import WearableQueryService
from .singletons import (
    normalization_service,
    wearable_connection_service,
    wearable_projection_service,
    wearable_query_service,
    wearable_sync_service,
)
from .sync import WearableSyncService

__all__ = [
    "APPLE_METRIC_TYPE_ALIASES",
    "BUCKET_15M_RETENTION_DAYS",
    "BUCKET_1H_RETENTION_DAYS",
    "EVENT_LIKE_METRICS",
    "HEART_LIKE_METRICS",
    "INTERNAL_WEARABLE_SIGNAL_MAX_AGE_DAYS",
    "PROVIDER_CAPABILITIES",
    "PROVIDER_PRIORITY_RANKS",
    "RAW_PAYLOAD_TTL_DAYS",
    "RAW_RETENTION_DAYS",
    "RECOVERY_SIGNAL_METRICS",
    "SOURCE_KIND_PRIORITY_RANKS",
    "STEPS_LIKE_METRICS",
    "ProviderCapabilityDef",
    "WearableConnectionService",
    "WearableNormalizationService",
    "WearableProjectionService",
    "WearableQueryService",
    "WearableSyncService",
    "_default_source_priority_rank",
    "build_wearable_outbox_event_for_event",
    "build_wearable_outbox_event_for_sample",
    "build_wearable_sync_plan",
    "default_sync_mode_for_provider_metric",
    "normalization_service",
    "wearable_connection_service",
    "wearable_projection_service",
    "wearable_query_service",
    "wearable_sync_service",
]
