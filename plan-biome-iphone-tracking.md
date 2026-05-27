# iPhone Screen Time Tracking via Biome SEGB — Implementation Plan

**Goal:** Track per-app iPhone usage in Ritual at the same granularity the existing watcher tracks Mac apps — bundle IDs, sub-second timestamps, stitched session intervals, location-tagged — surfaced as a dedicated "iPhone Time" habit that lives alongside "Computer Time" on the Overview, Logs, and Charts.

**Strategy in one sentence:** The Mac watcher periodically scans Apple's iCloud-synced `~/Library/Biome/streams/restricted/App.InFocus/remote/<iphone_uuid>/*.segb` files, parses the protobuf payload via a vendored Python helper, ingests stitched intervals into the existing `watcher_activity` data path with `source="biome_iphone"` and `device_platform="ios"`, then exposes them as a peer habit on the dashboard.

**Foundation status (already confirmed working on your machine):**
- iPhone Biome data syncs to Mac under aligned iCloud — verified (1,734 events extracted across 50 apps in a 36-hour window)
- ActivityWatch's `aw-import-screentime` parses SEGB correctly — verified
- Sync cadence: 2–8h typical (eventually-consistent, no SLA)
- Foundation dependency: `plan-location-tracking.md` must ship first (its `resolve_for()` does the location enrichment on iPhone events)

---

