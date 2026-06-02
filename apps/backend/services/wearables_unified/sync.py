"""Wearable sync service composition."""

from .common import *
from .connection import WearableConnectionService
from .normalization import WearableNormalizationService
from .projection import WearableProjectionService
from .sync_apple import WearableAppleSyncMixin
from .sync_garmin import WearableGarminSyncMixin
from .sync_lifecycle import WearableSyncLifecycleMixin
from .sync_oura import WearableOuraSyncMixin
from .sync_persistence import WearableSyncPersistenceMixin
from .sync_whoop import WearableWhoopSyncMixin


class WearableSyncService(
    WearableSyncLifecycleMixin,
    WearableAppleSyncMixin,
    WearableWhoopSyncMixin,
    WearableOuraSyncMixin,
    WearableGarminSyncMixin,
    WearableSyncPersistenceMixin,
):
    def __init__(
        self,
        connection_service: WearableConnectionService,
        normalization: WearableNormalizationService,
        projection_service: WearableProjectionService,
    ):
        self.connection_service = connection_service
        self.normalization = normalization
        self.projection_service = projection_service
