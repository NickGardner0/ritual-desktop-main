# Apple Health Integration Guide

This document describes the Apple Health integration architecture for Ritual.

## Overview

The Apple Health integration consists of three components:

1. **iOS Companion App** (`apps/ios-companion/`) - SwiftUI app that reads HealthKit data
2. **Backend API** (`apps/backend/`) - FastAPI endpoints for device registration and metric ingestion
3. **Shared Contracts** (`packages/shared-contracts/`) - TypeScript types shared across apps

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   iOS Companion     │────▶│   FastAPI Backend   │────▶│   Turso Database    │
│   (HealthKit)       │     │   (Validation)      │     │   (Storage)         │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
         │                           │                           │
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  Keychain Storage   │     │  Clerk Auth (JWT)   │     │  Desktop App        │
│  (device_secret)    │     │  + HMAC Signature   │     │  (Read metrics)     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

## Database Schema

### wearable_devices

Stores registered devices:

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Device identifier |
| user_id | UUID | Owner user ID |
| device_name | String | User-friendly name (e.g., "Nick's iPhone") |
| platform | String | "ios" or "android" |
| device_secret_hash | String | Secret for request signing |
| registered_at | DateTime | Registration timestamp |
| last_sync_at | DateTime | Last successful sync |
| is_active | Boolean | Whether device is active |

### wearable_metrics

Stores normalized health metrics:

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Metric identifier |
| user_id | UUID | Owner user ID |
| device_id | UUID | Source device |
| source | String | "apple_health", "whoop", etc. |
| metric_type | String | "steps", "active_energy", etc. |
| start_time | DateTime | Metric window start |
| end_time | DateTime | Metric window end |
| value | Float | Metric value |
| unit | String | "count", "kcal", etc. |
| timezone | String | IANA timezone |
| external_id | String | HealthKit sample UUID |
| raw_payload | JSON | Original HealthKit data |

### wearable_ingest_events

Tracks ingest events for idempotency:

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Event identifier |
| device_id | UUID | Source device |
| client_event_id | UUID | Client-provided for idempotency |
| metrics_count | Integer | Total metrics in request |
| success_count | Integer | Successfully stored |
| error_count | Integer | Failed to store |
| status | String | "success", "partial", "failed" |

## API Endpoints

### POST /api/wearables/apple/register_device

Register a new iOS device.

**Request:**
```json
{
  "device_name": "Nick's iPhone",
  "platform": "ios"
}
```

**Response:**
```json
{
  "device_id": "abc-123-def",
  "device_secret": "base64-encoded-secret",
  "registered_at": "2024-01-15T10:30:00Z"
}
```

### POST /api/wearables/apple/ingest

Ingest normalized metrics from Apple Health.

**Request:**
```json
{
  "device_id": "abc-123-def",
  "client_event_id": "uuid-for-idempotency",
  "captured_at": "2024-01-15T10:30:00Z",
  "metrics": [
    {
      "source": "apple_health",
      "metric_type": "steps",
      "start_time": "2024-01-15T00:00:00Z",
      "end_time": "2024-01-15T23:59:59Z",
      "value": 8500,
      "unit": "count",
      "timezone": "America/New_York"
    }
  ],
  "schema_version": 1,
  "signature": "base64-hmac-signature"
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {"index": 0, "success": true, "stored_id": "metric-uuid"}
  ],
  "server_time": "2024-01-15T10:30:01Z",
  "next_poll_seconds": 60
}
```

## Request Signing

All ingest requests must be signed with HMAC-SHA256:

### Canonical String Format

```
device_id + "\n" +
client_event_id + "\n" +
captured_at + "\n" +
sha256(metrics_json_string)
```

### Signature Computation

```swift
// Swift example
let canonicalString = "\(deviceId)\n\(clientEventId)\n\(capturedAt)\n\(metricsHash)"
let key = SymmetricKey(data: Data(base64Encoded: deviceSecret)!)
let signature = HMAC<SHA256>.authenticationCode(for: Data(canonicalString.utf8), using: key)
let signatureBase64 = Data(signature).base64EncodedString()
```

```python
# Python verification
import hmac
import hashlib
import base64

canonical = f"{device_id}\n{client_event_id}\n{captured_at}\n{metrics_hash}"
secret_bytes = base64.b64decode(device_secret)
expected = hmac.new(secret_bytes, canonical.encode(), hashlib.sha256).digest()
expected_b64 = base64.b64encode(expected).decode()
is_valid = hmac.compare_digest(expected_b64, provided_signature)
```

## Supported Metrics

### Currently Implemented

| Metric Type | Unit | HealthKit Type |
|-------------|------|----------------|
| steps | count | HKQuantityType.stepCount |
| active_energy | kcal | HKQuantityType.activeEnergyBurned |

### Planned

| Metric Type | Unit | HealthKit Type |
|-------------|------|----------------|
| hr | bpm | HKQuantityType.heartRate |
| hrv | ms | HKQuantityType.heartRateVariabilitySDNN |
| sleep_session | hours | HKCategoryType.sleepAnalysis |
| mindful_minutes | minutes | HKCategoryType.mindfulSession |

## Setup Instructions

### 1. Run Database Migration

```bash
cd backend
python apps/backend/scripts/run_database_migrations.py
```

### 2. Start Backend

```bash
cd backend
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Setup iOS App

Using Tuist:
```bash
cd apps/ios-companion
tuist generate
open RitualCompanion.xcworkspace
```

Or create a new Xcode project manually and add the source files.

### 4. Configure Backend URL

Update `RitualAPIClient.swift`:
```swift
#if DEBUG
private let baseURL = "http://YOUR_LOCAL_IP:8000"
#endif
```

### 5. Test the Flow

1. Launch iOS app → Connect
2. Grant Health permissions
3. Tap "Sync Now"
4. Verify in backend logs

## Security Considerations

1. **Auth Token**: JWT from Clerk, verified via JWKS
2. **Device Secret**: Stored in iOS Keychain, never transmitted after registration
3. **Request Signing**: HMAC-SHA256 prevents request tampering
4. **Idempotency**: client_event_id prevents duplicate processing

## Troubleshooting

### "Invalid signature" error

- Ensure device_secret is stored correctly in Keychain
- Check that metrics JSON is sorted consistently
- Verify canonical string format matches backend

### "Device not found" error

- Device may have been deactivated
- Check device_id is correct
- Re-register the device

### No metrics syncing

- Check HealthKit authorization in iOS Settings
- Ensure there's data in Health app for today
- Check backend logs for errors

## Background Sync

The iOS companion app supports automatic background sync:

### Mechanisms

1. **HealthKit Background Delivery**: When new health data is recorded, iOS notifies the app via `HKObserverQuery`. The app then syncs the new data to the backend.

2. **BGTaskScheduler**: The app schedules background refresh tasks that run approximately every 15 minutes (iOS determines actual timing).

3. **Foreground Sync**: When the app becomes active, it automatically syncs if >5 minutes have passed since the last sync.

### Configuration (Info.plist)

```xml
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.ritual.companion.healthsync</string>
</array>
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>processing</string>
</array>
```

### Entitlements

```xml
<key>com.apple.developer.healthkit.background-delivery</key>
<true/>
```

### Rate Limiting

- Minimum 5 minutes between syncs (foreground and background)
- Prevents API overload while keeping data fresh

### Debugging

The `BackgroundSyncManager` provides a `debugInfo` property that shows:
- Setup status
- Last sync time
- Total sync count
- Active observer count
- Cached metric types
