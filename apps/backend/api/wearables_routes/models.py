"""Request models shared by wearable route modules."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class WearableSyncSettingsUpdateRequest(BaseModel):
    auto_sync_enabled: bool
    sync_hour: Optional[int] = None


class ScheduledWearableSyncRequest(BaseModel):
    hour: Optional[int] = None
    days_back: Optional[int] = None
    force_full_sync: bool = False
