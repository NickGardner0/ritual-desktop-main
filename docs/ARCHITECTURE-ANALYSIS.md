# Ritual Desktop - Architecture Analysis

**Generated:** February 4, 2026  
**Scope:** Complete codebase analysis covering architecture, data flows, and production concerns

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Frontend Architecture (Next.js)](#frontend-architecture-nextjs)
4. [Backend Architecture (Python/FastAPI)](#backend-architecture-pythonfastapi)
5. [Desktop Application (Tauri/Rust)](#desktop-application-taurirust)
6. [iOS Companion App (Swift)](#ios-companion-app-swift)
7. [Data Infrastructure (Tinybird)](#data-infrastructure-tinybird)
8. [External Services & Integrations](#external-services--integrations)
9. [Security Analysis](#security-analysis)
10. [Performance Analysis](#performance-analysis)
11. [Cost Analysis](#cost-analysis)
12. [Reliability Analysis](#reliability-analysis)
13. [Critical Issues Summary](#critical-issues-summary)
14. [Recommendations](#recommendations)

---

## Executive Summary

Ritual is a habit tracking and personal analytics platform consisting of:

- **Desktop App**: Tauri-based macOS application with screen recording, activity tracking, and AI-powered search
- **Web Frontend**: Next.js 16 App Router with React Query, Clerk auth, and Tailwind UI
- **Backend API**: Python FastAPI with Turso (libSQL) database and Tinybird analytics
- **iOS Companion**: Swift app for Apple Health data sync
- **Background Jobs**: Trigger.dev for scheduled WHOOP data syncing

### Key Strengths
- Well-structured codebase with clear separation of concerns
- Modern tech stack with good developer experience
- Comprehensive health data integration (Apple Health, WHOOP)
- Efficient analytics with Tinybird (ClickHouse)
- Privacy-focused desktop app with local data storage

### Critical Issues Requiring Attention
1. **Security**: TypeScript build errors ignored, permissive CORS, hardcoded credentials
2. **Performance**: No connection pooling, synchronous imports, missing query caching
3. **Reliability**: No retry logic for external APIs, missing background job system
4. **Cost**: Potential for runaway analytics costs without rate limiting

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER DEVICES                                    │
├─────────────────────┬───────────────────────┬───────────────────────────────┤
│   macOS Desktop     │      Web Browser      │        iOS Device             │
│   (Tauri App)       │      (Next.js)        │    (Companion App)            │
│                     │                       │                               │
│  ┌───────────────┐  │                       │   ┌─────────────────┐         │
│  │ ritual-watcher│  │                       │   │  HealthKit      │         │
│  │ (activity)    │  │                       │   │  Integration    │         │
│  └───────────────┘  │                       │   └─────────────────┘         │
│  ┌───────────────┐  │                       │                               │
│  │ ritual-recorder│ │                       │                               │
│  │ (screen/OCR)  │  │                       │                               │
│  └───────────────┘  │                       │                               │
│  ┌───────────────┐  │                       │                               │
│  │ Native Timer  │  │                       │                               │
│  │ (Swift Widget)│  │                       │                               │
│  └───────────────┘  │                       │                               │
└─────────────────────┴───────────────────────┴───────────────────────────────┘
                              │                           │
                              ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NEXT.JS APPLICATION                               │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   App Router    │  │   API Routes    │  │      Server Actions         │  │
│  │   (Dashboard)   │  │   (/api/*)      │  │   (Habits, Analytics)       │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  React Query    │  │     Clerk       │  │       OpenPanel             │  │
│  │  (State/Cache)  │  │     (Auth)      │  │      (Analytics)            │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PYTHON BACKEND (FastAPI)                            │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   Habits API    │  │  Analytics API  │  │     Integrations API        │  │
│  │   (CRUD)        │  │  (Queries)      │  │   (WHOOP, Health)           │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   Auth Service  │  │  Import Service │  │     Watcher API             │  │
│  │   (Clerk JWT)   │  │  (CSV/Health)   │  │   (Activity Sync)           │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA STORES                                       │
├─────────────────────────────┬───────────────────────────────────────────────┤
│        TURSO (libSQL)       │            TINYBIRD (ClickHouse)              │
│    Transactional Database   │           Analytics Database                  │
│                             │                                               │
│  • Users                    │  • habit_logs                                 │
│  • Habits                   │  • whoop_sleep_data                           │
│  • Habit Logs               │  • whoop_recovery_data                        │
│  • Import Runs              │  • whoop_workout_data                         │
│  • Integrations             │  • computer_activity_daily                    │
│  • Watcher Events           │                                               │
│  • AI Conversations         │  Pipes (Analytics Endpoints):                 │
│                             │  • analytics_summary                          │
│                             │  • habit_streaks                              │
│                             │  • habit_trends                               │
│                             │  • habit_correlation                          │
└─────────────────────────────┴───────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       EXTERNAL SERVICES                                     │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│     Clerk       │    OpenAI       │    WHOOP API    │    Trigger.dev        │
│  (Auth/Users)   │  (AI Chat)      │  (Health Data)  │  (Scheduled Jobs)     │
├─────────────────┼─────────────────┼─────────────────┼───────────────────────┤
│    Sentry       │   OpenPanel     │    Typesense    │                       │
│ (Error Track)   │  (Analytics)    │    (Search)     │                       │
└─────────────────┴─────────────────┴─────────────────┴───────────────────────┘
```

---

## Frontend Architecture (Next.js)

### Technology Stack
- **Framework**: Next.js 16.0.3 with App Router
- **UI**: React 19, Tailwind CSS, shadcn/ui (Radix primitives)
- **State**: React Query (TanStack Query)
- **Auth**: Clerk
- **Desktop**: Tauri integration via `@tauri-apps/api`

### Directory Structure

```
apps/dashboard/app/
├── (dashboard)/              # Route group for authenticated pages
│   ├── layout.tsx            # Shared dashboard layout
│   ├── dashboard/            # Main dashboard
│   ├── activity/             # Computer activity tracking
│   ├── analytics/            # Analytics dashboard
│   ├── calendar/             # Calendar view
│   ├── chat/                 # AI chat interface
│   └── integrations/         # Third-party integrations
├── api/                      # API routes (45+ endpoints)
│   ├── analytics/            # Tinybird queries
│   ├── chat/                 # AI streaming
│   ├── habits/               # Habit CRUD
│   ├── watcher/              # Activity tracking
│   └── integrations/         # OAuth flows
├── welcome/                  # Public welcome page
├── onboarding/               # Onboarding flow
└── sign-in/, sign-up/        # Clerk auth pages

apps/dashboard/components/
├── analytics/                # Analytics components (11 files)
├── computer-activity/        # Activity tracking UI (8 files)
├── screen-recorder/          # Screen recording UI (5 files)
├── chat/                     # AI chat interface
├── ui/                       # shadcn/ui primitives (34 files)
└── dashboard-layout.tsx      # Main layout wrapper

apps/dashboard/contexts/
├── HabitsContext.tsx         # Habits state (React Query wrapper)
├── AIContext.tsx             # Chat visibility/mode state
└── FontContext.tsx           # Font preference persistence

apps/dashboard/hooks/
├── use-habits-query.ts       # React Query hooks for habits
├── use-recorder.ts           # Screen recording state
├── use-semantic-search.ts    # AI-powered search
└── use-usage-breakdown.ts    # Activity analytics

apps/dashboard/lib/
├── ai/                       # AI agent definitions
├── query-client.ts           # React Query configuration
├── tinybird-analytics-service.ts  # Tinybird client
└── python-api-client.ts      # Backend API client (deprecated)
```

### Key Patterns

#### Server/Client Component Separation
```typescript
// Server Component (layout.tsx)
export default function SharedDashboardLayout({ children }) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}

// Client Component wrapper (dashboard-layout-client.tsx)
'use client';
export function DashboardLayoutClient({ children }) {
  // Client-only logic (hooks, event handlers)
}
```

#### React Query Configuration
```typescript
// apps/dashboard/lib/query-client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,     // 5 minutes
      refetchOnWindowFocus: false,  // Desktop app behavior
      retry: 1,
    },
  },
});
```

#### Lazy Loading for Performance
```typescript
// apps/dashboard/components/dashboard-layout.tsx
const TimeTrackerWidget = lazy(() => import('@/components/timer/TimeTrackerWidget'));
const CommandPalette = lazy(() => import('@/components/habit-selector'));
```

### Authentication Flow
1. User visits protected route
2. Middleware checks Clerk session (`middleware.ts`)
3. Redirect to sign-in if not authenticated
4. Clerk JWT passed to backend API calls
5. Backend validates JWT via JWKS

### Data Flow
1. **Reads**: React Query fetches from Next.js API routes → Python backend
2. **Writes**: Server Actions or API routes → Python backend → Turso + Tinybird
3. **Caching**: 5-minute stale time, optimistic updates for mutations

---

## Backend Architecture (Python/FastAPI)

### Technology Stack
- **Framework**: FastAPI (async)
- **Database**: Turso Cloud (libSQL/SQLite) with local replica
- **ORM**: SQLAlchemy 2.0 (async)
- **Auth**: Clerk JWT validation
- **Rate Limiting**: slowapi

### Directory Structure

```
apps/backend/
├── main.py                   # Entry point (3,447 lines - needs refactoring)
├── database/
│   ├── connection.py         # Turso connection setup
│   └── models.py             # SQLAlchemy models
├── services/
│   ├── auth_service.py       # Clerk JWT validation
│   ├── import_service.py     # CSV/Health import logic
│   ├── whoop_service.py      # WHOOP API integration
│   ├── wearables_service.py  # Apple Health integration
│   └── tinybird_service.py   # Analytics ingestion
├── api/
│   └── watcher.py            # Computer activity API
└── scripts/
    └── migrate_*.py          # Manual migration scripts
```

### Database Models

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CORE MODELS                                       │
├─────────────────────┬───────────────────────┬───────────────────────────────┤
│      UserDB         │       HabitDB         │       HabitLogDB              │
├─────────────────────┼───────────────────────┼───────────────────────────────┤
│ id (PK)             │ id (PK)               │ id (PK)                       │
│ clerk_id (unique)   │ user_id (FK)          │ habit_id (FK)                 │
│ email               │ name                  │ user_id (FK)                  │
│ onboarding_data     │ category              │ habit_name (denormalized)     │
│ created_at          │ target_value          │ value                         │
│                     │ unit                  │ date                          │
│                     │ options_json          │ source                        │
│                     │ is_active             │ client_event_id (dedupe)      │
└─────────────────────┴───────────────────────┴───────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         INTEGRATION MODELS                                  │
├─────────────────────┬───────────────────────┬───────────────────────────────┤
│  WhoopIntegrationDB │   WearableDeviceDB    │   WearableMetricDB            │
├─────────────────────┼───────────────────────┼───────────────────────────────┤
│ id (PK)             │ id (PK)               │ id (PK)                       │
│ user_id (FK)        │ user_id (FK)          │ device_id (FK)                │
│ access_token        │ device_uuid           │ metric_type                   │
│ refresh_token       │ device_name           │ value                         │
│ token_expires_at    │ device_secret         │ date                          │
│ last_sync_at        │ platform              │ external_id                   │
│ sync_enabled        │ status                │ source                        │
└─────────────────────┴───────────────────────┴───────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         WATCHER MODELS                                      │
├─────────────────────┬───────────────────────┬───────────────────────────────┤
│   WatcherDeviceDB   │   ActivityEventDB     │   DailyActivityRollupDB       │
├─────────────────────┼───────────────────────┼───────────────────────────────┤
│ id (PK)             │ id (PK)               │ id (PK)                       │
│ user_id (FK)        │ device_id (FK)        │ device_id (FK)                │
│ device_uuid         │ timestamp             │ date                          │
│ device_name         │ app_name              │ total_active_seconds          │
│ platform            │ window_title          │ total_afk_seconds             │
│ last_heartbeat      │ browser_url           │ app_usage_json                │
│                     │ duration_seconds      │ domain_usage_json             │
│                     │ is_afk                │                               │
└─────────────────────┴───────────────────────┴───────────────────────────────┘
```

### API Endpoints Summary

| Category | Endpoints | Purpose |
|----------|-----------|---------|
| Users | 2 | Profile, onboarding |
| Habits | 8 | CRUD, logging, batch |
| Analytics | 5 | Summary, trends, correlation |
| Integrations | 6 | WHOOP OAuth, sync |
| Wearables | 4 | Apple Health ingest |
| Import | 5 | CSV/Health import |
| Search | 4 | Full-text, federated |
| Watcher | 15+ | Activity tracking |

### Rate Limiting Configuration
```python
# Per-endpoint limits (slowapi)
@limiter.limit("10/minute")    # Habit creation
@limiter.limit("60/minute")    # Habit logging
@limiter.limit("30/minute")    # Analytics queries
```

---

## Desktop Application (Tauri/Rust)

### Technology Stack
- **Framework**: Tauri 1.8.1
- **Language**: Rust (backend), TypeScript (frontend)
- **Database**: SQLite (local), libSQL (unified)
- **Native**: macOS APIs via objc2, core-foundation

### Architecture

```
apps/desktop/src-tauri/
├── src/
│   ├── main.rs               # Entry point, command registration
│   ├── watcher.rs            # Activity tracking commands (25)
│   ├── recorder.rs           # Screen recording commands (18)
│   ├── ritual_database.rs    # Unified database commands (18)
│   └── native_widget.rs      # Swift widget IPC (9)
├── bin/
│   ├── ritual-watcher/       # Sidecar: activity tracking
│   └── ritual-recorder/      # Sidecar: screen capture + OCR
├── crates/
│   └── ritual-db/            # Unified database crate
└── tauri.conf.json           # Tauri configuration
```

### Sidecar Processes

#### ritual-watcher (Activity Tracking)
- **Purpose**: Tracks active application, window title, browser URLs
- **Permissions**: Requires macOS Accessibility permission
- **Storage**: `~/.ritual/watcher.db` (SQLite)
- **Features**:
  - Browser URL tracking (Chrome, Safari, Firefox)
  - AFK detection (15-minute timeout)
  - Incognito mode tracking (optional)
  - App icon extraction

#### ritual-recorder (Screen Recording)
- **Purpose**: Captures screen frames with OCR
- **Permissions**: Requires Screen Recording permission
- **Storage**: 
  - `~/.ritual/frames.db` - OCR data
  - `~/.ritual/thumbnails/` - Frame images
  - `~/.ritual/video/` - Video chunks (optional)
- **Features**:
  - Apple Vision Framework for OCR
  - Frame deduplication (SHA256 hashing)
  - On-demand frame extraction
  - 20GB default storage limit

### IPC Communication

```
┌──────────────────┐     Tauri Commands      ┌──────────────────┐
│   Next.js UI     │ ◄─────────────────────► │    Rust Core     │
│   (TypeScript)   │     invoke('cmd')       │    (src/*.rs)    │
└──────────────────┘                         └──────────────────┘
                                                      │
                                    ┌─────────────────┼─────────────────┐
                                    │                 │                 │
                            Shared SQLite      Process Spawn      File Polling
                                    │                 │                 │
                                    ▼                 ▼                 ▼
                          ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
                          │ritual-watcher│   │ritual-recorder│   │Swift Widget  │
                          │  (sidecar)   │   │  (sidecar)    │   │  (native)    │
                          └──────────────┘   └──────────────┘   └──────────────┘
```

### Native Timer Widget (Swift)

**Communication Pattern**:
- File-based IPC (no direct process communication)
- Polling interval: 500ms
- Files in temp directory:
  - `ritual_auth_token.txt` - Auth token for API calls
  - `ritual_timer_updated.txt` - Refresh trigger
  - `ritual_refresh_token_request.txt` - Token refresh request

**Speech Recognition**:
- Uses FFI bindings to Swift code
- Requires Microphone and Speech Recognition permissions

---

## iOS Companion App (Swift)

### Technology Stack
- **UI**: SwiftUI
- **Auth**: Clerk SDK
- **Health**: HealthKit
- **Background**: BGTaskScheduler

### Architecture

```
apps/ios-companion/Sources/RitualCompanion/
├── App/
│   ├── RitualCompanionApp.swift   # Entry point
│   └── AppState.swift             # State management
├── Services/
│   ├── HealthKitManager.swift     # V1: Full sync (legacy)
│   ├── HealthKitManagerV2.swift   # V2: Incremental sync
│   ├── BackgroundSyncManager.swift    # V1 background sync
│   ├── BackgroundSyncManagerV2.swift  # V2 background sync
│   ├── RitualAPIClient.swift      # API communication
│   ├── AnchorStorage.swift        # HK anchor persistence
│   └── OfflineSyncQueue.swift     # Offline retry queue
├── Models/
│   ├── NormalizedMetric.swift     # Cross-platform metric format
│   └── APIModels.swift            # API request/response types
└── Views/
    ├── ConnectView.swift          # Connection flow
    ├── StatusView.swift           # Sync status
    └── Components/                # Reusable UI components
```

### Data Sync Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        iOS COMPANION SYNC FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

1. APP LAUNCH
   │
   ▼
┌─────────────────┐
│ Clerk Auth      │ ──► Get JWT token
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ Device Register │ ──► HMAC-SHA256 signed request
└─────────────────┘     Returns device_secret
         │
         ▼
┌─────────────────┐
│ Fetch Tracked   │ ──► Get user's tracked metric types
│ Metrics         │     (steps, sleep, heart_rate, etc.)
└─────────────────┘
         │
         ▼
┌─────────────────┐
│ HealthKit Auth  │ ──► Request read permission for
└─────────────────┘     tracked metrics only
         │
         ▼
┌─────────────────┐
│ Background      │ ──► Register for HK observer queries
│ Delivery Setup  │     (real-time metric updates)
└─────────────────┘

2. SYNC (Background or Foreground)
   │
   ▼
┌─────────────────┐
│ V2: Incremental │ ──► HKAnchoredObjectQuery
│ Sync            │     Daily aggregation (7-day window)
└─────────────────┘     Source preference: Apple Watch only
         │
         ▼
┌─────────────────┐
│ Batch Process   │ ──► 400 items per batch
└─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ API Ingest V2   │ ──► │ Success         │ ──► Update anchors
└─────────────────┘     └─────────────────┘
         │
         ▼ (on failure)
┌─────────────────┐
│ Offline Queue   │ ──► Exponential backoff retry
└─────────────────┘     (max 10 attempts, 14-day retention)
```

### Key Features

#### V2 Daily Aggregation
- Reduces data volume by ~99% (700 daily values vs 50,000+ raw samples)
- Uses `HKStatisticsCollectionQuery` for daily sums/averages
- Source preference: Apple Watch only → Preferred source → Best available

#### Sleep Attribution
- Uses wake day (endDate) instead of start day
- Post-midnight sleep correctly attributed to wake day

#### Offline Queue
- Queues failed payloads for retry
- Network monitoring for automatic flush
- Exponential backoff: 60s → 120s → 240s → ... → 15min max

---

## Data Infrastructure (Tinybird)

### Purpose
Real-time analytics queries separated from transactional database to reduce load and costs.

### Data Sources

| Source | Purpose | TTL | Partitioning |
|--------|---------|-----|--------------|
| `habit_logs` | All habit completions | 2 years | Monthly |
| `whoop_sleep_data` | Sleep metrics | - | - |
| `whoop_recovery_data` | Recovery scores | - | - |
| `whoop_workout_data` | Workout data | - | - |
| `computer_activity_daily` | Desktop activity | - | - |

### Analytics Pipes

| Pipe | Purpose |
|------|---------|
| `analytics_summary` | Dashboard KPIs (active days, streaks, consistency) |
| `habit_streaks` | Current and longest streaks |
| `habit_trends` | Time-series trends with rolling averages |
| `habit_correlation` | Cross-habit correlation analysis |
| `whoop_analytics` | WHOOP-specific metrics |

### Dual-Write Pattern

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  API Request    │ ──► │  Turso Write    │ ──► │  Tinybird Write │
│  (Habit Log)    │     │  (Transaction)  │     │  (Analytics)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                               ⚠️ No transaction rollback
                                                  if Tinybird fails
```

---

## External Services & Integrations

### Service Dependency Map

| Service | Purpose | Cost Model | Criticality |
|---------|---------|------------|-------------|
| **Clerk** | Authentication | Per MAU | Critical |
| **Turso** | Database | Per request | Critical |
| **Tinybird** | Analytics | Per query/event | High |
| **OpenAI** | AI Chat | Per token | Medium |
| **WHOOP** | Health data | Free API | Medium |
| **Trigger.dev** | Background jobs | Per run | Medium |
| **Sentry** | Error tracking | Per event | Low |
| **OpenPanel** | User analytics | - | Low |
| **Typesense** | Search | Self-hosted | Low |

### WHOOP Integration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WHOOP OAUTH + SYNC FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

1. OAUTH AUTHORIZATION
   User clicks "Connect WHOOP" → Redirect to WHOOP OAuth
                               → User grants access
                               → Callback with auth code
                               → Exchange for access + refresh tokens
                               → Store in WhoopIntegrationDB

2. DATA SYNC (Trigger.dev hourly job)
   │
   ├── Fetch Recovery data (25 items/page)
   │   └── Store in Turso + Tinybird
   │
   ├── Fetch Sleep data (requires cycle IDs)
   │   └── Store in Turso + Tinybird
   │
   ├── Fetch Workout data
   │   └── Store in Turso + Tinybird
   │
   └── Fetch Cycle data (daily metrics)
       └── Store in Turso + Tinybird

3. TOKEN REFRESH
   On 401 response → Use refresh token → Update stored tokens
   On refresh failure → Mark integration as disconnected
```

---

## Security Analysis

### Critical Security Issues

#### 1. TypeScript Build Errors Ignored
**Location**: `next.config.mjs`
```javascript
typescript: {
  ignoreBuildErrors: true, // ⚠️ CRITICAL
}
```
**Risk**: Type errors may hide security vulnerabilities or runtime bugs.
**Recommendation**: Fix all TypeScript errors and remove this flag.

#### 2. Permissive CORS Configuration
**Location**: `next.config.mjs`
```javascript
'Access-Control-Allow-Origin': '*', // ⚠️ HIGH
```
**Risk**: Allows any origin to make requests, potential for CSRF attacks.
**Recommendation**: Restrict to specific origins (localhost, tauri://, production domain).

#### 3. Hardcoded Credentials in iOS App
**Location**: `apps/ios-companion/Sources/Config/AppConfig.swift`
```swift
static let clerkPublishableKey = "pk_test_..." // ⚠️ Test key exposed
static var apiBaseURL: String {
    #if DEBUG
    return "http://192.168.1.237:8000"  // ⚠️ Hardcoded IP
    #else
    return "https://api.ritual.app"
    #endif
}
```
**Risk**: Test keys in production, hardcoded URLs require app update to change.
**Recommendation**: Use environment-based configuration or remote config.

#### 4. No CSP in Tauri App
**Location**: `apps/desktop/src-tauri/tauri.conf.json`
```json
"csp": null // ⚠️ No Content Security Policy
```
**Risk**: XSS vulnerabilities in webview.
**Recommendation**: Add restrictive CSP.

#### 5. Plaintext Token Storage
**Location**: Backend database
- WHOOP access/refresh tokens stored unencrypted
- Wearable device secrets stored plaintext

**Risk**: Database breach exposes all user tokens.
**Recommendation**: Encrypt tokens at rest.

#### 6. Overly Permissive File System Access
**Location**: `apps/desktop/src-tauri/tauri.conf.json`
```json
"fs": {
  "scope": ["$HOME/*", "**/*"] // ⚠️ Full file system access
}
```
**Risk**: Compromised webview could access any file.
**Recommendation**: Restrict to `~/.ritual/` only.

### Authentication Security

| Component | Method | Issues |
|-----------|--------|--------|
| Frontend | Clerk JWT | Good - well-maintained |
| Backend | JWT validation via JWKS | Good - standard approach |
| iOS App | Clerk + HMAC signing | Good - defense in depth |
| Tauri IPC | None | ⚠️ No auth on commands |
| Tinybird | None | ⚠️ Public endpoints |

### Data Privacy Concerns

| Data Type | Storage | Encryption | Risk Level |
|-----------|---------|------------|------------|
| Browser URLs | SQLite (local) | None | High |
| Window titles | SQLite (local) | None | High |
| OCR text | SQLite (local) | None | High |
| Habit data | Turso (cloud) | At rest | Medium |
| WHOOP tokens | Turso (cloud) | None | High |

---

## Performance Analysis

### Frontend Performance

#### Strengths
- React Query caching (5-minute stale time)
- Lazy loading for heavy components
- Optimized package imports
- Route prefetching

#### Issues

| Issue | Location | Impact | Recommendation |
|-------|----------|--------|----------------|
| No query deduplication | React Query | Medium | Enable deduplication |
| Large bundle size | Many Radix components | Medium | Tree-shake unused |
| No image optimization | - | Low | Use next/image |

### Backend Performance

#### Strengths
- Async FastAPI (non-blocking I/O)
- Local Turso replica (reduced latency)
- Rate limiting per endpoint

#### Issues

| Issue | Location | Impact | Recommendation |
|-------|----------|--------|----------------|
| No connection pooling | `connection.py` | High | Use connection pool |
| Synchronous imports | `import_service.py` | High | Move to background job |
| N+1 queries | Some endpoints | Medium | Add eager loading |
| No Redis caching | - | Medium | Cache frequent queries |
| 3,447-line main.py | `main.py` | Medium | Split into routers |

### Desktop App Performance

#### Strengths
- Separate sidecar processes (isolated crashes)
- Frame deduplication (storage savings)
- LRU cache for frame extraction

#### Issues

| Issue | Location | Impact | Recommendation |
|-------|----------|--------|----------------|
| No connection pooling | SQLite | Medium | Add pool |
| No auto-cleanup | Storage | Medium | Add scheduled cleanup |
| CPU-intensive OCR | Recorder | Medium | Add throttling |

### Database Performance

#### Turso
- Using local replica with 5-second sync interval
- WAL mode enabled
- No query optimization visible

#### Tinybird
- Partitioned by month
- Sorted keys for efficient queries
- Deduplication via `LIMIT 1 BY id` (expensive)

---

## Cost Analysis

### Monthly Cost Estimates (Per 1,000 Users)

| Service | Estimated Cost | Scaling Factor |
|---------|---------------|----------------|
| Turso | $20-50 | Per request |
| Tinybird | $20-50 | Per query/event |
| Clerk | $25+ | Per MAU |
| OpenAI | Variable | Per token |
| Trigger.dev | $10-30 | Per run |
| Sentry | Free tier | Per event |

### Cost Risks

#### 1. Tinybird Query Abuse
**Risk**: Unauthenticated endpoints could be abused.
**Impact**: Unlimited query costs.
**Mitigation**: Add authentication, rate limiting.

#### 2. OpenAI Token Usage
**Risk**: Long chat conversations consume many tokens.
**Impact**: Unbounded costs.
**Mitigation**: Token limits, caching responses.

#### 3. Turso Per-Request Pricing
**Risk**: Many small queries expensive.
**Impact**: Database costs scale linearly.
**Mitigation**: Batch queries, caching layer.

#### 4. Clerk MAU Pricing
**Risk**: Inactive users still count as MAU.
**Impact**: Paying for inactive users.
**Mitigation**: User cleanup policy.

### Cost Optimization Opportunities

| Optimization | Estimated Savings |
|--------------|-------------------|
| Cache Tinybird queries | 30-50% |
| Batch Turso writes | 20-30% |
| Cache OpenAI responses | Variable |
| Remove duplicate syncs | 10-20% |

---

## Reliability Analysis

### Single Points of Failure

| Component | Failure Impact | Mitigation |
|-----------|----------------|------------|
| Turso Cloud | App unusable | Local replica (read-only) |
| Clerk | Auth fails | Cache JWT validation |
| Tinybird | No analytics | Fallback to Turso |
| WHOOP API | Sync fails | Retry with backoff |

### Missing Reliability Features

#### 1. No Retry Logic for External APIs
**Location**: WHOOP service, Clerk service
**Impact**: Transient failures cause permanent data loss.
**Recommendation**: Add retry with exponential backoff.

#### 2. No Background Job System
**Location**: Backend
**Impact**: Long imports block requests, no job recovery.
**Recommendation**: Add Celery or similar.

#### 3. Dual-Write Without Transactions
**Location**: Habit logging
**Impact**: Turso succeeds but Tinybird fails → data inconsistency.
**Recommendation**: Add eventual consistency pattern or transactions.

#### 4. No Database Backups
**Location**: Desktop app SQLite
**Impact**: Data loss on disk failure.
**Recommendation**: Periodic backup to cloud.

#### 5. No Health Checks
**Location**: Sidecar processes
**Impact**: Undetected failures.
**Recommendation**: Add health endpoints, auto-restart.

### Error Handling Assessment

| Component | Error Handling | Quality |
|-----------|----------------|---------|
| Frontend | Error boundaries | Good |
| Backend | Try-catch | Inconsistent |
| Tauri | Result<T, String> | Basic |
| iOS | Do-catch | Good |

---

## Critical Issues Summary

### 🔴 Critical (Fix Immediately)

| # | Issue | Component | Impact |
|---|-------|-----------|--------|
| 1 | TypeScript build errors ignored | Frontend | Security, Reliability |
| 2 | Permissive CORS (*) | Frontend | Security |
| 3 | No CSP in Tauri | Desktop | Security |
| 4 | Plaintext token storage | Backend | Security |
| 5 | Unauthenticated Tinybird endpoints | Analytics | Security, Cost |

### 🟠 High Priority (Fix Soon)

| # | Issue | Component | Impact |
|---|-------|-----------|--------|
| 6 | Hardcoded iOS credentials | iOS | Security |
| 7 | No retry logic for APIs | Backend | Reliability |
| 8 | Synchronous imports | Backend | Performance |
| 9 | No connection pooling | Backend | Performance |
| 10 | Dual sync managers (V1 + V2) | iOS | Performance, Cost |

### 🟡 Medium Priority (Plan to Fix)

| # | Issue | Component | Impact |
|---|-------|-----------|--------|
| 11 | Large main.py (3,447 lines) | Backend | Maintainability |
| 12 | No background job system | Backend | Reliability |
| 13 | No query caching | Backend | Performance, Cost |
| 14 | Redundant Trigger.dev schedules | Jobs | Cost |
| 15 | No database backups | Desktop | Reliability |

### 🟢 Low Priority (Nice to Have)

| # | Issue | Component | Impact |
|---|-------|-----------|--------|
| 16 | Low Sentry sampling (10%) | Monitoring | Observability |
| 17 | No certificate pinning | iOS | Security |
| 18 | No structured error types | Backend | Maintainability |
| 19 | Missing formal migrations | Backend | Maintainability |
| 20 | No compression for API payloads | iOS | Performance |

---

## Recommendations

### Immediate Actions (This Week)

1. **Fix TypeScript Build Errors**
   - Remove `ignoreBuildErrors: true` from `next.config.mjs`
   - Fix all TypeScript errors
   - Add pre-commit hook to prevent new errors

2. **Restrict CORS Origins**
   ```javascript
   // next.config.mjs
   'Access-Control-Allow-Origin': 'http://localhost:3000, tauri://localhost'
   ```

3. **Add Authentication to Tinybird**
   - Proxy all Tinybird calls through backend API
   - Add rate limiting per user

4. **Encrypt Sensitive Tokens**
   - Encrypt WHOOP tokens at rest in database
   - Use Clerk's built-in token encryption

### Short-Term (This Month)

5. **Add Connection Pooling**
   ```python
   # database/connection.py
   engine = create_async_engine(
       DATABASE_URL,
       pool_size=5,
       max_overflow=10
   )
   ```

6. **Implement Background Jobs**
   - Add Celery or Dramatiq
   - Move imports to background tasks
   - Add job monitoring/alerting

7. **Remove iOS V1 Sync**
   - After V2 is stable, remove:
     - `BackgroundSyncManager.swift`
     - `HealthKitManager.swift`
   - Reduces code complexity and battery usage

8. **Add Retry Logic**
   ```python
   @retry(stop=stop_after_attempt(3), wait=wait_exponential())
   async def call_whoop_api():
       ...
   ```

### Medium-Term (Next Quarter)

9. **Refactor Backend**
   - Split `main.py` into routers:
     - `routers/habits.py`
     - `routers/analytics.py`
     - `routers/integrations.py`
   - Add formal migration system (Alembic)

10. **Add Caching Layer**
    - Redis for:
      - Frequent database queries
      - Tinybird analytics results
      - Clerk email lookups

11. **Improve Desktop Security**
    - Add CSP to Tauri config
    - Restrict file system scope
    - Encrypt local databases

12. **Add Monitoring/Alerting**
    - Increase Sentry sampling to 25%+
    - Add custom metrics/dashboards
    - Alert on error rate spikes

### Long-Term (Next 6 Months)

13. **Event Sourcing for Data Consistency**
    - Replace dual-write with event log
    - Async consumers for Turso and Tinybird
    - Guarantees eventual consistency

14. **Multi-Platform Desktop**
    - Add Windows/Linux support
    - Abstract macOS-specific APIs

15. **Comprehensive Test Suite**
    - Unit tests for services
    - Integration tests for APIs
    - E2E tests for critical flows

---

## Appendix: File Reference

### Key Configuration Files
- `next.config.mjs` - Next.js configuration
- `apps/desktop/src-tauri/tauri.conf.json` - Tauri configuration
- `apps/backend/database/connection.py` - Database setup
- `apps/ios-companion/Sources/Config/AppConfig.swift` - iOS config
- `.env.example` - Environment variables

### Critical Code Paths
- `apps/dashboard/app/(dashboard)/layout.tsx` - Dashboard layout
- `apps/backend/main.py` - All API endpoints
- `apps/desktop/src-tauri/src/watcher.rs` - Activity tracking
- `apps/desktop/src-tauri/src/recorder.rs` - Screen recording
- `apps/ios-companion/Sources/Services/BackgroundSyncManagerV2.swift` - iOS sync

### Database Schemas
- `apps/backend/database/models.py` - SQLAlchemy models
- `apps/tinybird/*.datasource` - Tinybird schemas
- `apps/desktop/src-tauri/crates/ritual-db/` - Desktop database

---

*Document generated by Claude - February 4, 2026*
