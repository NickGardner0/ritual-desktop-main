# Ritual iOS Companion App & Apple Health Integration Analysis

## Executive Summary

The Ritual iOS Companion app serves as a bridge between Apple Health/Apple Watch data and the Ritual desktop application. It uses Clerk authentication, HealthKit for data access, and a custom backend API for syncing metrics. The data flows from Apple Watch → Apple Health → iOS Companion App → Backend API → Turso Database + Tinybird Analytics → Desktop Dashboard.

---

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Apple Watch   │────▶│   Apple Health  │────▶│  iOS Companion  │
│   (Sensors)     │     │   (HealthKit)   │     │      App        │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         │ HTTPS + JWT Auth
                                                         │ HMAC-SHA256 Signed
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Ritual Desktop │◀────│    Tinybird     │◀────│  Python Backend │
│   Dashboard     │     │   (Analytics)   │     │   (FastAPI)     │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  Turso Database │
                                                │   (SQLite)      │
                                                └─────────────────┘
```

---

## iOS Companion App Components

### 1. Authentication Flow (`ConnectView.swift`)
- **Clerk SDK Integration**: Uses Clerk iOS SDK for authentication (Apple Sign-In, Google Sign-In, Email OTP)
- **JWT Token**: After Clerk auth, retrieves JWT token for backend API calls
- **Device Registration**: Registers device with backend, receives `device_id` and `device_secret`
- **Keychain Storage**: Credentials stored securely in iOS Keychain using `kSecAttrAccessibleAfterFirstUnlock`

### 2. HealthKit Manager (`HealthKitManager.swift`)

#### Supported Metrics (18 total):
| Category | Metric | HealthKit Identifier | Unit |
|----------|--------|---------------------|------|
| **Activity** | Steps | `stepCount` | count |
| | Active Energy | `activeEnergyBurned` | kcal |
| | Basal Energy | `basalEnergyBurned` | kcal |
| | Distance | `distanceWalkingRunning` | meters |
| | Flights Climbed | `flightsClimbed` | count |
| | Exercise Time | `appleExerciseTime` | minutes |
| | Stand Time | `appleStandTime` | minutes |
| **Heart** | Heart Rate | `heartRate` | bpm |
| | HRV | `heartRateVariabilitySDNN` | ms |
| | Resting HR | `restingHeartRate` | bpm |
| | Walking HR | `walkingHeartRateAverage` | bpm |
| **Respiratory** | Respiratory Rate | `respiratoryRate` | breaths/min |
| | Blood Oxygen | `oxygenSaturation` | percent |
| **Sleep** | Sleep Session | `sleepAnalysis` | hours |
| | REM Sleep | (derived) | minutes |
| | Deep Sleep | (derived) | minutes |
| | Core Sleep | (derived) | minutes |
| **Mindfulness** | Mindful Minutes | `mindfulSession` | minutes |

#### Data Fetching Strategy:
- **Apple Watch Only Filtering**: Activity metrics (steps, distance, energy, etc.) are filtered to ONLY include data from Apple Watch sources, excluding iPhone and third-party apps (like WHOOP)
- **Cumulative Sum**: Activity metrics use `HKStatisticsQuery` with `.cumulativeSum` and `.separateBySource`
- **Discrete Average**: Heart metrics use `HKStatisticsQuery` with `.discreteAverage`
- **Sleep Analysis**: Aggregates multiple sleep stages into total sleep duration

### 3. Background Sync Manager (`BackgroundSyncManager.swift`)

#### Sync Mechanisms:
1. **HealthKit Background Delivery** (`HKObserverQuery`)
   - Watches for new data in real-time
   - Triggers when Apple Watch records new metrics
   - Uses `enableBackgroundDelivery` with `.hourly` frequency

2. **BGTaskScheduler** (`BGAppRefreshTask`)
   - Schedules background app refresh every ~15 minutes
   - iOS controls actual timing based on device usage patterns
   - Registered task: `com.ritual.companion.healthsync`

3. **Foreground Sync**
   - Triggers when app becomes active (`scenePhase == .active`)
   - 5-minute rate limit between foreground syncs

#### Rate Limiting:
- Background syncs: minimum 5 minutes between syncs
- Foreground syncs: minimum 5 minutes between syncs
- Prevents API overload while keeping data fresh

### 4. API Client (`RitualAPIClient.swift`)

#### Request Signing:
- **HMAC-SHA256** signature on all ingest requests
- Canonical string: `device_id\nclient_event_id\ncaptured_at`
- **Note**: Metrics excluded from signature due to cross-platform float serialization differences (iOS: `259`, Python: `259.0`)

#### Endpoints Used:
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/wearables/apple/register_device` | POST | Register iOS device |
| `/api/wearables/apple/ingest` | POST | Send metrics to backend |
| `/api/wearables/apple/tracked_metrics` | GET | Get user's selected metrics |
| `/api/wearables/apple/devices` | GET | List user's devices |

