"""Pydantic DTOs for the location tracking service."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


# Source identifiers — keep in sync with services.location.resolver.TIER_RULES
LocationSource = Literal[
    "ios_scls",
    "ios_one_shot",
    "mac_one_shot",
    "mac_bssid_trigger",
    "garmin_workout",
    "manual",
]


class LocationPing(BaseModel):
    """A single position report from a client (iPhone, Mac, wearable).

    `client_ts` is ms since Unix epoch as captured on the client.
    `client_event_id` enables idempotent re-submission.
    """

    model_config = ConfigDict(extra="ignore")

    lat: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    lon: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    horizontal_accuracy_m: Optional[float] = Field(default=None, ge=0.0)
    source: LocationSource
    device_id: Optional[str] = None
    bssid: Optional[str] = None
    ssid: Optional[str] = None
    client_ts: int = Field(..., description="Milliseconds since Unix epoch when client captured")
    client_event_id: str = Field(..., min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_coordinate_shape(self) -> "LocationPing":
        """Coordinates are optional only for Mac Wi-Fi fingerprint pings."""
        has_lat = self.lat is not None
        has_lon = self.lon is not None
        if has_lat != has_lon:
            raise ValueError("lat and lon must either both be present or both be omitted")
        if not has_lat and self.source not in {"mac_one_shot", "mac_bssid_trigger"}:
            raise ValueError("lat/lon are required for coordinate-backed location sources")
        if not has_lat and not (self.bssid or self.ssid):
            raise ValueError("BSSID-only Mac pings must include bssid or ssid")
        return self


class LocationPingBatch(BaseModel):
    """Batch payload for POST /api/user/location-pings."""

    model_config = ConfigDict(extra="ignore")
    pings: list[LocationPing] = Field(default_factory=list)


class ResolvedLocation(BaseModel):
    """Result of resolver.resolve_for(user_id, target_ts).

    Returned to enrichment hooks for attaching to habit logs.
    """

    model_config = ConfigDict(extra="ignore")

    lat: float
    lon: float
    horizontal_accuracy_m: Optional[float] = None
    source: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    signal_age_ms: int = Field(..., ge=0)
    place_label: Optional[str] = None


class IngestResponse(BaseModel):
    """Response from POST /api/user/location-pings."""

    accepted: int
    rejected: int
    duplicates: int
