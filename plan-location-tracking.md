# Location Tracking for Ritual — Implementation Plan

**Goal:** Every habit log gets a `location` attached to it, automatically, with ~95%+ coverage for the primary user (you), zero per-log friction, and a privacy story that holds up.

**Strategy in one sentence:** iPhone runs Significant-Change Location Service (SCLS) as the always-on primary stream; Mac runs Wi-Fi BSSID-triggered one-shot location fixes as a fallback; backend resolves "where was the user at log timestamp T" by picking the freshest signal and attaches it to every habit log on write.

---

## Table of Contents
1. [Architecture overview](#1-architecture-overview)
2. [Data model & migration](#2-data-model--migration)
3. [Backend: ingest endpoints + resolver](#3-backend-ingest-endpoints--resolver)
4. [iOS: LocationManager service + SCLS](#4-ios-locationmanager-service--scls)
5. [Mac: BSSID monitoring + one-shot CLLocation](#5-mac-bssid-monitoring--one-shot-cllocation)
6. [Habit log enrichment hook](#6-habit-log-enrichment-hook)
7. [Privacy, retention, encryption](#7-privacy-retention-encryption)
8. [Testing strategy](#8-testing-strategy)
9. [Rollout phases](#9-rollout-phases)
10. [Future enhancements](#10-future-enhancements-not-in-v1)
11. [File touch list](#11-file-touch-list)

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          iPhone (iOS)                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LocationManager (new)                                   │   │
│  │   • CLLocationManager + startMonitoringSignificantLocationChanges
│  │   • "Always" authorization                               │   │
│  │   • Fires on cell tower change (~500m movement)          │   │
│  │   • Survives app termination (iOS background-launches)   │   │
│  │   • Buffers offline → flushes to backend on next sync    │   │
│  └────────────────────┬─────────────────────────────────────┘   │
│                       │ POST /api/user/location-pings           │
└───────────────────────┼─────────────────────────────────────────┘
                        │
┌───────────────────────┼─────────────────────────────────────────┐
│                       │           Mac (Tauri)                   │
│  ┌────────────────────▼─────────────────────────────────────┐   │
│  │  LocationManager Rust module (new) in watcher sidecar    │   │
│  │   • CLLocationManager.requestLocation() one-shot         │   │
│  │   • Triggered on: app launch + BSSID change + 30m timer  │   │
│  │   • CWInterface SSID/BSSID notifications via CWWiFiClient│   │
│  │   • Buffers offline → flushes on network resume          │   │
│  └────────────────────┬─────────────────────────────────────┘   │
│                       │ POST /api/user/location-pings           │
└───────────────────────┼─────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              Backend (FastAPI + Turso)                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  POST /api/user/location-pings                           │   │
│  │   → writes to user_location_pings table                  │   │
│  │   → updates user_location_state (materialized current)   │   │
│  │                                                          │   │
│  │  location_resolver.resolve_for(user_id, ts)              │   │
│  │   → picks freshest among:                                │   │
│  │      ios_scls / mac_one_shot / garmin_workout / default  │   │
│  │   → returns (lat, lon, accuracy_m, source, confidence)   │   │
│  │                                                          │   │
│  │  HabitLog ingest hook                                    │   │
│  │   → on every habit log create/update                     │   │
│  │   → call resolver(user, log.completed_at)                │   │
│  │   → write to habit_logs.location_* columns               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key invariants:**
- Backend is the single source of truth for "current location of user X" — clients are dumb emitters.
- Location resolution happens **server-side at habit log creation time**, never client-side. This means a log from SendBlue/iMessage gets the same location enrichment as a log from the iOS app.
- Raw `(lat, lon)` and reverse-geocoded "place label" are both stored — labels are the long-term value, raw coords have a TTL (see [§7](#7-privacy-retention-encryption)).

---

## 2. Data model & migration

### 2.1 New tables

Two new tables. Mirror the existing SQLAlchemy patterns in `apps/backend/database/models.py`.

**`user_location_pings`** — append-only event log of every position report from any client.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `user_id` | TEXT NOT NULL | matches `HabitLogDB.user_id` convention |
| `lat` | REAL NOT NULL | WGS84 latitude |
| `lon` | REAL NOT NULL | WGS84 longitude |
| `horizontal_accuracy_m` | REAL | Core Location reports this; null if unavailable |
| `source` | TEXT NOT NULL | `ios_scls` / `mac_one_shot` / `mac_bssid_trigger` / `garmin_workout` / `manual` |
| `device_id` | TEXT | matches existing `device_id` pattern from watcher |
| `bssid` | TEXT | optional, Mac-only — for Wi-Fi fingerprint deduplication |
| `ssid` | TEXT | optional, Mac-only |
| `client_ts` | INTEGER NOT NULL | ms-since-epoch when client captured |
| `server_ts` | INTEGER NOT NULL | ms-since-epoch when backend received |
| `client_event_id` | TEXT UNIQUE | idempotency key — same pattern as `HabitLogDB.client_event_id` |
| `raw_payload` | TEXT (JSON) | full client payload for debugging / future fields |

Indexes:
- `(user_id, client_ts DESC)` — for resolver "freshest signal" lookups
- `(user_id, source, client_ts DESC)` — for per-source freshness queries
- `UNIQUE(client_event_id)` — idempotency

**`user_location_state`** — materialized "current location" per user. One row per user, updated by ingest endpoint.

| Column | Type | Notes |
|---|---|---|
| `user_id` | TEXT PK | one row per user |
| `lat` | REAL NOT NULL | |
| `lon` | REAL NOT NULL | |
| `horizontal_accuracy_m` | REAL | |
| `source` | TEXT NOT NULL | which source produced this snapshot |
| `ping_client_ts` | INTEGER NOT NULL | when client captured (the freshness signal) |
| `updated_at` | INTEGER NOT NULL | when this row was last written |
| `place_label` | TEXT | reverse-geocoded label, e.g. `"Home"`, `"Equinox Brooklyn"`, `"Prospect Park"` |
| `place_confidence` | REAL | 0.0–1.0 |

Indexed on PK only. This table is small (one row per user) and read-hot — keep it lean.

### 2.2 Add location columns to `habit_logs`

Extend `HabitLogDB` in `apps/backend/database/models.py`:

```python
# ─── location enrichment ──────────────────────────────
location_lat = Column(Float, nullable=True)
location_lon = Column(Float, nullable=True)
location_accuracy_m = Column(Float, nullable=True)
location_source = Column(String, nullable=True)
location_place_label = Column(String, nullable=True)
location_confidence = Column(Float, nullable=True)
location_resolved_at = Column(BigInteger, nullable=True)  # ms epoch
location_signal_age_ms = Column(BigInteger, nullable=True)  # how stale was the signal when resolved
```

All nullable — backfill is not required, and logs from before this feature ships stay null.

### 2.3 Alembic migration

Create `apps/backend/migrations/versions/20260526_0001_add_location_tracking.py` following the pattern in the baseline migration `20260524_0001_legacy_runtime_schema.py`.

```python
"""add location tracking tables and habit_log location columns

Revision ID: 20260526_0001
Revises: 20260524_0001
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa

revision = "20260526_0001"
down_revision = "20260524_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_location_pings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.String, nullable=False),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lon", sa.Float, nullable=False),
        sa.Column("horizontal_accuracy_m", sa.Float),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("device_id", sa.String),
        sa.Column("bssid", sa.String),
        sa.Column("ssid", sa.String),
        sa.Column("client_ts", sa.BigInteger, nullable=False),
        sa.Column("server_ts", sa.BigInteger, nullable=False),
        sa.Column("client_event_id", sa.String, unique=True),
        sa.Column("raw_payload", sa.Text),
    )
    op.create_index("ix_loc_pings_user_ts", "user_location_pings", ["user_id", "client_ts"])
    op.create_index("ix_loc_pings_user_source_ts", "user_location_pings", ["user_id", "source", "client_ts"])

    op.create_table(
        "user_location_state",
        sa.Column("user_id", sa.String, primary_key=True),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lon", sa.Float, nullable=False),
        sa.Column("horizontal_accuracy_m", sa.Float),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("ping_client_ts", sa.BigInteger, nullable=False),
        sa.Column("updated_at", sa.BigInteger, nullable=False),
        sa.Column("place_label", sa.String),
        sa.Column("place_confidence", sa.Float),
    )

    with op.batch_alter_table("habit_logs") as batch:
        batch.add_column(sa.Column("location_lat", sa.Float))
        batch.add_column(sa.Column("location_lon", sa.Float))
        batch.add_column(sa.Column("location_accuracy_m", sa.Float))
        batch.add_column(sa.Column("location_source", sa.String))
        batch.add_column(sa.Column("location_place_label", sa.String))
        batch.add_column(sa.Column("location_confidence", sa.Float))
        batch.add_column(sa.Column("location_resolved_at", sa.BigInteger))
        batch.add_column(sa.Column("location_signal_age_ms", sa.BigInteger))


def downgrade():
    with op.batch_alter_table("habit_logs") as batch:
        for col in (
            "location_lat", "location_lon", "location_accuracy_m",
            "location_source", "location_place_label", "location_confidence",
            "location_resolved_at", "location_signal_age_ms",
        ):
            batch.drop_column(col)
    op.drop_table("user_location_state")
    op.drop_index("ix_loc_pings_user_source_ts", table_name="user_location_pings")
    op.drop_index("ix_loc_pings_user_ts", table_name="user_location_pings")
    op.drop_table("user_location_pings")
```

**Turso/libSQL note:** since the runtime DB is Turso (libSQL-flavored SQLite), confirm the migration runs cleanly. `batch_alter_table` is correct for SQLite.

---

## 3. Backend: ingest endpoints + resolver

### 3.1 New service module: `apps/backend/services/location/`

Mirror the layout of `services/wearables_unified/`:

```
apps/backend/services/location/
├── __init__.py
├── models.py          # Pydantic DTOs for ping payloads
├── ingest.py          # write ping + update state
├── resolver.py        # the "freshest signal" picker
├── geocoder.py        # reverse geocode lat/lon → place label
├── enrichment.py      # habit-log enrichment helper
├── retention.py       # TTL cleanup job
└── util.py            # haversine + helpers
```

### 3.2 Pydantic DTOs (`services/location/models.py`)

```python
from pydantic import BaseModel, Field
from typing import Optional, Literal

LocationSource = Literal[
    "ios_scls", "ios_one_shot",
    "mac_one_shot", "mac_bssid_trigger",
    "garmin_workout", "manual",
]

class LocationPing(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    horizontal_accuracy_m: Optional[float] = None
    source: LocationSource
    device_id: Optional[str] = None
    bssid: Optional[str] = None
    ssid: Optional[str] = None
    client_ts: int  # ms since epoch
    client_event_id: str  # for idempotency

class LocationPingBatch(BaseModel):
    pings: list[LocationPing]

class ResolvedLocation(BaseModel):
    lat: float
    lon: float
    horizontal_accuracy_m: Optional[float]
    source: LocationSource
    confidence: float
    signal_age_ms: int
    place_label: Optional[str] = None
```

### 3.3 Ingest endpoint (`api/location.py` — new router)

```python
from fastapi import APIRouter, Depends
from services.location.models import LocationPingBatch
from services.location.ingest import ingest_location_pings
from auth import get_current_user  # same pattern as other routers

router = APIRouter(prefix="/api/user", tags=["location"])

@router.post("/location-pings", status_code=202)
async def post_location_pings(
    batch: LocationPingBatch,
    user = Depends(get_current_user),
):
    result = await ingest_location_pings(user.id, batch.pings)
    return {
        "accepted": result.accepted,
        "rejected": result.rejected,
        "duplicates": result.duplicates,
    }
```

Register in `apps/backend/main.py` (or wherever routers are wired) → `app.include_router(location.router)`.

### 3.4 Ingest implementation (`services/location/ingest.py`)

Core responsibilities:
1. Validate each ping (already done by Pydantic).
2. Insert into `user_location_pings` with `INSERT OR IGNORE` on `client_event_id` for idempotency.
3. For the freshest ping in the batch, update `user_location_state` (only if its `client_ts` > current state's `ping_client_ts`).
4. Trigger async reverse-geocode if `user_location_state.lat/lon` moved >100m from last labeled position.

```python
import json, time
from dataclasses import dataclass
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from database.models import UserLocationPingDB, UserLocationStateDB
from services.location.models import LocationPing
from services.location.geocoder import enqueue_reverse_geocode
from services.location.util import haversine_m

@dataclass
class IngestResult:
    accepted: int
    rejected: int
    duplicates: int

async def ingest_location_pings(
    user_id: str,
    pings: list[LocationPing],
) -> IngestResult:
    if not pings:
        return IngestResult(0, 0, 0)

    now_ms = int(time.time() * 1000)
    accepted = duplicates = rejected = 0
    freshest: LocationPing | None = None

    for p in pings:
        # Sanity bounds: drop pings from the future or absurd accuracy
        if p.client_ts > now_ms + 60_000:
            rejected += 1
            continue
        if p.horizontal_accuracy_m and p.horizontal_accuracy_m > 5000:
            rejected += 1
            continue

        stmt = sqlite_insert(UserLocationPingDB).values(
            user_id=user_id,
            lat=p.lat, lon=p.lon,
            horizontal_accuracy_m=p.horizontal_accuracy_m,
            source=p.source,
            device_id=p.device_id,
            bssid=p.bssid, ssid=p.ssid,
            client_ts=p.client_ts,
            server_ts=now_ms,
            client_event_id=p.client_event_id,
            raw_payload=json.dumps(p.model_dump()),
        ).on_conflict_do_nothing(index_elements=["client_event_id"])

        result = await db.execute(stmt)
        if result.rowcount == 0:
            duplicates += 1
        else:
            accepted += 1
            if freshest is None or p.client_ts > freshest.client_ts:
                freshest = p

    if freshest:
        await _maybe_update_state(user_id, freshest, now_ms)

    return IngestResult(accepted, rejected, duplicates)


async def _maybe_update_state(user_id: str, ping: LocationPing, now_ms: int):
    current = await db.get(UserLocationStateDB, user_id)
    if current and current.ping_client_ts >= ping.client_ts:
        return  # we have something fresher already

    moved_significantly = (
        current is None
        or haversine_m(current.lat, current.lon, ping.lat, ping.lon) > 100
    )

    await db.merge(UserLocationStateDB(
        user_id=user_id,
        lat=ping.lat, lon=ping.lon,
        horizontal_accuracy_m=ping.horizontal_accuracy_m,
        source=ping.source,
        ping_client_ts=ping.client_ts,
        updated_at=now_ms,
        place_label=None if moved_significantly else (current.place_label if current else None),
        place_confidence=None if moved_significantly else (current.place_confidence if current else None),
    ))

    if moved_significantly:
        await enqueue_reverse_geocode(user_id, ping.lat, ping.lon)
```

### 3.5 Resolver (`services/location/resolver.py`)

This is the function the habit-log enrichment hook calls. Tiered fallback:

```python
from typing import Optional
from sqlalchemy import select, func
from database.models import UserLocationStateDB, UserLocationPingDB
from services.location.models import ResolvedLocation

# Source priority + freshness windows (ms)
TIER_RULES = [
    # (source, max_age_ms, confidence)
    ("ios_scls",          5  * 60_000, 0.99),
    ("mac_bssid_trigger", 5  * 60_000, 0.98),
    ("mac_one_shot",      10 * 60_000, 0.95),
    ("ios_scls",          15 * 60_000, 0.85),
    ("garmin_workout",    10 * 60_000, 0.75),
    ("mac_one_shot",      30 * 60_000, 0.65),
    ("ios_scls",          60 * 60_000, 0.55),
]

async def resolve_for(user_id: str, target_ts: int) -> Optional[ResolvedLocation]:
    state = await db.get(UserLocationStateDB, user_id)
    if state:
        age = target_ts - state.ping_client_ts
        if 0 <= age <= 60 * 60_000:  # within 1h, take state directly
            return ResolvedLocation(
                lat=state.lat, lon=state.lon,
                horizontal_accuracy_m=state.horizontal_accuracy_m,
                source=state.source,
                confidence=_confidence_for(state.source, age),
                signal_age_ms=age,
                place_label=state.place_label,
            )

    # Fallback: scan pings table within tiered windows
    for source, window, conf in TIER_RULES:
        row = await db.execute(
            select(UserLocationPingDB)
            .where(
                UserLocationPingDB.user_id == user_id,
                UserLocationPingDB.source == source,
                UserLocationPingDB.client_ts.between(target_ts - window, target_ts + window),
            )
            .order_by(func.abs(UserLocationPingDB.client_ts - target_ts))
            .limit(1)
        )
        ping = row.scalar_one_or_none()
        if ping:
            return ResolvedLocation(
                lat=ping.lat, lon=ping.lon,
                horizontal_accuracy_m=ping.horizontal_accuracy_m,
                source=ping.source,
                confidence=conf,
                signal_age_ms=abs(target_ts - ping.client_ts),
            )
    return None


def _confidence_for(source: str, age_ms: int) -> float:
    # Decay confidence linearly across the first hour
    base = {"ios_scls": 0.99, "mac_bssid_trigger": 0.98, "mac_one_shot": 0.95}.get(source, 0.7)
    decay = min(1.0, age_ms / (60 * 60_000)) * 0.3
    return max(0.4, base - decay)
```

### 3.6 Reverse geocoder (`services/location/geocoder.py`)

For v1, use **Apple's MapKit Server-Side API** (free with Apple Developer Program, generous quota, requires JWT) — you're already in the Apple ecosystem. Fallback option is Nominatim (OSM, free, rate-limited at 1 req/s).

```python
import httpx
from sqlalchemy import update
from database.models import UserLocationStateDB

async def reverse_geocode(lat: float, lon: float) -> Optional[str]:
    """Return a short human-friendly label, or None."""
    # Nominatim implementation (swap for MapKit when JWT signing is wired)
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&zoom=18"
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(url, headers={"User-Agent": "RitualApp/1.0"})
        if r.status_code != 200:
            return None
        data = r.json()
        addr = data.get("address", {})
        return (
            data.get("name")
            or addr.get("road")
            or addr.get("suburb")
            or addr.get("city")
            or addr.get("town")
        )

async def enqueue_reverse_geocode(user_id: str, lat: float, lon: float):
    # In v1, run inline. In v2, push to a job queue.
    label = await reverse_geocode(lat, lon)
    if label:
        await db.execute(
            update(UserLocationStateDB)
            .where(UserLocationStateDB.user_id == user_id)
            .values(place_label=label, place_confidence=0.7)
        )
```

### 3.7 Haversine helper (`services/location/util.py`)

```python
import math

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))
```

---

## 4. iOS: LocationManager service + SCLS

### 4.1 Permissions & entitlements

**Info.plist additions** (edit via `apps/ios-companion/Tuist/Project.swift` Info.plist block):

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Ritual tags your habit logs with where you were, so you can see patterns like "I meditate more at home than the office."</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Ritual tags your habit logs with where you were — including logs you create from your Mac or via text. This works in the background with virtually no battery cost.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>Ritual tags your habit logs with where you were, even when the app isn't open.</string>

<key>UIBackgroundModes</key>
<array>
  <string>fetch</string>
  <string>processing</string>
  <string>bluetooth-central</string>
  <string>location</string>     <!-- NEW -->
</array>
```

No new entitlement file changes needed — Core Location doesn't require a paid entitlement, just the Info.plist keys.

### 4.2 New service: `Sources/RitualCompanion/Services/LocationManager.swift`

Mirror the architecture of `HealthKitManagerV2.swift` — class with an `@MainActor` observable interface, async methods, injected via AppState.

```swift
import CoreLocation
import Combine
import Foundation
import OSLog

@MainActor
final class LocationManager: NSObject, ObservableObject {
    static let shared = LocationManager()

    @Published private(set) var authorizationStatus: CLAuthorizationStatus = .notDetermined
    @Published private(set) var lastKnownLocation: CLLocation?
    @Published private(set) var isMonitoringSCLS: Bool = false

    private let logger = Logger(subsystem: "com.ritual.companion", category: "LocationManager")
    private let locationManager = CLLocationManager()
    private let outbox = LocationPingOutbox()
    private let api: RitualAPIClient

    init(api: RitualAPIClient = .shared) {
        self.api = api
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        authorizationStatus = locationManager.authorizationStatus
    }

    // MARK: - Authorization

    func requestAuthorization() {
        switch authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
            // After granting, the delegate will escalate to "Always"
        case .authorizedWhenInUse:
            locationManager.requestAlwaysAuthorization()
        case .authorizedAlways:
            startMonitoring()
        case .denied, .restricted:
            logger.warning("Location authorization denied/restricted")
        @unknown default:
            break
        }
    }

    // MARK: - Monitoring

    func startMonitoring() {
        guard CLLocationManager.significantLocationChangeMonitoringAvailable() else {
            logger.error("SCLS not available on this device")
            return
        }
        locationManager.startMonitoringSignificantLocationChanges()
        isMonitoringSCLS = true
        logger.info("Started SCLS monitoring")
    }

    func stopMonitoring() {
        locationManager.stopMonitoringSignificantLocationChanges()
        isMonitoringSCLS = false
    }

    /// Request a one-shot fix (e.g. when user opens app)
    func requestOneShot() {
        locationManager.requestLocation()
    }
}

extension LocationManager: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            authorizationStatus = manager.authorizationStatus
            if authorizationStatus == .authorizedWhenInUse {
                manager.requestAlwaysAuthorization()
            } else if authorizationStatus == .authorizedAlways {
                startMonitoring()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in
            lastKnownLocation = loc
            let source = isMonitoringSCLS ? "ios_scls" : "ios_one_shot"
            await handleNewLocation(loc, source: source)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            logger.error("Location error: \(error.localizedDescription)")
        }
    }

    private func handleNewLocation(_ loc: CLLocation, source: String) async {
        let ping = LocationPing(
            lat: loc.coordinate.latitude,
            lon: loc.coordinate.longitude,
            horizontalAccuracyM: loc.horizontalAccuracy,
            source: source,
            deviceId: DeviceIdentifier.current,
            clientTs: Int(loc.timestamp.timeIntervalSince1970 * 1000),
            clientEventId: UUID().uuidString,
        )
        await outbox.enqueue(ping)
        await outbox.flush(via: api)
    }
}
```

### 4.3 DTO: `Sources/RitualCompanion/Services/LocationPing.swift`

```swift
struct LocationPing: Codable {
    let lat: Double
    let lon: Double
    let horizontalAccuracyM: Double?
    let source: String
    let deviceId: String?
    let clientTs: Int
    let clientEventId: String

    enum CodingKeys: String, CodingKey {
        case lat, lon, source
        case horizontalAccuracyM = "horizontal_accuracy_m"
        case deviceId = "device_id"
        case clientTs = "client_ts"
        case clientEventId = "client_event_id"
    }
}
```

### 4.4 Offline outbox: `Sources/RitualCompanion/Services/LocationPingOutbox.swift`

Critical because SCLS can fire when the device is offline. Buffer to disk, flush opportunistically.

```swift
actor LocationPingOutbox {
    private let storageURL: URL
    private var pending: [LocationPing] = []

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        storageURL = appSupport.appendingPathComponent("location_outbox.json")
        loadFromDisk()
    }

    func enqueue(_ ping: LocationPing) {
        pending.append(ping)
        persistToDisk()
    }

    func flush(via api: RitualAPIClient) async {
        guard !pending.isEmpty else { return }
        let batch = pending
        do {
            try await api.postLocationPings(batch)
            pending.removeAll()
            persistToDisk()
        } catch {
            // Keep pending — try again next time
        }
    }

    private func loadFromDisk() {
        guard let data = try? Data(contentsOf: storageURL),
              let decoded = try? JSONDecoder().decode([LocationPing].self, from: data) else { return }
        pending = decoded
    }

    private func persistToDisk() {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        try? data.write(to: storageURL, options: .atomic)
    }
}
```

### 4.5 API client extension

Add to existing `RitualAPIClient`:

```swift
extension RitualAPIClient {
    func postLocationPings(_ pings: [LocationPing]) async throws {
        try await post(path: "/api/user/location-pings", body: ["pings": pings])
    }
}
```

### 4.6 Wire into app lifecycle

In `RitualCompanionApp.swift`:

```swift
@main
struct RitualCompanionApp: App {
    @StateObject private var locationManager = LocationManager.shared

    init() {
        Clerk.shared.configure()
        // Start SCLS even before login — pings buffer until auth is ready
        LocationManager.shared.requestAuthorization()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(locationManager)
                .onAppear {
                    locationManager.requestOneShot()  // fresh fix on every app open
                }
        }
    }
}
```

### 4.7 Settings UI surface

Add a row to the iOS app's Settings view showing:
- Current authorization status
- Last known location (lat/lon + place label if available)
- "Refresh now" button → calls `requestOneShot()`
- Toggle to pause location tracking (respected in delegate via UserDefaults flag)

---

## 5. Mac: BSSID monitoring + one-shot CLLocation

### 5.1 Permissions & entitlements

Edit `apps/desktop/src-tauri/entitlements.plist`:

```xml
<!-- Location access (required even with sandbox disabled) -->
<key>com.apple.security.personal-information.location</key>
<true/>
```

Edit Info.plist via `tauri.conf.json` → `bundle.macOS.infoPlist`:

```json
"NSLocationUsageDescription": "Ritual tags your habit logs with where you were, so you can see patterns over time.",
"NSLocationWhenInUseUsageDescription": "Ritual tags your habit logs with where you were."
```

### 5.2 New Rust module: `apps/desktop/src-tauri/bin/ritual-watcher/src/location/`

```
bin/ritual-watcher/src/location/
├── mod.rs              # public API: LocationService
├── core_location.rs    # objc2 bindings to CLLocationManager
├── wifi_monitor.rs     # CWWiFiClient/CWInterface BSSID change polling
├── ping_outbox.rs      # disk-backed buffer + flush
└── api_client.rs       # POST to backend
```

### 5.3 Cargo.toml additions

```toml
[dependencies]
# Existing: objc2, objc2-foundation, objc2-app-kit, core-foundation
objc2-core-location = "0.2"
objc2-core-wlan = "0.2"
```

### 5.4 Core Location wrapper (`location/core_location.rs`)

```rust
use objc2::rc::Id;
use objc2::runtime::ProtocolObject;
use objc2::{declare_class, msg_send_id, ClassType, DeclaredClass};
use objc2_foundation::{NSObject, NSObjectProtocol, NSArray};
use objc2_core_location::{CLLocationManager, CLLocationManagerDelegate, CLLocation};
use std::sync::mpsc::Sender;

pub struct CoreLocationFix {
    pub lat: f64,
    pub lon: f64,
    pub horizontal_accuracy_m: f64,
    pub timestamp_ms: i64,
}

declare_class!(
    struct RitualLocationDelegate;
    unsafe impl ClassType for RitualLocationDelegate {
        type Super = NSObject;
        type Mutability = objc2::mutability::InteriorMutable;
        const NAME: &'static str = "RitualLocationDelegate";
    }
    impl DeclaredClass for RitualLocationDelegate {
        type Ivars = Sender<CoreLocationFix>;
    }
    unsafe impl NSObjectProtocol for RitualLocationDelegate {}
    unsafe impl CLLocationManagerDelegate for RitualLocationDelegate {
        #[method(locationManager:didUpdateLocations:)]
        unsafe fn did_update_locations(
            &self,
            _manager: &CLLocationManager,
            locations: &NSArray<CLLocation>,
        ) {
            if let Some(loc) = locations.last() {
                let fix = CoreLocationFix {
                    lat: loc.coordinate().latitude,
                    lon: loc.coordinate().longitude,
                    horizontal_accuracy_m: loc.horizontalAccuracy(),
                    timestamp_ms: (loc.timestamp().timeIntervalSince1970() * 1000.0) as i64,
                };
                let _ = self.ivars().send(fix);
            }
        }
    }
);

pub struct LocationFetcher {
    manager: Id<CLLocationManager>,
    _delegate: Id<RitualLocationDelegate>,
}

impl LocationFetcher {
    pub fn new(tx: Sender<CoreLocationFix>) -> Self {
        unsafe {
            let manager: Id<CLLocationManager> = msg_send_id![CLLocationManager::class(), new];
            manager.requestWhenInUseAuthorization();
            let delegate = RitualLocationDelegate::new(tx);
            manager.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            Self { manager, _delegate: delegate }
        }
    }

    /// Fire a one-shot location fix; result arrives via the channel.
    pub fn request_one_shot(&self) {
        unsafe { self.manager.requestLocation(); }
    }
}
```

*Exact `objc2` syntax may need tweaks for your crate version — confirm against existing `objc2` usage elsewhere in `apps/desktop/src-tauri/src/`.*

### 5.5 Wi-Fi BSSID monitor (`location/wifi_monitor.rs`)

CoreWLAN has no clean change-notification API for BSSID — poll every 10s and diff:

```rust
use objc2::rc::Id;
use objc2::{msg_send_id, ClassType};
use objc2_core_wlan::{CWWiFiClient, CWInterface};
use std::sync::mpsc::Sender;
use std::time::Duration;

pub struct WifiFingerprint {
    pub ssid: Option<String>,
    pub bssid: Option<String>,
}

pub fn spawn_wifi_monitor(tx: Sender<WifiFingerprint>) {
    std::thread::spawn(move || {
        let mut last_bssid: Option<String> = None;
        loop {
            let fp = current_wifi();
            if fp.bssid != last_bssid {
                last_bssid = fp.bssid.clone();
                let _ = tx.send(fp);
            }
            std::thread::sleep(Duration::from_secs(10));
        }
    });
}

fn current_wifi() -> WifiFingerprint {
    unsafe {
        let client: Id<CWWiFiClient> = msg_send_id![CWWiFiClient::class(), sharedWiFiClient];
        let iface: Option<Id<CWInterface>> = msg_send_id![&client, interface];
        match iface {
            Some(i) => WifiFingerprint {
                ssid: nsstring_to_option(msg_send_id![&i, ssid]),
                bssid: nsstring_to_option(msg_send_id![&i, bssid]),
            },
            None => WifiFingerprint { ssid: None, bssid: None },
        }
    }
}

fn nsstring_to_option(s: Option<Id<objc2_foundation::NSString>>) -> Option<String> {
    s.map(|ns| ns.to_string())
}
```

**Critical gotcha:** As of macOS 14+, reading SSID/BSSID requires Location authorization. So the user flow is: app starts → requests Core Location permission → once granted, SSID/BSSID reads also succeed. Location permission is a prereq even for the "free" Wi-Fi-only path.

### 5.6 LocationService orchestrator (`location/mod.rs`)

```rust
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

mod core_location;
mod wifi_monitor;
mod ping_outbox;
mod api_client;

use core_location::{LocationFetcher, CoreLocationFix};
use wifi_monitor::{spawn_wifi_monitor, WifiFingerprint};
use ping_outbox::PingOutbox;

const PERIODIC_REFRESH: Duration = Duration::from_secs(30 * 60);  // 30 min

pub struct LocationService {
    fetcher: LocationFetcher,
    location_rx: Receiver<CoreLocationFix>,
    wifi_rx: Receiver<WifiFingerprint>,
    last_wifi: Option<WifiFingerprint>,
    last_fix_ts: Instant,
    pending_source: &'static str,
    outbox: PingOutbox,
}

impl LocationService {
    pub fn start() -> Self {
        let (loc_tx, loc_rx) = channel();
        let (wifi_tx, wifi_rx) = channel();
        spawn_wifi_monitor(wifi_tx);
        let fetcher = LocationFetcher::new(loc_tx);
        fetcher.request_one_shot();
        Self {
            fetcher,
            location_rx: loc_rx,
            wifi_rx,
            last_wifi: None,
            last_fix_ts: Instant::now(),
            pending_source: "mac_one_shot",
            outbox: PingOutbox::load(),
        }
    }

    /// Call this from the watcher's main loop every ~5s.
    pub fn tick(&mut self) {
        // Drain location fixes
        while let Ok(fix) = self.location_rx.try_recv() {
            self.outbox.enqueue_fix(fix, self.pending_source, self.last_wifi.as_ref());
            self.last_fix_ts = Instant::now();
            self.pending_source = "mac_one_shot";  // reset
        }

        // Drain Wi-Fi changes — trigger a fresh fix on each change
        while let Ok(wifi) = self.wifi_rx.try_recv() {
            self.last_wifi = Some(wifi);
            self.pending_source = "mac_bssid_trigger";
            self.fetcher.request_one_shot();
        }

        // Periodic refresh
        if self.last_fix_ts.elapsed() > PERIODIC_REFRESH {
            self.fetcher.request_one_shot();
        }

        // Try to flush outbox
        self.outbox.try_flush();
    }
}
```

### 5.7 Integrate into watcher

In `apps/desktop/src-tauri/bin/ritual-watcher/src/main_impl.rs`, alongside the existing screen-time/activity loops:

```rust
mod location;

// In main loop:
let mut location = location::LocationService::start();

loop {
    // existing watcher work ...
    location.tick();
    std::thread::sleep(Duration::from_secs(5));
}
```

### 5.8 Outbox (`location/ping_outbox.rs`)

Same pattern as iOS — disk-backed JSON file, flush opportunistically. Persist to:
```
~/Library/Application Support/Ritual/location_outbox.json
```

---

## 6. Habit log enrichment hook

This is where it all comes together. Every habit log write — from any source — gets location-enriched server-side.

### 6.1 Enrichment helper (`services/location/enrichment.py`)

```python
import time
from database.models import HabitLogDB
from services.location.resolver import resolve_for

async def enrich_habit_log(log: HabitLogDB) -> HabitLogDB:
    """Attach location fields to a habit log in-place. Safe to call multiple times."""
    if log.location_lat is not None:
        return log  # already enriched

    # Use completed_at if present, otherwise now
    if hasattr(log, "completed_at_ms") and log.completed_at_ms:
        ts_ms = log.completed_at_ms
    elif log.completed_at:
        ts_ms = int(log.completed_at.timestamp() * 1000)
    else:
        ts_ms = int(time.time() * 1000)

    resolved = await resolve_for(log.user_id, ts_ms)
    if resolved:
        log.location_lat = resolved.lat
        log.location_lon = resolved.lon
        log.location_accuracy_m = resolved.horizontal_accuracy_m
        log.location_source = resolved.source
        log.location_place_label = resolved.place_label
        log.location_confidence = resolved.confidence
        log.location_resolved_at = int(time.time() * 1000)
        log.location_signal_age_ms = resolved.signal_age_ms
    return log
```

### 6.2 Wire into every habit-log creation path

Find every place a `HabitLogDB` is constructed and call `enrich_habit_log()` before commit:

1. **`api/core.py`** — direct user logs via `POST /api/habits/{id}/logs`
2. **`api/sendblue.py`** — iMessage-derived logs (high-value: iOS SCLS pings will almost always have fresh data)
3. **`services/wearables_unified/sync_*.py`** — wearable-projected habit logs (use activity timestamp)
4. **Any AI/screenshot ingestion path** — search `rg "HabitLogDB\(" apps/backend` to find all sites

Example for `api/core.py`:

```python
from services.location.enrichment import enrich_habit_log

@router.post("/api/habits/{habit_id}/logs")
async def create_habit_log(habit_id: str, body: HabitLogCreate, user = Depends(get_current_user)):
    # ... existing validation and HabitLogDB construction ...
    log = HabitLogDB(...)
    await enrich_habit_log(log)
    db.add(log)
    await db.commit()
    return log
```

### 6.3 Backfill recent logs (one-time)

After deploy, run a backfill for logs created in the past 24h:

```python
# apps/backend/scripts/backfill_recent_log_locations.py
import asyncio, time
from database.connection import async_session
from database.models import HabitLogDB
from services.location.enrichment import enrich_habit_log
from sqlalchemy import select

async def backfill(user_id: str, hours_back: int = 24):
    cutoff_ms = int(time.time() * 1000) - hours_back * 3_600_000
    async with async_session() as db:
        result = await db.execute(
            select(HabitLogDB).where(
                HabitLogDB.user_id == user_id,
                HabitLogDB.completed_at_ms >= cutoff_ms,
                HabitLogDB.location_lat.is_(None),
            )
        )
        for log in result.scalars():
            await enrich_habit_log(log)
        await db.commit()

if __name__ == "__main__":
    import sys
    asyncio.run(backfill(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 24))
```

---

## 7. Privacy, retention, encryption

### 7.1 What lives where, and for how long

| Data | Where | Retention |
|---|---|---|
| Raw `(lat, lon)` pings | `user_location_pings` table | **30 days**, then deleted via cron |
| Materialized `user_location_state` | `user_location_state` table | Always one row, overwritten on update |
| Per-log location | `habit_logs.location_*` columns | **Forever** (same as habit log itself) — but the lat/lon will be sparse after 30 days; the place label persists |
| Place labels | reverse-geocoded once, stored in state + per log | Forever |

**Why this design:** Raw lat/lon is sensitive PII with investigative/legal exposure. Place labels ("Home", "Equinox Brooklyn") have analytical value with much lower privacy cost. After 30 days, the raw coord trail is gone — but every historical habit log keeps its `location_place_label` for permanent analytics.

### 7.2 Retention cron (`services/location/retention.py`)

```python
import time
from sqlalchemy import delete
from database.models import UserLocationPingDB

async def cleanup_old_pings(db):
    cutoff_ms = int(time.time() * 1000) - 30 * 86_400_000
    await db.execute(
        delete(UserLocationPingDB).where(UserLocationPingDB.client_ts < cutoff_ms)
    )
    await db.commit()
```

Schedule via existing cron infra (Railway scheduled tasks, or whatever pattern Ritual already uses for periodic jobs).

### 7.3 Optional: column-level encryption

Turso supports per-database encryption (`TURSO_LOCAL_ENCRYPTION_KEY` already referenced in the scout report). The local replica is already encrypted; the cloud DB is encrypted at rest. For column-level encryption of lat/lon specifically, defer to v2.

### 7.4 User-facing transparency

Even though you're the only user right now, build the UX as if you weren't:

- **iOS Settings:** "Location tracking is ON. Last pinged 2 min ago at Home. [Pause] [Export my data] [Delete all]"
- **Mac Settings:** same
- **Dashboard:** "Privacy" tab listing data sources active, retention windows, and a one-click purge

---

## 8. Testing strategy

### 8.1 Backend

- **Unit:** `resolver.py` — feed synthetic pings into a test DB, assert correct source/age picks across tier rules. Test the 1-hour-state-shortcut vs the tier scan.
- **Unit:** `ingest.py` — idempotency (same `client_event_id` twice → one row), state update only on newer ts, geocoder enqueue only on >100m move.
- **Integration:** end-to-end "post ping → create habit log → verify location enrichment" against a test Turso DB.
- **Property:** haversine distance for known city pairs (NYC ↔ Brooklyn ≈ 10km, etc.).

### 8.2 iOS

- **Manual:** grant Always permission, force-quit app, walk 1 block. App should background-launch and emit a ping. Verify on backend.
- **Manual:** airplane mode, walk around, re-enable network. Verify buffered pings flush.
- **Unit:** outbox enqueue + flush logic, codable round-trip.
- **Tip:** use Xcode Simulator → Features → Location → Freeway Drive for simulated movement.

### 8.3 Mac

- **Manual:** launch app, switch Wi-Fi networks (home → phone hotspot), verify new pings emitted within ~10s.
- **Manual:** unplug Ethernet on a desktop Mac (no Wi-Fi), verify graceful degradation (no crashes, just no pings).
- **Unit:** Rust outbox enqueue/persist/load round-trip.
- **Integration:** stub backend, verify POSTed payload shape matches Pydantic model exactly.

### 8.4 End-to-end

- Create a habit log via SendBlue iMessage while moving (in a car). Verify the log lands with a non-null `location_lat` and a recent `location_signal_age_ms`.
- Disable iOS app, log via Mac only — verify resolver falls back to `mac_one_shot` source.
- Disable both, log via SendBlue — verify log has null location (graceful degradation, no error).

---

## 9. Rollout phases

### Phase 1 — Backend foundation (1–2 days)
- [ ] Alembic migration: new tables + habit_log columns
- [ ] `services/location/` module skeleton (models, ingest, resolver — stub geocoder)
- [ ] `POST /api/user/location-pings` endpoint live
- [ ] Hook enrichment into `api/core.py` habit log create path
- [ ] Manual test: curl pings, verify enrichment on a new habit log

### Phase 2 — iOS SCLS (1–2 days)
- [ ] Info.plist permissions + background mode
- [ ] `LocationManager.swift` + `LocationPingOutbox.swift`
- [ ] Extend `RitualAPIClient` with `postLocationPings`
- [ ] Wire into `RitualCompanionApp.swift`
- [ ] Manual test: walk around, verify backend receives pings
- [ ] Add Settings UI row

### Phase 3 — Mac BSSID + one-shot (2–3 days)
- [ ] Add `objc2-core-location` and `objc2-core-wlan` to Cargo.toml
- [ ] `location/` module in watcher sidecar
- [ ] Entitlements + Info.plist permissions
- [ ] Integrate into watcher main loop
- [ ] Manual test: Wi-Fi switching triggers pings

### Phase 4 — Reverse geocoding + place labels (1 day)
- [ ] Wire Nominatim/MapKit into `geocoder.py`
- [ ] Test reverse lookup on real coords
- [ ] Verify `place_label` populates in `user_location_state` and propagates to new habit logs

### Phase 5 — Enrich remaining log paths (1 day)
- [ ] `api/sendblue.py` — iMessage logs
- [ ] `services/wearables_unified/sync_*.py` — wearable-projected logs (use activity timestamp)
- [ ] Any AI/screenshot ingestion paths

### Phase 6 — Privacy, retention, UI surface (1–2 days)
- [ ] Retention cron job (delete pings >30d)
- [ ] Backfill script for recent logs missing location
- [ ] Dashboard UI: "where did I do X this week" chart
- [ ] Privacy/transparency screens in iOS + Mac

### Phase 7 — Validation (ongoing)
- [ ] Measure actual coverage: % of habit logs with non-null location over 7 days
- [ ] Measure freshness: median `location_signal_age_ms`
- [ ] Tune tier-rule windows based on real data

**Total estimate:** 7–10 days of focused work for v1, single-user mode.

---

## 10. Future enhancements (not in v1)

- **Geofence-based passive presence** — register `CLCircularRegion` for known places once labeled; backend gets enter/exit events for free
- **Calendar event correlation** — if calendar event has location and timestamp ±30 min of habit log, prefer event's location
- **Wi-Fi BSSID → place auto-labeling** — first time a new BSSID is seen, prompt to label it; thereafter "I'm at this BSSID" = "I'm at the labeled place" without any geocoder call
- **Photo EXIF extraction** — if a habit log attaches a photo, pull GPS EXIF as a high-confidence signal
- **Temporal pattern model** — after 30+ days of data, predict location from time-of-day when no signal exists
- **Multi-user / sharing model** — for scaling beyond one user; partition pings by user_id (already wired) and add per-tenant retention overrides
- **Garmin GPS correlation** — extend `sync_garmin.py` to emit `garmin_workout` location pings derived from workout route start coords
- **Apple Health workout-route ingestion** — `HKWorkoutRoute` exposes per-sample GPS for Apple Watch workouts; flow through `sync_apple.py`

---

## 11. File touch list

### New files
```
apps/backend/services/location/__init__.py
apps/backend/services/location/models.py
apps/backend/services/location/ingest.py
apps/backend/services/location/resolver.py
apps/backend/services/location/geocoder.py
apps/backend/services/location/enrichment.py
apps/backend/services/location/retention.py
apps/backend/services/location/util.py
apps/backend/api/location.py
apps/backend/migrations/versions/20260526_0001_add_location_tracking.py
apps/backend/scripts/backfill_recent_log_locations.py
apps/backend/tests/test_location_resolver.py
apps/backend/tests/test_location_ingest.py

apps/ios-companion/Sources/RitualCompanion/Services/LocationManager.swift
apps/ios-companion/Sources/RitualCompanion/Services/LocationPing.swift
apps/ios-companion/Sources/RitualCompanion/Services/LocationPingOutbox.swift

apps/desktop/src-tauri/bin/ritual-watcher/src/location/mod.rs
apps/desktop/src-tauri/bin/ritual-watcher/src/location/core_location.rs
apps/desktop/src-tauri/bin/ritual-watcher/src/location/wifi_monitor.rs
apps/desktop/src-tauri/bin/ritual-watcher/src/location/ping_outbox.rs
apps/desktop/src-tauri/bin/ritual-watcher/src/location/api_client.rs
```

### Modified files
```
apps/backend/database/models.py                         # add HabitLog location columns + new ORM tables
apps/backend/main.py                                    # register location router
apps/backend/api/core.py                                # call enrich_habit_log() in habit log create path
apps/backend/api/sendblue.py                            # call enrich_habit_log()
apps/backend/services/wearables_unified/sync_*.py       # call enrich_habit_log() in projected log paths

apps/ios-companion/Tuist/Project.swift                  # add location Info.plist + background mode
apps/ios-companion/Sources/RitualCompanion/RitualCompanionApp.swift  # init LocationManager
apps/ios-companion/Sources/RitualCompanion/Services/RitualAPIClient.swift  # postLocationPings()

apps/desktop/src-tauri/Cargo.toml                       # add objc2-core-location, objc2-core-wlan
apps/desktop/src-tauri/entitlements.plist               # add location entitlement
apps/desktop/src-tauri/tauri.conf.json                  # add NSLocationUsageDescription
apps/desktop/src-tauri/bin/ritual-watcher/Cargo.toml    # same crate adds
apps/desktop/src-tauri/bin/ritual-watcher/src/main_impl.rs  # start LocationService, tick in main loop
```

---

## Open questions to confirm before starting

1. **Reverse geocoder choice:** Nominatim (free, OSM, rate-limited 1 req/s) or Apple MapKit Server-Side (free with Apple Developer Program, higher quota, JWT auth)? Recommend MapKit since you're already in the Apple ecosystem and have the Developer Program.
2. **Retention window:** 30 days for raw pings — fine, or shorter (7d)? Longer windows let you backfill more historical logs but expand the privacy surface.
3. **Reverse-geocode trigger threshold:** 100m default — fine for cities, may need 250m+ for suburban/rural so you don't burn quota on parking-lot drift.
4. **Tier-rule confidence values:** numbers in `TIER_RULES` are sensible defaults but should be calibrated against real data in Phase 7.
5. **Place-confirmation UX?** ("This log was tagged as Home — change?") — adds friction but improves data quality. Default to off, ship as optional setting.

Once these are confirmed, the plan is ready to execute Phase 1.