## Table of Contents
1. [Architecture overview](#1-architecture-overview)
2. [Data model: extend watcher_activity, add habit](#2-data-model-extend-watcher_activity-add-habit)
3. [Vendored Python SEGB parser](#3-vendored-python-segb-parser)
4. [Mac watcher: Biome scan module](#4-mac-watcher-biome-scan-module)
5. [Backend: ingest endpoint + location enrichment](#5-backend-ingest-endpoint--location-enrichment)
6. [Habit aggregation: iPhone Time as a first-class habit](#6-habit-aggregation-iphone-time-as-a-first-class-habit)
7. [Dashboard UI: Overview, Logs, Charts](#7-dashboard-ui-overview-logs-charts)
8. [Freshness, sync health, error handling](#8-freshness-sync-health-error-handling)
9. [Privacy, multi-device, multi-user](#9-privacy-multi-device-multi-user)
10. [Testing strategy](#10-testing-strategy)
11. [Rollout phases](#11-rollout-phases)
12. [Future enhancements](#12-future-enhancements-not-in-v1)
13. [File touch list](#13-file-touch-list)
14. [Open questions](#14-open-questions-to-confirm-before-starting)

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              iPhone (iOS)                                   │
│  Every app focus change writes to local SEGB stream                         │
│  → iCloud Biome sync (2–8h typical, opportunistic)                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Mac (iCloud-aligned with iPhone)                       │
│  ~/Library/Biome/streams/restricted/App.InFocus/remote/<iphone_uuid>/       │
│   └── *.segb (524 KB blocks, append-only event log)                         │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  ritual-watcher Biome scan module (NEW)                              │   │
│  │   • Every 30 min: enumerate SEGB files, dedupe via bookmark          │   │
│  │   • Spawn vendored Python parser subprocess                          │   │
│  │   • Receive stitched intervals as JSONL on stdout                    │   │
│  │   • Batch and POST to backend                                        │   │
│  └────────────────────┬─────────────────────────────────────────────────┘   │
│                       │ POST /api/watcher/biome-ingest                      │
└───────────────────────┼─────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Backend (FastAPI + Turso)                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  services/biome_ingest.py (NEW)                                      │   │
│  │   • Validate, dedupe by (device_id, bundle_id, start_ts_ns)          │   │
│  │   • Enrich each event with location via resolve_for()                │   │
│  │     (uses location plan's user_location_pings)                       │   │
│  │   • Insert into watcher_activity with source="biome_iphone"          │   │
│  │     device_id=<iphone_uuid>, device_platform="ios"                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Habit aggregation                                                   │   │
│  │   • "iPhone Time" habit queries watcher_activity                     │   │
│  │     WHERE source='biome_iphone' GROUP BY date                        │   │
│  │   • "Total Screen Time" habit unions Mac + iPhone sources            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
                 Dashboard UI: Overview cards, Logs page, Charts with
                 device filter, "iPhone last synced 3h ago" freshness badge
```

**Key invariants:**
- Reuse `watcher_activity` table — don't create a parallel "iphone_activity" table. Differentiate by `source` + `device_platform`.
- All ingestion is idempotent on `(device_id, bundle_id, start_ts_ns)`.
- Location enrichment runs server-side at ingest, using the location plan's `resolve_for()`.
- Schema drift resilience: parser is vendored and version-pinned; failures are logged but don't crash the watcher.

---

## 2. Data model: extend `watcher_activity`, add habit

Looking at the watcher's existing data model from the backend scout (`watcher_activity` table):
- `event_uid`, `device_id`, `user_id`, `ts_start`, `ts_end`, `created_at`
- `app_bundle_id`, `app_name`, `window_title`, `window_owner_pid`
- `browser_url`, `browser_domain`, `is_incognito`
- `is_afk`, `source`

iPhone events don't carry window titles, PIDs, browser URLs, or AFK signals — those columns stay null. But we want to capture iOS-specific signal that Mac can't give us:

### New columns to add (Alembic migration: `20260528_0001_add_biome_iphone_columns`)

| Column | Type | Notes |
|---|---|---|
| `device_platform` | TEXT | `"macos"` / `"ios"` / `"ipados"` — populated for ALL rows (backfill mac rows to `"macos"`) |
| `app_version` | TEXT | iOS gives us this per event (e.g. `"26.0"`); useful for app-update detection |
| `app_build` | TEXT | iOS build number (e.g. `"1450.500.221.2.9"`) |
| `transition_reason` | TEXT | iOS-only: `"appswitcher"`, `"deeplink"`, `"notification"` — behavioral signal Mac doesn't have |
| `biome_source_file` | TEXT | which SEGB file this event was extracted from (debugging) |

Plus the existing location columns from `plan-location-tracking.md` (already on `habit_logs`; we mirror them on `watcher_activity` if not already present):

| Column | Type |
|---|---|
| `location_lat` | REAL |
| `location_lon` | REAL |
| `location_accuracy_m` | REAL |
| `location_source` | TEXT |
| `location_place_label` | TEXT |
| `location_confidence` | REAL |

### Dedupe constraint

Add unique index on `(device_id, app_bundle_id, ts_start)` to make idempotent re-ingestion safe. Sub-second timestamps + bundle IDs guarantee zero false-collision risk.

### New bookmark table for the watcher's scan progress

`biome_scan_bookmarks` — tracks which SEGB files have been processed and up to what byte offset:

```sql
CREATE TABLE biome_scan_bookmarks (
  user_id          TEXT NOT NULL,
  device_id        TEXT NOT NULL,        -- iPhone's Biome UUID
  file_path        TEXT NOT NULL,        -- full path to SEGB file
  file_mtime_ns    INTEGER NOT NULL,     -- mtime at last scan
  last_byte_offset INTEGER NOT NULL,     -- where we stopped reading
  events_extracted INTEGER NOT NULL,
  last_scanned_at  INTEGER NOT NULL,     -- ms since epoch
  PRIMARY KEY (user_id, file_path)
);
```

Lives in the local watcher database (`ritual-db`), not in the cloud Turso DB — bookmarks are device-local concerns.

---

## 3. Vendored Python SEGB parser

We confirmed `aw-import-screentime` extracts iPhone data correctly from your machine. Rather than depend on the full ActivityWatch CLI (which includes ActivityWatch's bucket model, iTunes lookup, Typer CLI, etc.), we **vendor just the parsing core** as a tiny self-contained script.

### Layout

```
apps/desktop/src-tauri/bin/ritual-watcher/python/biome_parser/
├── biome_parser.py          # entry point; CLI: --device, --file, --since-mtime
├── app_in_focus_pb2.py      # protobuf compiled stub (copy from aw-import-screentime)
├── segb_reader.py           # SEGB framing logic (vendored from ccl-segb)
└── requirements.txt         # protobuf>=4.0 only — no other deps
```

### CLI contract

```
python biome_parser.py \
  --device 15E0A2E9-7737-4D28-8CE5-5ADE13ED5869 \
  --file /Users/me/Library/Biome/streams/restricted/App.InFocus/remote/<uuid>/801457787801301 \
  --since-byte 0 \
  --tz utc
```

Outputs JSONL on stdout, one event per line:

```json
{"start_ts_ns": 1779892245877000000, "end_ts_ns": 1779892249218000000,
 "duration_ms": 3341, "bundle_id": "com.google.chrome.ios",
 "app_version": "150.0.7242.84", "app_build": "30247", "transition_reason": "appswitcher",
 "source_file": "801457787801301", "device_id": "15E0A2E9-..."}
```

Plus a final summary line on stderr:

```
SCAN_COMPLETE files=1 events=423 stopped_at_byte=234567
```

### Why subprocess and not direct Python imports

- Rust watcher is the host; calling Python via subprocess is a clean boundary
- Parser updates (new iOS version, schema changes) don't require rebuilding the watcher binary
- Failures isolate — a parser crash logs an error but doesn't kill the watcher
- Cross-platform packaging concern: we ship the Python script + a small `uv`-managed venv alongside the watcher binary

### Vendoring sources

- `app_in_focus_extended.proto` schema: copy from `https://github.com/ActivityWatch/aw-import-screentime/blob/main/src/aw_import_screentime/app_in_focus_extended.proto`
- SEGB framing: vendor a minimal port of `ccl_segb.read_segb_file` (~150 lines of Python)
- License compliance: both upstreams are open-source compatible; include LICENSE notices in `python/biome_parser/THIRD_PARTY.md`

---

## 4. Mac watcher: Biome scan module

New module under the existing watcher's `location/` peer:

```
apps/desktop/src-tauri/bin/ritual-watcher/src/biome/
├── mod.rs              # public BiomeScanner service
├── scanner.rs          # enumerates SEGB files, manages bookmarks
├── parser_runner.rs    # subprocess invocation of biome_parser.py
└── ingest_client.rs    # POSTs parsed events to backend
```

### Architecture

```rust
pub struct BiomeScanner { /* background thread handle */ }

impl BiomeScanner {
    pub fn spawn(user_id: String, device_id: String, db: BlockingDatabase) -> Self {
        // Background thread runs forever, sleeping 30 min between scans.
    }
}

fn run_scanner(user_id: String, ritual_device_id: String, db: BlockingDatabase) {
    let mut interval = std::time::Duration::from_secs(30 * 60);

    // On startup, do one immediate scan, then enter periodic loop
    perform_scan(&user_id, &ritual_device_id, &db);

    loop {
        std::thread::sleep(interval);
        if let Err(e) = perform_scan(&user_id, &ritual_device_id, &db) {
            warn!("Biome scan failed (non-fatal): {}", e);
        }
    }
}

fn perform_scan(user_id: &str, ritual_device_id: &str, db: &BlockingDatabase) -> Result<()> {
    // 1. Resolve Biome base path
    let home = std::env::var("HOME")?;
    let base = PathBuf::from(home).join("Library/Biome/streams/restricted/App.InFocus/remote");

    // 2. Read DevicePeer table to identify iOS-platform devices
    let ios_devices = read_ios_device_peers()?;

    // 3. For each iOS device, scan files
    for device in ios_devices {
        let device_dir = base.join(&device.uuid);
        if !device_dir.exists() { continue; }

        for entry in std::fs::read_dir(&device_dir)? {
            let path = entry?.path();
            if !path.is_file() { continue; }
            // Skip tombstones, locks, etc.
            if path.file_name().map_or(true, |n| n.to_string_lossy().starts_with('.')) { continue; }

            let bookmark = load_bookmark(db, user_id, &path);
            let mtime_ns = mtime_nanos(&path)?;
            if let Some(ref b) = bookmark {
                if b.file_mtime_ns == mtime_ns { continue; } // unchanged
            }

            // Spawn parser subprocess
            let events = run_parser(&path, &device.uuid, bookmark.as_ref().map(|b| b.last_byte_offset).unwrap_or(0))?;

            if !events.is_empty() {
                post_to_backend(user_id, &events)?;
            }

            save_bookmark(db, user_id, &path, mtime_ns, events.len() as i64);
        }
    }
    Ok(())
}
```

### Reading `DevicePeer` to find iPhones

```rust
fn read_ios_device_peers() -> Result<Vec<DevicePeer>> {
    let home = std::env::var("HOME")?;
    let sync_db = PathBuf::from(home).join("Library/Biome/sync/sync.db");
    if !sync_db.exists() { return Ok(vec![]); }

    let conn = rusqlite::Connection::open_with_flags(
        &sync_db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;

    // platform=2 means iOS per Biome conventions
    let mut stmt = conn.prepare(
        "SELECT device_identifier, platform FROM DevicePeer WHERE platform = 2 AND me = 0"
    )?;
    let rows = stmt.query_map([], |row| Ok(DevicePeer {
        uuid: row.get(0)?,
        platform: row.get(1)?,
    }))?;
    Ok(rows.flatten().collect())
}
```

Add `rusqlite` to the watcher's `Cargo.toml` if not already present.

### Why this is safe to run on every watcher startup

- Bookmark table prevents re-parsing unchanged files
- Parser subprocess timeout (e.g. 60s) prevents hangs
- Empty `DevicePeer` table (no iOS peers) → no-op, instant return
- No Biome dir at all (user without iCloud-aligned setup) → no-op, instant return
- Failures are logged via `tracing` and never propagate

### Cargo.toml additions

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
# reqwest already used elsewhere, or add it here for direct POST
# OR write to outbox file like the location module and let main app drain
```

The cleanest pattern (mirroring the location module): **write parsed events to an outbox file**, let the main Tauri app drain it. This keeps the watcher binary HTTP-client-free.

### Outbox path

```
~/Library/Application Support/Ritual/biome_iphone_events.jsonl
```

JSON-Lines format (one event per line) — append-friendly, partial-failure-tolerant, drainable by `wc -l` then truncate.

---

## 5. Backend: ingest endpoint + location enrichment

### New endpoint

```python
# apps/backend/api/watcher_biome.py
from typing import Any, Callable
from fastapi import APIRouter, Depends, HTTPException

def create_watcher_biome_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    from services.biome_ingest import ingest_biome_events
    from schemas.biome import BiomeIngestRequest, BiomeIngestResponse

    router = APIRouter(tags=["watcher-biome"])

    @router.post("/api/watcher/biome-ingest", response_model=BiomeIngestResponse, status_code=202)
    async def biome_ingest(
        request: BiomeIngestRequest,
        current_user=Depends(get_current_user),
    ):
        if len(request.events) > 2000:
            raise HTTPException(400, "Maximum 2000 events per batch")
        result = await ingest_biome_events(current_user["id"], request)
        return result

    return router
```

### Schema

```python
# apps/backend/schemas/biome.py
from pydantic import BaseModel
from typing import Optional, Literal

class BiomeEvent(BaseModel):
    device_id: str           # iPhone Biome UUID
    bundle_id: str
    start_ts_ns: int         # nanoseconds since epoch
    end_ts_ns: int
    app_version: Optional[str] = None
    app_build: Optional[str] = None
    transition_reason: Optional[str] = None
    source_file: Optional[str] = None
    app_title: Optional[str] = None  # optional pre-resolved iTunes lookup

class BiomeIngestRequest(BaseModel):
    events: list[BiomeEvent]

class BiomeIngestResponse(BaseModel):
    accepted: int
    duplicates: int
    rejected: int
```

### Ingest implementation

```python
# apps/backend/services/biome_ingest.py
async def ingest_biome_events(user_id: str, request: BiomeIngestRequest) -> BiomeIngestResponse:
    accepted = duplicates = rejected = 0

    async with get_db_session() as session:
        for ev in request.events:
            if ev.end_ts_ns <= ev.start_ts_ns:
                rejected += 1
                continue

            start_ts_ms = ev.start_ts_ns // 1_000_000
            end_ts_ms = ev.end_ts_ns // 1_000_000

            # Idempotency: INSERT OR IGNORE on (device_id, bundle_id, ts_start)
            stmt = sqlite_insert(WatcherActivityDB).values(
                event_uid=f"biome:{ev.device_id}:{ev.bundle_id}:{ev.start_ts_ns}",
                user_id=user_id,
                device_id=ev.device_id,
                device_platform="ios",
                ts_start=start_ts_ms,
                ts_end=end_ts_ms,
                app_bundle_id=ev.bundle_id,
                app_name=ev.app_title,
                app_version=ev.app_version,
                app_build=ev.app_build,
                transition_reason=ev.transition_reason,
                source="biome_iphone",
                biome_source_file=ev.source_file,
                created_at=int(time.time() * 1000),
            ).on_conflict_do_nothing(index_elements=["event_uid"])

            result = await session.execute(stmt)
            if result.rowcount and result.rowcount > 0:
                accepted += 1
                # Location enrichment using the location plan's resolver.
                # Events arrive hours late but location pings are stored —
                # we can attach precise lat/lon retroactively.
                resolved = await resolve_for(user_id, start_ts_ms)
                if resolved:
                    await session.execute(
                        update(WatcherActivityDB)
                        .where(WatcherActivityDB.event_uid == f"biome:{ev.device_id}:{ev.bundle_id}:{ev.start_ts_ns}")
                        .values(
                            location_lat=resolved.lat,
                            location_lon=resolved.lon,
                            location_accuracy_m=resolved.horizontal_accuracy_m,
                            location_source=resolved.source,
                            location_place_label=resolved.place_label,
                            location_confidence=resolved.confidence,
                        )
                    )
            else:
                duplicates += 1

        await session.commit()

    return BiomeIngestResponse(accepted=accepted, duplicates=duplicates, rejected=rejected)
```

Register in `main.py` alongside the location router.

---

## 6. Habit aggregation: iPhone Time as a first-class habit

### New habit definitions

Add to the habits seed/init flow:

```python
{
    "id": "iphone-time",
    "name": "iPhone Time",
    "category": "device_usage",
    "icon": "📱",
    "is_custom": False,
    "integration_source": "biome_iphone",
    "unit_type": "Hours",
    "sensor_type": "iPhone (Biome)",
    "metric_type": "screen_time_ios",
}

{
    "id": "screen-time-total",
    "name": "Total Screen Time",
    "category": "device_usage",
    "icon": "📊",
    "is_custom": False,
    "integration_source": "multi_device",
    "unit_type": "Hours",
    "sensor_type": "All devices",
    "metric_type": "screen_time_total",
}
```

### Aggregation queries (per day / week / month / 3mo / 6mo / 1yr)

Single SQL pattern, parameterized by source filter:

```sql
-- iPhone Time, per day
SELECT
  DATE(ts_start / 1000, 'unixepoch') AS day,
  SUM(ts_end - ts_start) / 60000.0 AS minutes
FROM watcher_activity
WHERE user_id = :uid
  AND source = 'biome_iphone'
  AND ts_start >= :start_ms
  AND ts_start < :end_ms
GROUP BY day
ORDER BY day;

-- Total Screen Time = Mac + iPhone
WHERE source IN ('ritual_watcher_v2', 'browser_extension', 'biome_iphone')
```

For long horizons (3mo, 6mo, 1yr), precompute weekly/monthly rollups into `screen_time_rollups` — match the existing watcher rollup pattern. Refresh nightly via the in-process scheduler.

### Per-app breakdown

```sql
-- Top iPhone apps by usage in a window
SELECT
  app_bundle_id,
  app_name,
  COUNT(*) AS sessions,
  SUM(ts_end - ts_start) / 60000.0 AS minutes
FROM watcher_activity
WHERE user_id = :uid AND source = 'biome_iphone'
  AND ts_start BETWEEN :start_ms AND :end_ms
GROUP BY app_bundle_id, app_name
ORDER BY minutes DESC
LIMIT :limit;
```

### Service layer

Mirror existing `services/watcher_service.py`:

```python
class WatcherService:
    async def get_iphone_time_summary(self, user_id: str, start: str, end: str) -> dict:
        # Same shape as get_computer_time_summary but with source filter
        ...

    async def get_iphone_top_apps(self, user_id: str, start: str, end: str, limit: int = 10) -> list[dict]:
        ...
```

---

## 7. Dashboard UI: Overview, Logs, Charts

The existing Computer Time UI is the template. Three principles:

1. **Reuse components** — don't build parallel iPhone Time components. Parameterize Computer Time components with `source` / `device_platform` filters.
2. **Add a device filter** to existing charts (Mac / iPhone / Both).
3. **Surface freshness** prominently — iPhone data lags hours, users need to know.

### Overview page additions

```
┌─────────────────────────────────────────┐
│ 🖥️  Computer Time           4h 23m today │
│     ↑ 12% from yesterday                │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐  ← NEW
│ 📱  iPhone Time             2h 14m today │
│     ↓ 8% from yesterday                 │
│     Last synced 2h 14m ago              │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐  ← NEW (optional)
│ 📊  Total Screen Time       6h 37m today │
│     ↑ 4% from yesterday                 │
└─────────────────────────────────────────┘
```

### Logs page

iPhone Time gets its own row per day, with top-3 apps preview:

```
2026-05-27  📱 iPhone Time   2h 14m
                Top: YouTube (45m) · Instagram (23m) · Messages (17m)
                Tap for full breakdown →
```

Tap-expand shows all 50+ apps with per-app duration bars, ordered by time.

### Charts

Add a `device` filter chip to the existing time-series + per-app charts. Single-change covers all time horizons (day / week / month / 3mo / 6mo / 1yr).

New chart: **"Mac vs iPhone correlation"** — scatter of daily Mac minutes vs daily iPhone minutes. Genuinely insightful and only possible with separated data ("When I'm on my Mac more, do I phone less?").

---

## 8. Freshness, sync health, error handling

### Freshness UX

Each iPhone-data surface shows a freshness indicator:
- `Last synced: 2h 14m ago` — green pill if <6h, yellow if 6-24h, red if >24h
- Settings → Sync Health panel: last successful Biome scan, last new SEGB file detected, last successful POST, count of pending JSONL events in outbox

### Sync Health diagnostic panel

```
iPhone Tracking — Biome Sync
─────────────────────────────
✅ Last scan:           2 min ago
✅ Last new event:      2h 14m ago
✅ iPhone peer:         15E0A2E9-...  (last seen 2h 14m ago)
✅ Outbox:              0 pending
✅ Backend accepted:    1,734 events in last 7d

[Force sync now]  [Show raw paths]
```

### Error categorization

| Symptom | Cause | UX |
|---|---|---|
| No `DevicePeer` for iOS | iCloud not aligned or sync not yet established | Show onboarding: "Verify same iCloud on iPhone + Mac" |
| `DevicePeer` exists, no SEGB files | iCloud sync established but no data yet | "Waiting for first sync — usually ~24h" |
| Parser subprocess fails | iOS update changed protobuf schema | Log to Sentry; show "iPhone tracking temporarily unavailable" |
| Backend rejects events | Backend bug or schema mismatch | Retain outbox file, log error, retry next scan |
| Outbox grows >10MB | Backend down for extended period | Cap at 50MB on disk, drop oldest after that |

### Apple closing the door

The whole feature depends on Apple keeping `~/Library/Biome/streams/restricted/` readable with Full Disk Access. They've progressively restricted this surface; could land another blow at any WWDC.

Mitigations:
1. **Feature flag** in the backend: `BIOME_IPHONE_TRACKING_ENABLED` env var
2. **Telemetry**: parse-failure rate → Sentry; if it spikes after an iOS or macOS update, ship a parser fix or disable cleanly
3. **Fallback path**: the screenshot ingestion path (from `plan-location-tracking.md` §10 future enhancements) is always available as a degraded mode
4. **Never make Biome required** for Ritual to work — it's an enrichment tier

---

## 9. Privacy, multi-device, multi-user

### Privacy framing

iPhone Biome data is sensitive — it includes every app the user opened, with timestamps. Treat it like:
- Stored only in the user's Turso DB (per-user partition)
- Never aggregated across users
- Encrypted at rest (Turso default)
- Place labels for location, never raw coords beyond retention window (from location plan)
- User-facing transparency: Settings → Privacy → "iPhone tracking via Biome (How does this work?)"

### Multi-device cases

| Scenario | Behavior |
|---|---|
| User has iPhone + iPad on same iCloud | Both appear as `device_platform=ios` rows but with different `device_id`. Habit query unioned, per-device breakdown available. |
| User has 2 Macs | Mac watcher runs on each. The Mac that has iCloud-aligned to the iPhone reads Biome; the other doesn't (skip gracefully). |
| User has only one Mac, not iCloud-aligned with iPhone | No iOS DevicePeer found → scanner is a clean no-op. Show onboarding hint about iCloud alignment. |
| Multiple users on the same Mac | Each macOS user account has its own `~/Library/Biome/`. The watcher runs per-OS-user, so partition is natural. |

### Multi-user (Ritual SaaS scaling)

Already partitioned by `user_id` in `watcher_activity`. No changes needed beyond what's there.

---

## 10. Testing strategy

### Backend (Python — pytest + unittest.IsolatedAsyncioTestCase)

- **Unit: `services/biome_ingest.py`** — idempotency (re-ingesting same event = duplicate), rejected events (zero-duration, end < start), location enrichment uses resolver correctly
- **Unit: schema validation** — `BiomeEvent` Pydantic rejects bad payloads (negative timestamps, missing required fields)
- **Integration: ingest endpoint contract** — auth required, oversized batches rejected, response shape matches schema
- **Fixture: golden SEGB output** — vendor 1 small sample SEGB file + expected JSON output; assert parser invariant

### Mac watcher (Rust — cargo test)

- **Unit: bookmark table CRUD** — load/save/lookup, mtime drift detection
- **Unit: parser_runner subprocess** — handles timeout, parses JSONL output, swallows stderr
- **Unit: scanner skips files with matching mtime** — no re-parse
- **Integration (manual)**: run scanner against a real Biome dir on your dev machine, verify expected event count

### Python parser (vendored)

- **Unit: SEGB framing** — read sample binary fixture, assert correct event count
- **Unit: protobuf decode** — assert all expected fields extracted
- **Unit: stitch_intervals** — gain/loss pairs become intervals; orphan gains/losses dropped
- **Regression: 1,734-event fixture** — use your actual confirmed-working data as a regression test

### End-to-end (manual on your dev machine)

1. Trigger a scan from the watcher; verify events appear in Turso
2. Open dashboard, confirm iPhone Time card shows
3. Open Logs, expand iPhone Time row, see app breakdown
4. Check that location columns are populated (location plan must be shipped first)
5. Force a manual scan; verify dedupe works (no duplicate inserts)

---

## 11. Rollout phases

### Phase 0 — Prerequisites
- [ ] `plan-location-tracking.md` shipped end-to-end (resolver running, location pings flowing) — Biome enrichment depends on this

### Phase 1 — Backend foundation (1–2 days)
- [ ] Alembic migration: `watcher_activity` new columns + `biome_scan_bookmarks` table (note: bookmarks live in `ritual-db` SQLite, not Turso)
- [ ] `services/biome_ingest.py` skeleton
- [ ] `api/watcher_biome.py` endpoint live
- [ ] Pydantic schemas
- [ ] Wire location enrichment into ingest path

### Phase 2 — Vendored Python parser (2–3 days)
- [ ] Set up `python/biome_parser/` directory with vendored `app_in_focus_extended.proto` + compiled stub
- [ ] Port `ccl-segb` framing logic (~150 lines)
- [ ] CLI contract: `--device --file --since-byte --tz` → JSONL stdout
- [ ] Unit tests against vendored sample SEGB binary
- [ ] Package + ship alongside watcher binary

### Phase 3 — Mac watcher scan module (3–4 days)
- [ ] Add `rusqlite` to watcher Cargo.toml
- [ ] `biome/` module: scanner, parser_runner, ingest_client
- [ ] DevicePeer enumeration via sync.db
- [ ] SEGB file iteration with bookmark dedup
- [ ] Subprocess invocation with timeout + error capture
- [ ] Outbox file persistence (mirror location module pattern)
- [ ] Spawn at watcher startup
- [ ] Run on your dev machine; verify events extracted match your 1,734-event baseline

### Phase 4 — Drainer in main Tauri app (1–2 days)
- [ ] Tauri app reads `biome_iphone_events.jsonl` on a timer
- [ ] Batches and POSTs to `/api/watcher/biome-ingest`
- [ ] Truncates outbox on success
- [ ] Surfaces sync status to dashboard via Tauri command

### Phase 5 — Habit + service layer (2 days)
- [ ] Add iPhone Time + Total Screen Time habit seeds
- [ ] `WatcherService.get_iphone_time_summary()` and per-app variants
- [ ] Nightly rollup job for long-horizon queries (3mo/6mo/1yr)

### Phase 6 — Dashboard UI (3–4 days)
- [ ] iPhone Time card on Overview
- [ ] Logs page row with top-3 apps preview
- [ ] Charts: device filter chip + Mac/iPhone scatter correlation chart
- [ ] Sync Health diagnostic panel
- [ ] Freshness pills throughout

### Phase 7 — Validation (ongoing)
- [ ] Measure end-to-end latency: SEGB write on iPhone → row in Turso
- [ ] Measure coverage: % of events that get location-enriched
- [ ] Calibrate scan interval based on real Biome sync cadence on your machine
- [ ] Add Sentry breadcrumbs for parser failures

**Total estimate:** 12–18 days for v1 single-user mode, depending on how much of the Python parser needs custom work.

---

## 12. Future enhancements (not in v1)

- **Native Rust SEGB parser** — drop Python dependency once schemas stabilize. ~3-5 days of work to port + verify against golden fixtures.
- **iPad data ingestion** — same pipeline, different `device_platform="ipados"`. Should require zero new code if architected per the plan.
- **Apple Watch data via Biome** — Apple Watch DevicePeer.platform = 1. Verify what streams sync (likely minimal — watchOS exposes less).
- **Live SEGB tailing** — instead of polling every 30 min, use `fs::notify` to react to new files instantly. Useful for users with very fresh iCloud sync.
- **Cross-device session stitching** — "user was on iPhone Instagram, then opened Mac browser" → infer attention transitions.
- **Notification.Usage stream** — already in `~/Library/Biome/streams/restricted/Notification.Usage/`. Could ingest notification dismissals as a separate signal.
- **App.WebUsage stream** — when iPhone syncs web domain data (currently only local, not remote), unlock per-domain iPhone web tracking. Equivalent of Mac browser_domain.
- **MD5 fingerprint of SEGB file** to detect partial rewrites mid-scan (Apple rotates files; rare but possible race).

---

## 13. File touch list

### New files

```
apps/backend/services/biome_ingest.py
apps/backend/api/watcher_biome.py
apps/backend/schemas/biome.py
apps/backend/migrations/versions/20260528_0001_add_biome_iphone_columns.py
apps/backend/tests/test_biome_ingest.py
apps/backend/tests/test_biome_schemas.py

apps/desktop/src-tauri/bin/ritual-watcher/python/biome_parser/biome_parser.py
apps/desktop/src-tauri/bin/ritual-watcher/python/biome_parser/app_in_focus_pb2.py
apps/desktop/src-tauri/bin/ritual-watcher/python/biome_parser/segb_reader.py
apps/desktop/src-tauri/bin/ritual-watcher/python/biome_parser/requirements.txt
apps/desktop/src-tauri/bin/ritual-watcher/python/biome_parser/THIRD_PARTY.md
apps/desktop/src-tauri/bin/ritual-watcher/python/biome_parser/tests/test_parser.py

apps/desktop/src-tauri/bin/ritual-watcher/src/biome/mod.rs
apps/desktop/src-tauri/bin/ritual-watcher/src/biome/scanner.rs
apps/desktop/src-tauri/bin/ritual-watcher/src/biome/parser_runner.rs
apps/desktop/src-tauri/bin/ritual-watcher/src/biome/ingest_client.rs

apps/dashboard/components/iphone-time-card.tsx
apps/dashboard/components/screen-time-total-card.tsx
apps/dashboard/components/sync-health-panel.tsx
```

### Modified files

```
apps/backend/database/models.py                      # add watcher_activity columns
apps/backend/main.py                                 # register watcher_biome router
apps/backend/services/watcher_service.py             # add iphone time summary methods

apps/desktop/src-tauri/bin/ritual-watcher/Cargo.toml # add rusqlite
apps/desktop/src-tauri/bin/ritual-watcher/src/main.rs                # add `mod biome`
apps/desktop/src-tauri/bin/ritual-watcher/src/main_part_entry.rs     # spawn BiomeScanner

apps/desktop/src-tauri/src/main.rs                   # drainer for biome_iphone_events.jsonl
apps/desktop/src-tauri/src/lib.rs                    # Tauri command for sync status

apps/dashboard/app/(authed)/overview/page.tsx        # add iPhone Time card
apps/dashboard/app/(authed)/logs/page.tsx            # add iPhone Time row
apps/dashboard/app/(authed)/charts/page.tsx          # add device filter
```

---

## 14. Open questions to confirm before starting

1. **Where does the drainer live?** Main Tauri app process (Rust) or a separate Python sidecar? Recommend Tauri app — already has Clerk auth + HTTP client.
2. **Bookmark table location:** local `ritual-db` SQLite (per-device) or cloud Turso (per-user)? Recommend local — bookmarks are device-specific concerns, no value in syncing.
3. **Initial backfill scope:** when feature ships, do we backfill from all SEGB files present (could be weeks of history)? Recommend yes — `~/Library/Biome` retains ~30 days, user expects to see history immediately.
4. **iTunes app-title lookup:** done in parser (one-shot, cached) or backend (deferred, cached)? Recommend backend — keeps parser pure, allows title caching across users.
5. **Parser Python venv strategy:** ship a pre-built `.venv` with the watcher binary, or require users to have `uv`/`python3` installed? Recommend ship pre-built — zero-install UX matches the rest of the desktop app.
6. **Privacy default:** opt-in or opt-out for iPhone tracking? Recommend opt-in via Settings, with a clear explainer modal on first sync detection.
7. **What about Family Sharing users (children's devices syncing to parent's Mac)?** Out of scope for v1 — only sync the `me=0, platform=2` device that matches the signed-in user's iCloud.

---

## Companion plans

- **`plan-location-tracking.md`** — depended-upon foundation. Must ship first.
- **This plan (`plan-biome-iphone-tracking.md`)** — phase N+1.
- **`plan.md`** — unrelated existing architecture cleanup. Does not interact with this work.
