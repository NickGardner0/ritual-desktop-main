"""Shared imports and runtime configuration for unified wearable services."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import delete, func, select

from database.connection import get_db_session
from database.models import (
    HabitDB,
    HabitLogDB,
    HabitProjectionPolicyDB,
    WearableConnectionDB,
    WearableDeviceDB,
    WearableEventDB,
    WearableIngestJobBatchDB,
    WearableIngestJobDB,
    WearableMetricDB,
    WearableRawPayloadDB,
    WearableSampleDB,
    WearableSourceDB,
    WearableSyncCursorDB,
    WearableSyncRunDB,
)
from services.token_crypto import token_crypto

logger = logging.getLogger(__name__)

WEARABLE_DAILY_TOTALS_OBJECT_LOAD_MAX_DAYS = max(
    1,
    int(os.getenv("WEARABLE_DAILY_TOTALS_OBJECT_LOAD_MAX_DAYS", "120") or "120"),
)