---

## Backend API Components

### 1. Wearables Service (`backend/services/wearables_service.py`)

#### Device Registration:
- Generates UUID for `device_id`
- Generates 32-byte random `device_secret` (base64 encoded)
- Stores in `wearable_devices` table

#### Ingest Processing Pipeline:
1. **Device Verification**: Check device exists, belongs to user, is active
2. **Signature Verification**: Verify HMAC-SHA256 signature
3. **Idempotency Check**: Prevent duplicate processing via `client_event_id` (24-hour window)
4. **Metric Storage**: Store in `wearable_metrics` table
5. **Habit Log Conversion**: Convert metrics to `habit_logs` for dashboard display
6. **Tinybird Sync**: Send to Tinybird for analytics

### 2. Tracked Metrics Endpoint

The `/api/wearables/apple/tracked_metrics` endpoint queries:
```sql
SELECT * FROM habits 
WHERE user_id = ? 
  AND integration_source = 'apple_health' 
  AND metric_type IS NOT NULL
```

This returns which Apple Health metrics the user has selected to track in the desktop app.

### 3. Habit Log Conversion

When metrics are ingested, they're converted to `habit_logs`:
- Finds matching habit by `metric_type` (e.g., `steps` → habit with `metric_type='steps'`)
- Creates/updates habit_log for that date
- Sets `source = 'apple_health'`
- Syncs to Tinybird for analytics

---

## Desktop App Integration

### Habit Selection (`habit-selection-modal.tsx`)

When user selects an Apple Watch metric:
- Creates habit with `integration_source = 'apple_health'`
- Sets `metric_type` to the HealthKit metric identifier (e.g., `steps`, `hr`, `sleep_session`)
- Sets `sensor_type = 'Apple Watch'`

### Available Apple Watch Metrics in Desktop:
- Steps, Active/Resting Calories, Distance, Flights Climbed
- Exercise Minutes, Stand Time
- Heart Rate, HRV, Resting HR, Walking HR
- Sleep Duration, REM/Deep/Core Sleep
- Blood Oxygen, Respiratory Rate
- Workouts, Mindful Minutes

---

## Data Flow: End-to-End

1. **User Action in Desktop App**: Selects "Steps" from Apple Watch category
2. **Habit Created**: `{integration_source: 'apple_health', metric_type: 'steps'}`
3. **iOS App Fetches Tracked Metrics**: Calls `/api/wearables/apple/tracked_metrics`
4. **iOS App Enables HealthKit Observer**: `enableBackgroundDelivery` for step count
5. **Apple Watch Records Steps**: New data appears in HealthKit
6. **HealthKit Observer Fires**: Triggers sync in iOS app
7. **iOS App Fetches Steps**: Queries HealthKit for step count (Apple Watch sources only)
8. **iOS App Sends to Backend**: POST to `/api/wearables/apple/ingest` with signed payload
9. **Backend Stores Metric**: Saved to `wearable_metrics` table
10. **Backend Creates Habit Log**: Converted to `habit_logs` entry with `source='apple_health'`
11. **Backend Syncs to Tinybird**: Sent for analytics processing
12. **Desktop Dashboard Updates**: Displays step count for today

