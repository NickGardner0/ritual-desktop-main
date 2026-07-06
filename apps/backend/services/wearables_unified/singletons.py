"""Singleton instances preserving the historical unified wearable service API."""

from .apple_ingest import WearableAppleIngestService
from .connection import WearableConnectionService
from .device_security import WearableDeviceSecurityService
from .normalization import WearableNormalizationService
from .projection import WearableProjectionService
from .query import WearableQueryService
from .sync import WearableSyncService

normalization_service = WearableNormalizationService()
wearable_connection_service = WearableConnectionService()
wearable_device_security_service = WearableDeviceSecurityService(wearable_connection_service)
wearable_projection_service = WearableProjectionService(normalization_service)
wearable_query_service = WearableQueryService(wearable_projection_service)
wearable_sync_service = WearableSyncService(
    wearable_connection_service,
    normalization_service,
    wearable_projection_service,
)
wearable_apple_ingest_service = WearableAppleIngestService(
    device_security_service=wearable_device_security_service,
    sync_service=wearable_sync_service,
)
