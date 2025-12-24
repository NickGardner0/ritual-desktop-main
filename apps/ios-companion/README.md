# Ritual Companion - iOS App

SwiftUI companion app for syncing Apple Health data with Ritual.

## Features

- 🔐 **Clerk Authentication** - Secure sign-in with Clerk iOS SDK
- 🔗 **Secure Device Registration** - HMAC-SHA256 signed device registration
- ❤️ **HealthKit Integration** - Sync steps, active energy, heart rate, HRV, sleep, and more
- 🔄 **Manual Sync** - On-demand health data synchronization
- ⏰ **Automatic Background Sync** - Syncs data automatically when new HealthKit data is available
- 📱 **Foreground Sync** - Automatically syncs when app becomes active
- 🎨 **Modern UI** - Beautiful SwiftUI interface

## Quick Start

See **[QUICK-START.md](./QUICK-START.md)** for a quick configuration checklist, or **[IOS-SETUP-GUIDE.md](./IOS-SETUP-GUIDE.md)** for detailed setup instructions.

## Setup

### Prerequisites

- ✅ Apple Developer Account (approved)
- Xcode 15+
- iOS 17+ device or simulator
- Clerk account with application created
- [Tuist](https://tuist.io/) (optional, for project generation)

### With Tuist

```bash
cd apps/ios-companion
tuist generate
open RitualCompanion.xcworkspace
```

### Without Tuist (Manual Xcode Project)

1. Create a new Xcode project:
   - iOS App, SwiftUI
   - Name: RitualCompanion
   - Bundle ID: com.ritual.companion

2. Add the source files from `Sources/RitualCompanion/`

3. Add capabilities:
   - HealthKit (read access for StepCount, ActiveEnergyBurned)

4. Add Info.plist entries:
   ```xml
   <key>NSHealthShareUsageDescription</key>
   <string>Ritual needs access to read your health data...</string>
   
   <!-- Required for background sync -->
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

## Architecture

```
Sources/RitualCompanion/
├── App/
│   ├── RitualCompanionApp.swift    # App entry point with Clerk setup + lifecycle
│   └── AppState.swift              # Global state management
├── Config/
│   └── AppConfig.swift             # Configuration management
├── Models/
│   ├── NormalizedMetric.swift      # Metric data models
│   └── APIModels.swift             # API request/response types
├── Services/
│   ├── BackgroundSyncManager.swift # Background sync + HealthKit observers
│   ├── HealthKitManager.swift      # HealthKit queries
│   └── RitualAPIClient.swift       # API client + signing
└── Views/
    ├── ContentView.swift           # Main container
    ├── ConnectView.swift           # Clerk auth + connection flow
    ├── StatusView.swift            # Connected state UI
    └── Components/
        ├── StatusCard.swift        # Reusable status card
        └── PermissionsView.swift   # Permissions sheet
```

## API Endpoints Used

- `POST /api/wearables/apple/register_device` - Register device
- `POST /api/wearables/apple/ingest` - Sync metrics
- `GET /api/wearables/apple/devices` - List devices

## Request Signing

All ingest requests are signed with HMAC-SHA256:

```
Canonical string = device_id + "\n" + client_event_id + "\n" + captured_at + "\n" + sha256(metrics_json)
Signature = base64(HMAC-SHA256(device_secret, canonical_string))
```

## Configuration

### Clerk Setup

1. Get your Clerk publishable key from the [Clerk Dashboard](https://dashboard.clerk.com)
2. Add it to Xcode Build Settings as `CLERK_PUBLISHABLE_KEY`
3. Update the associated domain in `Project.swift` to match your Clerk instance

### API Configuration

The app uses `AppConfig` to manage configuration. Set these in Xcode Build Settings:

- `CLERK_PUBLISHABLE_KEY` - Your Clerk publishable key
- `CLERK_FRONTEND_API` - Your Clerk frontend API domain
- `API_BASE_URL_DEBUG` - Local backend URL (e.g., `http://192.168.1.237:8000`)
- `API_BASE_URL` - Production backend URL

## Development

### Local Backend

The app automatically uses the debug URL in development builds. Update `API_BASE_URL_DEBUG` in Xcode Build Settings to point to your local backend.

### Testing on Simulator

- HealthKit works on simulator but may return limited data
- **Associated Domains require a real device** - Clerk authentication with associated domains won't work in simulator
- For full testing, use a real iOS device

## Authentication Flow

1. User opens app → Shows sign-in screen
2. User taps "Sign In" → Clerk AuthView presented
3. User completes authentication → Clerk session created
4. User taps "Connect to Ritual" → Device registered with backend using Clerk JWT
5. User grants HealthKit permissions → Ready to sync
6. User taps "Sync Now" → Health data synced to backend

## Background Sync

The app supports automatic background sync using two mechanisms:

### 1. HealthKit Background Delivery
When new health data is recorded (e.g., steps from Apple Watch), iOS notifies the app and triggers a sync. This uses `HKObserverQuery` with background delivery enabled.

### 2. BGTaskScheduler
The app schedules background app refresh tasks that run approximately every 15 minutes (iOS determines actual timing based on usage patterns).

### How it works:
1. When user connects, the app fetches tracked metrics from the backend
2. Background delivery is enabled for those specific HealthKit types
3. When new data arrives OR the app comes to foreground, a sync is triggered
4. Data is synced to the backend using the same signed API requests

### Rate Limiting
- Background syncs: minimum 5 minutes between syncs
- Foreground syncs: minimum 5 minutes between syncs
- Prevents excessive API calls while ensuring data stays fresh

## Next Steps

- [x] Integrate Clerk iOS SDK for authentication
- [x] Add background sync with BackgroundTasks
- [x] Add more HealthKit metrics (HRV, sleep, heart rate, etc.)
- [x] Add automatic periodic sync
- [ ] Add local caching for offline support
- [ ] Add sync history and status tracking
- [ ] Add push notifications for sync status