---

## Database Schema (Relevant Tables)

### `habits`
```sql
- id: String (UUID)
- user_id: String (FK)
- name: String
- category: String
- integration_source: String ('apple_health', 'whoop', etc.)
- metric_type: String ('steps', 'hr', 'sleep_session', etc.)
- unit_type: String
- sensor_type: String ('Apple Watch', 'Manual', etc.)
```

### `habit_logs`
```sql
- id: String (UUID)
- habit_id: String (FK)
- habit_name: String
- date: String (YYYY-MM-DD)
- amount: Float
- status: String
- source: String ('apple_health', 'manual', etc.)
- completed_at: String (ISO datetime)
```

### `wearable_devices`
```sql
- id: String (UUID)
- user_id: String (FK)
- device_name: String
- platform: String ('ios')
- device_secret_hash: String
- registered_at: DateTime
- last_sync_at: DateTime
- is_active: Boolean
```

### `wearable_metrics`
```sql
- id: String (UUID)
- user_id: String (FK)
- device_id: String (FK)
- source: String ('apple_health')
- metric_type: String
- start_time: DateTime
- end_time: DateTime
- value: Float
- unit: String
- created_at: DateTime
```

---

## Current Implementation: Potential Issues & Recommendations

### ISSUE 1: Sleep Data Attribution
**Problem**: Sleep metrics use `startOfDay` for date attribution, which may not correctly attribute overnight sleep.
**Location**: `HealthKitManager.swift:581-582`
```swift
startTime: startOfDay,  // Use the day's start for consistent date attribution
```
**Recommendation**: Consider using the wake-up date (endDate) for sleep attribution, as users typically want to see "how I slept last night" on the day they wake up.

### ISSUE 2: No Incremental Sync
**Problem**: The app currently fetches all data for the last 7 days (manual sync) or 1 day (background sync) every time, which is inefficient.
**Location**: `HealthKitManager.swift:328`
**Recommendation**: Implement anchored queries using `HKAnchoredObjectQuery` to only fetch new/changed data since last sync. The `hk_anchor` field already exists in the API schema but isn't being used.

### ISSUE 3: Missing Workout Sync
**Problem**: Workout type is defined but marked as "not yet implemented"
**Location**: `HealthKitManager.swift:517`
```swift
case "workout":
    print("⚠️ Workout syncing not yet implemented")
```
**Recommendation**: Implement `HKWorkoutType` queries to sync workout sessions.

### ISSUE 4: Duplicate Data from Multiple Sources
**Problem**: While activity metrics filter to Apple Watch only, other metrics (sleep, heart rate) may include data from multiple sources.
**Location**: `HealthKitManager.swift:596-604`
**Recommendation**: Extend the `appleWatchOnlyMetrics` set or create source-preference logic for all metric types.

### ISSUE 5: No Offline Queue
**Problem**: If network fails during sync, data is lost.
**Location**: `BackgroundSyncManager.swift:340-342`
```swift
} catch {
    print("❌ Background sync failed: \(error)")
}
```
**Recommendation**: Implement local persistence queue for failed syncs, retry on next sync opportunity.

### ISSUE 6: Token Expiration Handling
**Problem**: When Clerk token expires, user must manually reconnect.
**Current**: Token expiration triggers `disconnect()` and clears all credentials.
**Recommendation**: Implement silent token refresh using Clerk's session refresh mechanism before making API calls.

### ISSUE 7: No Sync Status Visibility in Desktop App
**Problem**: Desktop app doesn't show detailed sync status or last sync time from iOS device.
**Recommendation**: Add endpoint to fetch device sync status and display in settings.

