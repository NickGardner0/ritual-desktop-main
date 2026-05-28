"""Location tracking service: ingest pings, resolve current location, enrich habit logs.

See plan-location-tracking.md for full architecture.
"""

from services.location.models import (
    LocationPing,
    LocationPingBatch,
    LocationSource,
    ResolvedLocation,
)
from services.location.ingest import IngestResult, ingest_location_pings
from services.location.resolver import resolve_for, resolve_many_for
from services.location.enrichment import enrich_habit_log
from services.location.backfill import backfill_recent_location_for_user

__all__ = [
    "LocationPing",
    "LocationPingBatch",
    "LocationSource",
    "ResolvedLocation",
    "IngestResult",
    "ingest_location_pings",
    "resolve_for",
    "resolve_many_for",
    "enrich_habit_log",
    "backfill_recent_location_for_user",
]
