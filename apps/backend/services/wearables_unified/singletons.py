"""Singleton instances preserving the historical unified wearable service API."""

from .connection import WearableConnectionService
from .normalization import WearableNormalizationService
from .projection import WearableProjectionService
from .query import WearableQueryService
from .sync import WearableSyncService

normalization_service = WearableNormalizationService()
wearable_connection_service = WearableConnectionService()
wearable_projection_service = WearableProjectionService(normalization_service)
wearable_query_service = WearableQueryService(wearable_projection_service)
wearable_sync_service = WearableSyncService(
    wearable_connection_service,
    normalization_service,
    wearable_projection_service,
)