### ISSUE 8: Sleep Stages Not Synced Separately
**Problem**: REM, Deep, and Core sleep are fetched but only synced when explicitly tracked.
**Location**: `HealthKitManager.swift:880-914` (stages fetched but returned as separate metrics)
**Recommendation**: Consider always syncing sleep stages when sleep_session is tracked, or make them auto-included.

### ISSUE 9: Timezone Handling
**Problem**: Timezone is captured but not consistently used for cross-timezone users.
**Location**: `NormalizedMetric.swift:119`
```swift
self.timezone = timezone ?? TimeZone.current.identifier
```
**Recommendation**: Ensure backend properly handles timezone when converting to habit_logs and analytics.

### ISSUE 10: Rate Limit Too Aggressive for Background Delivery
**Problem**: 5-minute rate limit may cause missed data when HealthKit delivers multiple updates.
**Location**: `BackgroundSyncManager.swift:269`
**Recommendation**: Consider shorter rate limit for background delivery (1-2 minutes) or batch multiple HealthKit notifications.

---

## Feature Gaps (Not Yet Implemented)

1. **Local Caching**: No offline data persistence
2. **Sync History**: No UI to view past sync attempts and results
3. **Push Notifications**: No notifications for sync status or errors
4. **Data Export**: Can't export synced data from iOS app
5. **Manual Metric Entry**: Can't manually add data in iOS app
6. **Widget Support**: No iOS widgets for quick status view
7. **Watch App**: No native Apple Watch app (all data goes through iPhone)
8. **Multiple Device Support**: Unclear handling of multiple Apple Watches

---

## Security Considerations

### Strengths:
- HMAC-SHA256 request signing
- Keychain storage with `kSecAttrAccessibleAfterFirstUnlock`
- Clerk JWT authentication
- Idempotency protection
- Rate limiting on ingest endpoint (30/minute)

### Potential Concerns:
1. Device secret stored in plaintext in database (consider encryption at rest)
2. No certificate pinning for API calls
3. Debug logging includes sensitive data (signatures, canonical strings)

---

## Performance Considerations

1. **Batch Size**: Max 500 metrics per ingest request (good)
2. **Background Sync**: Only fetches 1 day of data (efficient)
3. **Manual Sync**: Fetches 7 days (may be slow for many metrics)
4. **No Pagination**: Large metric queries could be slow
5. **Tinybird Sync**: Happens synchronously during ingest (consider async)

---

## Testing Recommendations

1. Test with Apple Watch disconnected (iPhone-only data handling)
2. Test background delivery with app in various states
3. Test token expiration scenarios
4. Test timezone changes (travel scenarios)
5. Test with large historical data sets
6. Test multiple device registration
7. Test conflict resolution when same metric from multiple sources

---

## Summary: What Works Well

1. Clean separation of concerns (Manager, Service, API patterns)
2. Comprehensive metric support (18 types)
3. Smart Apple Watch filtering for activity metrics
4. Robust authentication flow with Clerk
5. Background sync with multiple triggers
6. Idempotency protection
7. Dual storage (raw metrics + habit logs)
8. Real-time HealthKit observer queries

## Summary: Areas for Improvement

1. ~~Implement incremental/anchored sync~~ ✅ IMPLEMENTED
2. ~~Add offline queue for failed syncs~~ ✅ IMPLEMENTED
3. ~~Implement silent token refresh~~ ✅ IMPLEMENTED
4. ~~Add workout sync support~~ ✅ IMPLEMENTED
5. ~~Better sleep date attribution~~ ✅ IMPLEMENTED
6. ~~Sync status visibility in desktop~~ ✅ IMPLEMENTED
7. ~~Consider shorter background sync intervals~~ ✅ IMPLEMENTED (5 min bg, 2 min fg)
8. Add local caching for better UX (future)

---

## Implementation Summary (January 2026)

### New iOS Files Created

1. **`AnchorStorage.swift`** - Persistent storage for HKQueryAnchor per metric type
   - Stores anchors in UserDefaults
   - Enables incremental sync by tracking last sync position
   - Includes debug info for troubleshooting

2. **`OfflineSyncQueue.swift`** - Offline queue with retry semantics
   - File-based persistent queue using JSON
   - Exponential backoff (1 min → 1 hour max)
   - Max 10 attempts, 14-day retention
   - Network reachability monitoring via NWPathMonitor
   - Auto-flushes when network becomes available

3. **`HealthKitManagerV2.swift`** - Complete rewrite with incremental sync
   - Uses `HKAnchoredObjectQuery` for delta fetches
   - Source preference policy per metric type
   - Sleep attribution to wake day (endDate)
   - Workout sync support with activity types
   - Source bundle ID and device name tracking

4. **`BackgroundSyncManagerV2.swift`** - Enhanced background sync
   - Shorter intervals (5 min background, 2 min foreground)
   - Incremental sync integration
   - Silent token refresh before sync
   - Offline queue integration
   - Detailed sync status for UI

### Modified iOS Files

1. **`APIModels.swift`** - Added V2 request/response models
   - `AppleIngestRequestV2` with added/deleted/modified arrays
   - `AppleIngestResponseV2` with confirmed anchors
   - `DeleteResult` for deletion tracking

2. **`NormalizedMetric.swift`** - Enhanced metric model
   - `sourceBundleId` for source tracking
   - `sourceDeviceName` for device identification
   - `attributedDate` for sleep wake-day attribution
   - `WorkoutMetric` struct with activity details

3. **`RitualAPIClient.swift`** - Token refresh & V2 support
   - `ensureValidToken()` - silent token refresh
   - `ingestMetricsV2()` - incremental sync endpoint
   - Token expiry tracking
   - New error types: `tokenRefreshFailed`, `noSession`, `networkUnavailable`

### New Backend Files/Changes

1. **`schemas/wearables_apple.py`** - Added V2 schemas
   - `AppleIngestRequestV2` with added/deleted/modified
   - `AppleIngestResponseV2` with confirmed anchors
   - `DeleteResult` for deletion results
   - `SyncStatusResponse` for desktop UI
   - Enhanced `NormalizedMetricSchema` with source tracking

2. **`services/wearables_service.py`** - Enhanced service
   - `delete_metrics_by_external_ids()` - handle HealthKit deletions
   - `process_ingest_request_v2()` - V2 ingest handler
   - `get_device_sync_status()` - sync status for UI
   - Async Tinybird batch sync with queuing

3. **`main.py`** - New endpoints
   - `POST /api/wearables/apple/ingest/v2` - incremental ingest
   - `GET /api/wearables/apple/devices/{id}/status` - device sync status
   - `GET /api/wearables/apple/sync-status` - all devices status

### New Desktop Component

1. **`components/apple-health-sync-status.tsx`** - Sync status UI
   - Shows connection status with visual indicators
   - Device list with last sync times
   - Error display with details
   - Metrics synced today counter
   - Offline queue status
   - Auto-refresh every 60 seconds

### Key Improvements

| Feature | Before | After |
|---------|--------|-------|
| Sync Method | Full 7-day refetch | Incremental via HKAnchoredObjectQuery |
| Failed Syncs | Lost | Queued with exponential backoff |
| Token Expiry | Manual reconnect | Silent refresh |
| Sleep Attribution | Start day | Wake day (endDate) |
| Source Filtering | Activity only | All metrics via preference policy |
| Workout Support | Not implemented | Full support with activity types |
| Sync Intervals | 15 min bg / 5 min fg | 5 min bg / 2 min fg |
| Tinybird Sync | Blocking | Async batch queue |
| Desktop Visibility | None | Full sync status component |
