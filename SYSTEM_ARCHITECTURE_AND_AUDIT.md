# Ritual Desktop -- System Architecture & Full Codebase Audit

**Date**: February 25, 2026
**Purpose**: Comprehensive system architecture reference and Codex task file for a full production-readiness audit of every file in the `ritual-desktop-main` monorepo.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Monorepo Structure & Build System](#4-monorepo-structure--build-system)
5. [Component Deep Dives](#5-component-deep-dives)
   - 5.1 [Backend (FastAPI)](#51-backend-fastapi)
   - 5.2 [Dashboard (Next.js)](#52-dashboard-nextjs)
   - 5.3 [Desktop App (Tauri + Rust)](#53-desktop-app-tauri--rust)
   - 5.4 [Native Timer Widget (Swift)](#54-native-timer-widget-swift)
   - 5.5 [iOS Companion (SwiftUI)](#55-ios-companion-swiftui)
   - 5.6 [Tinybird Analytics](#56-tinybird-analytics)
   - 5.7 [Browser Extension](#57-browser-extension)
   - 5.8 [Shared Packages](#58-shared-packages)
6. [Authentication & Security Model](#6-authentication--security-model)
7. [Database Architecture](#7-database-architecture)
8. [API Endpoint Catalog](#8-api-endpoint-catalog)
9. [Data Flow Diagrams](#9-data-flow-diagrams)
10. [What Is Working Well](#10-what-is-working-well)
11. [Known Issues & Bugs](#11-known-issues--bugs)
12. [Codex Audit Task: Full File-by-File Review](#12-codex-audit-task-full-file-by-file-review)

---

## 1. Project Overview

Ritual is a multi-platform personal data tracking application. Its goal is to build tooling that makes personal behavioral data useful -- treating habits, learning, time, and trade-offs as native computing primitives.

The system collects data from manual habit logs, wearable devices (Whoop, Apple Health), computer activity (app usage, screen recordings), weather, and AI-assisted logging (screenshots, voice). It surfaces insights through analytics dashboards, AI chat, and automated correlation/anomaly detection.

**Platforms**: macOS desktop (Tauri), Web dashboard (Next.js), iOS companion (SwiftUI), Chrome extension.

---

## 2. High-Level Architecture

```
+-----------------------------------------------------------------------------------+
|                            RITUAL DESKTOP APP (Tauri)                             |
|                                                                                   |
|  +--------------------+     +----------------------------------------------+      |
|  |   Tauri Shell      |     |          Next.js 16 Dashboard                |      |
|  |   (Rust)           |<--->|          (React 19 + TanStack Query)         |      |
|  |                    |     |                                              |      |
|  |  - Window mgmt     |     |  - App Router                               |      |
|  |  - System tray     |     |  - Clerk Auth                               |      |
|  |  - Native APIs     |     |  - shadcn/ui components                     |      |
|  |  - IPC (70+ cmds)  |     |  - 50+ API routes (proxy to backend)        |      |
|  +--------------------+     +----------------------------------------------+      |
|           |                                    |                                  |
|  +--------+--------+                           |                                  |
|  |                  |                           |                                  |
|  v                  v                           |                                  |
| ritual-watcher   ritual-recorder                |                                  |
| (activity)       (screen capture + OCR)         |                                  |
|  |                  |                           |                                  |
|  v                  v                           |                                  |
| ritual-db (libSQL + vector search)              |                                  |
+------------------------------------------------+----------------------------------+
                                                  |
                          +-----------------------+----------------------+
                          |                                              |
                          v                                              v
         +------------------------------------+     +------------------------------------+
         |   FastAPI Backend (Python)         |     |     Tinybird (ClickHouse)          |
         |                                    |     |                                    |
         |  - Clerk JWT auth                  |     |  - habit_logs datasource           |
         |  - Turso Cloud (libSQL/SQLite)     |     |  - whoop_* datasources (3)         |
         |  - 16 service modules              |     |  - computer_activity_daily         |
         |  - 60+ API endpoints               |     |  - weather_observations            |
         |  - Rate limiting (slowapi)         |     |  - 14 analytics pipes              |
         +----------+-------------------------+     +------------------------------------+
                    |
                    v
         +------------------------------------+
         |   Turso Cloud (Database)           |
         |                                    |
         |  - users, habits, habit_logs       |
         |  - whoop_integrations              |
         |  - wearable_devices/metrics        |
         |  - watcher_devices, activity_events|
         |  - ai_conversations, ai_messages   |
         |  - import_runs, import_items       |
         |  - weather data                    |
         +------------------------------------+

         EXTERNAL INTEGRATIONS
         +-------------------+  +-------------------+  +-------------------+
         |  Whoop API        |  |  iOS Companion    |  |  Clerk (Auth)     |
         |  (OAuth 2.0)      |  |  (HealthKit)      |  |  (JWT + OAuth)    |
         +-------------------+  +-------------------+  +-------------------+
         +-------------------+  +-------------------+  +-------------------+
         |  OpenAI / Gemini  |  |  Apple WeatherKit |  |  Typesense        |
         |  (AI vision/chat) |  |  (weather data)   |  |  (search engine)  |
         +-------------------+  +-------------------+  +-------------------+
```

---

## 3. Technology Stack

| Layer | Technology | Version/Notes |
|-------|-----------|---------------|
| **Frontend** | Next.js (App Router) | 16, React 19, TypeScript |
| **UI** | shadcn/ui + Tailwind CSS | 30+ components, custom theme |
| **State** | TanStack Query (React Query) | Server state, optimistic updates |
| **Auth** | Clerk | JWT, Google OAuth, Apple Sign-In |
| **Backend** | FastAPI (Python) | Async, Pydantic v2, slowapi rate limiting |
| **Database** | Turso Cloud (libSQL/SQLite) | SQLAlchemy 2.0+ async, NullPool |
| **Analytics DB** | Tinybird (ClickHouse) | 6 datasources, 14 SQL pipes |
| **Desktop** | Tauri 1.8.1 (Rust) | macOS, window transparency, system tray |
| **Local DB** | ritual-db (libSQL + fastembed) | Vector search, FTS5, semantic search |
| **Screen Capture** | ritual-recorder (Rust) | Apple Vision OCR, perceptual dedup |
| **Activity Tracking** | ritual-watcher (Rust) | Window observer, AFK detection |
| **Native Widget** | Swift (SPM) | DynamicNotchKit, Speech framework |
| **iOS** | SwiftUI + Tuist | iOS 17+, HealthKit, background sync |
| **Browser Extension** | Chrome Manifest V3 | Service worker, heartbeat tracking |
| **Search** | Typesense | Federated search, suggestions |
| **AI** | OpenAI GPT-4o-mini, Google Gemini Flash | Chat, screenshot analysis, voice |
| **Error Tracking** | Sentry | Dashboard client/server/edge |
| **Analytics** | OpenPanel | User event tracking |
| **Package Manager** | npm workspaces | Monorepo with shared packages |
| **CI** | GitHub Actions | Typecheck, lint, structure check |

---

## 4. Monorepo Structure & Build System

### Root Configuration

- `package.json` -- npm workspaces: `apps/dashboard`, `apps/browser-extension`, `packages/*`
- `package-lock.json` -- Lockfile
- `.github/workflows/ci.yml` -- CI: Node 22, install, typecheck contracts + dashboard, lint
- `.env.example` -- Points to app-specific env files
- `reset-window-size.sh` -- Dev utility
- `scripts/check-repo-structure.sh` -- Validates monorepo structure (`npm run repo:check`)
- `scripts/apply-tinybird-changes.sh` -- Tinybird deployment helper
- `scripts/generate-lucide-assets.mjs` -- Icon asset generation

### Build Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dashboard dev server (Next.js with `--turbo`) |
| `npm run dev:backend` | Python FastAPI backend |
| `npm run build` | Production build |
| `npm run tauri:dev` | Desktop app development |
| `npm run tauri:build` | Desktop app production build |
| `npm run typecheck` | TypeScript type checking |
| `npm run contracts:build` | Build shared contracts |
| `npm run trigger:dev` | Trigger.dev background jobs |
| `npm run repo:check` | Validate monorepo structure |

---

## 5. Component Deep Dives

### 5.1 Backend (FastAPI)

**Path**: `apps/backend/`

#### File Inventory

**Core Application**:
| File | Lines | Purpose |
|------|-------|---------|
| `main.py` | ~3,928 | FastAPI app entry point -- ALL endpoint definitions (60+) |
| `start.py` | ~80 | Startup script with env validation |

**Database Layer** (`database/`):
| File | Purpose |
|------|---------|
| `models.py` | SQLAlchemy ORM models (UserDB, HabitDB, HabitLogDB, ScheduledBlockDB, ImportRunDB, ImportItemDB, HabitAliasDB, WhoopIntegrationDB, IntegrationDB, WeatherObservationDB, WeatherDailyDB, AIConversationDB, AIMessageDB, WearableDeviceDB, WearableMetricDB, WearableIngestEventDB, WatcherDeviceDB, WatcherStateDB, ActivityEventDB, DailyActivityRollupDB) |
| `connection.py` | Async SQLAlchemy engine, Turso Cloud connection, embedded replica, migrations on startup, session context manager |
| `helpers.py` | `parse_json_field()`, DB-to-Pydantic conversion helpers |

**Models** (`models/`):
| File | Purpose |
|------|---------|
| `habit_models.py` | Pydantic models for habits & logs |
| `user_models.py` | User profile & onboarding Pydantic models |
| `import_models.py` | Import system Pydantic models (runs, items, templates, V2 undo) |

**Services** (`services/`) -- 16 modules:
| File | Lines | Purpose |
|------|-------|---------|
| `habits_service.py` | ~600 | CRUD for habits & logs, dual-write Turso + Tinybird, batch logging, aliases |
| `auth_service.py` | ~200 | Clerk JWT validation via JWKS, email caching, token extraction |
| `tinybird_service.py` | ~300 | NDJSON event ingestion, pipe queries, delete by condition |
| `whoop_service.py` | ~1,000 | OAuth flow, token encryption, incremental sync (recovery/sleep/workouts) |
| `watcher_service.py` | ~3,163 | Device registration, activity events, daily rollups, screen search, Tinybird sync |
| `wearables_service.py` | ~600 | HMAC device registration, V1 batch + V2 incremental ingest, idempotency |
| `screenshot_analyzer.py` | ~250 | Gemini Flash (primary) / OpenAI Vision (fallback), habit matching from screenshots |
| `analytics_service.py` | ~400 | Statistics, daily breakdowns, Pearson correlation, trends, z-score anomaly detection |
| `import_service.py` | ~500 | CSV/screenshot parsing, flexible date parsing, duplicate detection, undo |
| `import_validator.py` | ~300 | Configurable validation rules, outlier detection, auto-fix, confidence scoring |
| `search_service.py` | ~400 | Typesense integration, federated search, suggestions, fallback search |
| `conversation_service.py` | ~200 | AI chat persistence (conversations + messages) |
| `user_service.py` | ~150 | User profile management |
| `token_crypto.py` | ~100 | Fernet-based token encryption for OAuth tokens |
| `websocket_manager.py` | ~80 | WebSocket connection management for real-time updates |
| `habit_resolver.py` | ~150 | Natural language habit matching via aliases |

**API Routes** (`api/`):
| File | Purpose |
|------|---------|
| `watcher.py` | Computer activity tracking endpoints (device management, events, rollups, search) |

**Integrations** (`integrations/weather/`):
| File | Purpose |
|------|---------|
| `router.py` | WeatherKit API routes with rate limiting |
| `service.py` | WeatherKit client with JWT auth |
| `storage.py` | Weather data persistence |
| `schemas.py` | Weather Pydantic models |

**Schemas** (`schemas/`):
| File | Purpose |
|------|---------|
| `wearables_apple.py` | Apple Health API schemas |

**Config** (`config/`):
| File | Purpose |
|------|---------|
| `env_validation.py` | Environment variable validation |

**Tests** (`tests/`) -- 7 files:
| File | Purpose |
|------|---------|
| `test_backend.py` | Basic import & app creation tests |
| `test_endpoints.py` | Endpoint health checks |
| `test_token_crypto.py` | Token encryption unit tests |
| `test_weather_integration.py` | Weather integration tests |
| `test_computer_use_parity.py` | Computer use parity tests |
| `verify_habits.py` | Habit verification script |
| `debug_habits.py` | Habit debugging utility |

**Scripts** (`scripts/`) -- 20 migration/utility scripts:
| File | Purpose |
|------|---------|
| `init_turso_tables.py` | Initialize all database tables |
| `cleanup_duplicate_logs.py` | Remove duplicate habit logs |
| `cleanup_duplicate_habits.py` | Remove duplicate habits |
| `add_habit_log_columns.py` | Add columns to habit_logs table |
| `add_habit_name_column.py` | Add habit name column |
| `migrate_add_watcher_tables.py` | Create watcher tables |
| `migrate_watcher_v2.py` | Watcher V2 migration |
| `migrate_add_wearables_tables.py` | Create wearables tables |
| `migrate_add_import_tables.py` | Create import tables |
| `migrate_import_indexes.py` | Add import indexes |
| `migrate_add_ai_tables.py` | Create AI conversation tables |
| `migrate_add_weather_tables.py` | Create weather tables |
| `seed_fake_habit_logs.py` | Generate test data |
| `verify_tinybird_sync.py` | Verify Tinybird data sync |
| `reload_tinybird_from_turso.py` | Full Tinybird data reload |
| `resync_habit_logs_to_tinybird.py` | Resync habit logs |
| `resync_computer_use_to_tinybird.py` | Resync computer activity |
| `cleanup_excessive_apple_health_data.py` | Clean Apple Health duplicates |
| `fix_screen_time_icon.py` | Fix screen time habit icon |
| `fix_sleep_duration_category.py` | Fix sleep duration category |

#### Backend: What Works Well

- **Service layer separation**: Clean separation between routing, business logic, and data access.
- **Dual-write pattern**: Habit logs written to both Turso (source of truth) and Tinybird (analytics) ensures analytics stay in sync.
- **Pydantic v2 models**: Strong request/response validation.
- **Rate limiting**: `slowapi` on sensitive endpoints prevents abuse.
- **HMAC-signed wearable ingest**: iOS companion requests are cryptographically verified.
- **Idempotency**: V2 wearable ingest uses `client_event_id` for deduplication.
- **Import system**: Robust CSV parsing, flexible date handling, undo support, auto-fix validation.

#### Backend: Issues & Risks

| Severity | Issue | File(s) |
|----------|-------|---------|
| **HIGH** | `main.py` is 3,928 lines -- all 60+ endpoints in one file. Needs extraction into FastAPI routers. | `main.py` |
| **HIGH** | `watcher_service.py` is 3,163 lines -- god object. Needs splitting into devices, events, rollups, sync sub-modules. | `services/watcher_service.py` |
| **HIGH** | Error messages leak internal details via `detail=str(e)` in exception handlers. | `main.py`, various services |
| **HIGH** | `print()` statements used throughout instead of structured logging. No log levels, no correlation IDs. | All service files |
| **MEDIUM** | Auth service email cache is in-memory dict -- lost on restart, not shared across instances. | `services/auth_service.py` |
| **MEDIUM** | Tinybird service can be `None` but some endpoints don't null-check before use. | `main.py` |
| **MEDIUM** | No request timeout on external API calls (Tinybird, OpenAI, Clerk, Whoop). | Various services |
| **MEDIUM** | Batch logging has no transaction rollback on partial failures. | `main.py`, `habits_service.py` |
| **MEDIUM** | Database migrations run on every startup; failures are swallowed silently. | `database/connection.py` |
| **MEDIUM** | WebSocket auth accepts raw `X-User-ID` header as fallback (no JWT validation). | `main.py` |
| **LOW** | Some endpoints catch `HTTPException` and re-raise (redundant). | `main.py` |
| **LOW** | Test coverage is minimal (7 test files, mostly smoke tests). | `tests/` |
| **LOW** | No health check that verifies DB + Tinybird connectivity. | `main.py` |

---

### 5.2 Dashboard (Next.js)

**Path**: `apps/dashboard/`

#### File Inventory

**App Router Pages** (`app/`):
| Route | File | Purpose |
|-------|------|---------|
| `/` | `page.tsx` | Home -- welcome flow or sign-in redirect |
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | Main dashboard (overview + metrics toggle) |
| `/analytics` | `(dashboard)/analytics/page.tsx` | Redirects to `/dashboard?view=metrics` |
| `/calendar` | `(dashboard)/calendar/page.tsx` | Calendar view of habit logs |
| `/chat` | `(dashboard)/chat/page.tsx` | AI chat interface |
| `/activity` | `(dashboard)/activity/page.tsx` | Habit logs browser |
| `/integrations` | `(dashboard)/integrations/page.tsx` | Third-party integration management |
| `/onboarding` | `onboarding/page.tsx` | Onboarding flow |
| `/sign-in` | `sign-in/[[...sign-in]]/page.tsx` | Clerk sign-in |
| `/sign-up` | `sign-up/[[...sign-up]]/page.tsx` | Clerk sign-up |
| `/widget` | `widget/page.tsx` | Timer widget (Tauri popup window) |

**Layouts**:
| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout -- providers, fonts, metadata |
| `app/(dashboard)/layout.tsx` | Dashboard layout -- sidebar, header, AI chat, token refresh |

**API Routes** (`app/api/`) -- 50 route files:

*Analytics (13 routes)*:
- `analytics/habits/summary/route.ts` -- Habit summaries with period comparisons
- `analytics/habits/summary-enhanced/route.ts` -- Enhanced summaries
- `analytics/habits/metrics/route.ts` -- Habit metrics
- `analytics/habits/trends/route.ts` -- Trend analysis
- `analytics/habits/streaks/route.ts` -- Streak calculations
- `analytics/habits/logs/route.ts` -- Habit logs queries
- `analytics/habits/logs/all/route.ts` -- All logs
- `analytics/habits/breakdown/route.ts` -- Daily breakdowns
- `analytics/habits/health-scores/route.ts` -- Health/risk scores
- `analytics/habits/progress/route.ts` -- Progress tracking
- `analytics/habits/daily-values/route.ts` -- Canonical daily values
- `analytics/correlation/route.ts` -- Habit correlations
- `analytics/summary/route.ts` -- Overall summary
- `analytics/whoop/summary/route.ts` -- Whoop integration summary
- `analytics/export/route.ts` -- Data export

*Chat (2 routes)*:
- `chat/stream/route.ts` (~1,320 lines) -- AI streaming with tool calling
- `chat/habits/route.ts` -- Habit suggestions from chat

*Habits (1 route)*:
- `habits/logs/batch/route.ts` -- Batch log operations

*Import (9 routes)*:
- `import/parse/route.ts`, `import/preview/route.ts`, `import/import/route.ts`
- `import/runs/route.ts`, `import/runs/[runId]/route.ts`
- `import/runs/[runId]/start/route.ts`, `import/runs/[runId]/cancel/route.ts`, `import/runs/[runId]/undo/route.ts`
- `import/apple-health/parse/route.ts`, `import/apple-health/import/route.ts`
- `import/extract-from-image/route.ts`

*Integrations (4 routes)*:
- `integrations/whoop/auth/route.ts`, `integrations/whoop/callback/route.ts`
- `integrations/whoop/store-code/route.ts`, `integrations/whoop/sync/route.ts`

*Watcher (12 routes)*:
- `watcher/devices/route.ts`
- `watcher/devices/[deviceId]/start/route.ts`, `watcher/devices/[deviceId]/stop/route.ts`, `watcher/devices/[deviceId]/settings/route.ts`
- `watcher/stats/summary/route.ts`, `watcher/stats/daily/route.ts`
- `watcher/stats/browser-summary/route.ts`, `watcher/stats/top-apps/route.ts`, `watcher/stats/top-domains/route.ts`
- `watcher/sync-to-habit/route.ts`
- `watcher/reconcile-habit-projection/route.ts`, `watcher/habit-projection-parity/route.ts`

*Other (4 routes)*:
- `search/route.ts`, `search/habits/route.ts`
- `suggestions/route.ts`
- `whisper/route.ts` -- Voice transcription
- `computer-activity/breakdown/route.ts`

**Components** (`components/`) -- 102 files:

*Core Layout & Navigation*:
- `dashboard-layout.tsx` -- Main dashboard layout with sidebar, header, AI toggle
- `sidebar.tsx` -- Collapsible sidebar navigation
- `detached-sidebar-shell.tsx` -- Two-window sidebar mode for Tauri
- `command-palette.tsx` -- Cmd+K search/command palette
- `main-menu.tsx` -- Hamburger menu
- `settings-modal.tsx` -- Application settings

*Analytics* (`analytics/`):
- `metrics-view.tsx` -- Metrics dashboard with charts
- `overview-view.tsx` -- Habit overview list
- `unified-analytics-client.tsx` -- Unified analytics container
- `habit-metric-card.tsx` -- Individual habit metric cards
- `activity-heatmap.tsx` -- GitHub-style activity heatmap
- `computer-activity.tsx` -- Computer activity panel
- `computer-time-card.tsx` -- Computer time summary
- `analytics-filter-context.tsx` -- Filter context provider
- `analytics-view-toggle.tsx` -- View mode toggle
- `view-mode-toggle.tsx` -- Overview/metrics switch
- `habit-ticker-view.tsx` -- Habit ticker
- `sortable-habit-list.tsx` -- Drag-sortable habit list

*Computer Activity* (`computer-activity/`):
- `ComputerActivityPanel.tsx` -- Full activity panel
- `AttentionIndexHeader.tsx` -- Attention metrics header with sparkline
- `SessionFlowTimeline.tsx` -- Visual session timeline
- `RankedBars.tsx` -- Top apps/domains bar chart
- `MicroMetricsRow.tsx` -- Focus blocks, switches metrics
- `UsageBreakdownCard.tsx` -- Usage breakdown
- `DeepDrillDrawer.tsx` -- Detailed activity drawer

*Charts* (`charts/`):
- `PerplexityExpandedHabitChart.tsx` -- Expanded habit chart
- `ChartTooltip.tsx` -- Custom chart tooltip

*Chat* (`chat/`):
- `habit-canvas.tsx` -- AI chat habit canvas

*Screen Recorder* (`screen-recorder/`):
- `ScreenTimeline.tsx` -- Screen recording timeline
- `ScreenTimelineCard.tsx` -- Timeline card
- `RecorderSettings.tsx` -- Recording settings
- `SemanticSearch.tsx` -- AI-powered screen search

*Timer* (`timer/`):
- `TimeTrackerWidget.tsx` -- Timer widget

*Metrics* (`metrics/`):
- `RangeSegmentedControl.tsx` -- Time range selector
- `ExpandedMetricCard.tsx` -- Expanded metric detail

*Other Feature Components*:
- `ai-habit-chat.tsx` -- AI chat interface
- `habit-selector.tsx` -- Habit picker
- `date-range-picker.tsx` -- Date range selector
- `data-import-modal.tsx` -- Data import UI
- `apple-health-import-modal.tsx` -- Apple Health import
- `habit-selection-modal.tsx` -- Multi-habit selection
- `habit-logs-search-filter.tsx` -- Log search/filter
- `habit-logs-actions.tsx` -- Log action buttons
- `history-scrubber.tsx` -- Historical date scrubber
- `computer-tracking-settings.tsx` -- Computer tracking config
- `IconPicker.tsx` -- Icon picker for habits
- `stats-tooltip.tsx` -- Stats tooltip
- `dashboard-search-handler.tsx` -- Search handler
- `voice-waveform.tsx` -- Voice input visualization
- `transparency-probe.tsx` -- macOS transparency debug
- `platform-detector.tsx` -- Platform detection
- `clerk-oauth-handler.tsx` -- OAuth flow handler
- `ChunkErrorBoundary.tsx` -- Error boundary
- `ritual-logo.tsx` -- Logo component

*Providers*:
- `root-providers.tsx` -- ClerkProvider, QueryClientProvider, ThemeProvider
- `providers.tsx` -- Feature providers
- `theme-provider.tsx` -- Theme (light mode only)
- `openpanel-provider.tsx` -- OpenPanel analytics

*UI Components* (`ui/`) -- 30+ shadcn/ui components:
- `button`, `card`, `dialog`, `table`, `form`, `input`, `label`, `checkbox`, `slider`, `tabs`, `popover`, `dropdown-menu`, `command`, `scroll-area`, `separator`, `skeleton`, `tooltip`, `badge`, `alert`, `alert-dialog`, `accordion`, `avatar`, `calendar`, `chart`, `progress`, `toast`, `toaster`, `sonner`
- Custom: `braille-spinner.tsx`, `dynamic-icon.tsx`, `material-symbol-icon.tsx`, `lucide-sprite-icon.tsx`, `sidebar.tsx` (shadcn sidebar)

**Contexts** (`contexts/`):
| File | Purpose |
|------|---------|
| `HabitsContext.tsx` | Wraps React Query for backward-compatible habits state |
| `AIContext.tsx` | AI chat visibility and mode state |
| `FontContext.tsx` | Font preference (FK Grotesk Neue vs Geist Sans) |

**Hooks** (`hooks/`):
| File | Purpose |
|------|---------|
| `use-habits-query.ts` | React Query hooks for habit CRUD (create, update, delete, log, list) |
| `use-debounce.ts` | Debounce hook |
| `use-mobile.ts` | Mobile viewport detection |
| `use-prefetch.ts` | Route prefetching utilities |
| `use-recorder.ts` | Screen recorder state hook |
| `use-semantic-search.ts` | Semantic search for screen recordings |
| `use-toast.ts` | Toast notification hook |
| `use-usage-breakdown.ts` | Computer usage breakdown calculations |

**Lib** (`lib/`):
| File/Dir | Purpose |
|----------|---------|
| `python-api-client.ts` | TypeScript client for Python backend -- token extraction, API methods |
| `tinybird-service.ts` | Tinybird analytics ingestion and querying |
| `query-client.ts` | React Query config (5min staleTime, 10min gcTime) |
| `analytics.ts` | OpenPanel event tracking |
| `api-config.ts` | Feature flags for backend migration |
| `utils.ts` | General utilities |
| `logger.ts` | Logging utilities |
| `tauri-utils.ts` | Tauri desktop app bridge utilities |
| `icon-utils.ts` | Icon helpers |
| `location-utils.ts` | Geolocation utilities |
| `screen-search.ts` | Screen recording semantic search |
| `onboarding-flow.ts` | Onboarding step logic |
| `ai/agents/` | AI agent implementations (habit-agent, triage-agent) |
| `computerActivity/` | Computer activity derivation logic |
| `charts/` | Chart data transformation utilities |
| `server/` | Server-side utilities |
| `services/analytics-api.ts` | Analytics API client with React hooks |

#### Dashboard: What Works Well

- **React Query integration**: Consistent server state management with optimistic updates and caching.
- **shadcn/ui**: Well-structured component library with consistent design language.
- **API route proxy pattern**: Next.js API routes cleanly proxy to Python backend, adding Clerk auth headers.
- **Code splitting**: Dynamic imports for heavy components (charts, AI chat).
- **Computer activity UI**: Sophisticated visualization (session timeline, attention index, sparklines, ranked bars).
- **Analytics pipeline**: Clean separation between Tinybird pipes and dashboard display components.
- **Error boundary**: `ChunkErrorBoundary` wraps dynamic imports.

#### Dashboard: Issues & Risks

| Severity | Issue | File(s) |
|----------|-------|---------|
| **HIGH** | `chat/stream/route.ts` is ~1,320 lines. No timeout on OpenAI/tool calls -- can hang indefinitely. | `app/api/chat/stream/route.ts` |
| **HIGH** | `python-api-client.ts` falls back to `localStorage` for auth tokens (security risk in browser). | `lib/python-api-client.ts` |
| **MEDIUM** | No retry logic in `python-api-client.ts` -- single network failure = immediate error. | `lib/python-api-client.ts` |
| **MEDIUM** | `analytics-api.ts` returns empty results instead of proper errors on failure (line ~156). | `lib/services/analytics-api.ts` |
| **MEDIUM** | `dashboard-layout.tsx` polls for token refresh every 500ms (unnecessarily high frequency). | `components/dashboard-layout.tsx` |
| **MEDIUM** | Some API routes return generic 500 errors without user-friendly messages. | Various `route.ts` files |
| **LOW** | `habits-service.ts` marked deprecated but still imported for types. | `lib/habits-service.ts` |
| **LOW** | Missing Suspense boundaries on some heavy components. | Various components |
| **LOW** | Some `any` types in API responses weaken type safety. | Various files |

---

### 5.3 Desktop App (Tauri + Rust)

**Path**: `apps/desktop/src-tauri/`

#### File Inventory

**Main Application** (`src/`):
| File | Lines | Purpose |
|------|-------|---------|
| `main.rs` | ~946 | Tauri entry point: window management, system tray, env-based URL loading, IPC command registration (70+ commands), auto-start watcher/recorder/widget |
| `native_widget.rs` | ~450 | Launches/manages Swift native timer widget, FFI bindings for speech recognition, token file management |
| `watcher.rs` | ~1,214 | Orchestrates `ritual-watcher` sidecar: activity queries, sync queue, DB maintenance, focus metrics, app icon extraction, watchdog auto-restart |
| `recorder.rs` | ~1,482 | Orchestrates `ritual-recorder` sidecar: permission checks, FFmpeg status, OCR queries, video chunk management, frame extraction, LRU frame cache |
| `ritual_database.rs` | ~850 | Unified libSQL wrapper: semantic/hybrid/text search, embedding worker, segment management, migration status |
| `local_search_bridge.rs` | ~388 | HTTP server on `localhost:3031`: token-based auth, hybrid search endpoint for backend |

**Configuration**:
| File | Purpose |
|------|---------|
| `Cargo.toml` | Rust workspace manifest -- tauri 1.8.1, tokio, serde, chrono, cocoa, window-vibrancy, ritual-db |
| `tauri.conf.json` | App config: transparent window, overlay title bar, system tray, CSP, file system scope |
| `build.rs` | Compiles Swift speech recognition (`MicrophonePermission.swift`, `SpeechRecognition.swift`) into `libspeech_native.a` |
| `entitlements.plist` | macOS: sandbox disabled, microphone, network |
| `Info.plist` | Usage descriptions: microphone, speech recognition, location |

**Sidecar: ritual-watcher** (`bin/ritual-watcher/src/`):
| File | Purpose |
|------|---------|
| `main.rs` | Entry point: polling loop, state machine, heartbeat merging |
| `window_observer.rs` | Active window polling via macOS APIs |
| `browser_heartbeat_server.rs` | HTTP server on port 8766 for browser extension heartbeats |
| `browser_tracker.rs` | Browser URL/tab tracking |
| `browser.rs` | Browser detection and URL extraction |
| `afk.rs` | AFK detection (idle timeout, default 15 min) |
| `screen_events.rs` | Screen lock/unlock and sleep/wake detection |
| `sync_queue.rs` | Reliable sync queue for backend sync |
| `database.rs` | Activity event storage |
| `config.rs` | Watcher configuration management |
| `icons.rs` | App icon extraction and caching |
| `macos.rs` | macOS-specific APIs |
| `applescript_ffi.rs` | AppleScript FFI for browser data |
| `notifications.rs` | Notification utilities |

**Sidecar: ritual-recorder** (`bin/ritual-recorder/src/`):
| File | Purpose |
|------|---------|
| `main.rs` | Entry point: capture loop, OCR pipeline |
| `capture.rs` | Screen capture (xcap library) |
| `ocr.rs` | Apple Vision OCR via FFI |
| `vision_ffi.rs` | Swift Vision framework bindings |
| `thumbnail.rs` | 64x64 PNG thumbnail generation |
| `dedup.rs` | Perceptual hash frame deduplication |
| `database.rs` | OCR frame storage with FTS5 |
| `video.rs` | Video chunk management |
| `ffmpeg.rs` | FFmpeg auto-download and management |
| `storage.rs` | Storage management (20GB default, tiered cleanup) |
| `config.rs` | Recorder configuration |
| `metrics.rs` | Performance metrics |

**Library Crate: ritual-db** (`crates/ritual-db/`):
| File | Purpose |
|------|---------|
| `lib.rs` | Public API surface |
| `schema.rs` | Database schema definitions |
| `activity.rs` | Activity event storage and queries |
| `recorder.rs` | OCR frame storage |
| `vector.rs` | Vector embeddings (fastembed, cosine similarity) |
| `segments.rs` | Activity segment creation and queries |
| `sync.rs` | Sync operations |
| `blocking.rs` | Blocking database wrapper |
| `text_processing.rs` | Text processing utilities |
| `activity_classifier.rs` | Activity session classification (work/web/media/idle) |
| `types.rs` | Shared types |
| `error.rs` | Error types |
| `migration.rs` | Legacy database migration |
| `tests/integration_tests.rs` | Integration tests |
| `tests/retrieval_quality_benchmark.rs` | Search quality benchmarks |

#### IPC Commands (Rust <-> Frontend) -- 70+ commands

*Window Management*: `show_main_window`, `sidebar_set_width`, `sidebar_navigate`, `sidebar_get_main_state`

*Native Widget*: `create_native_timer_widget`, `close_native_timer_widget`, `write_auth_token_to_file`, `check_dashboard_refresh_trigger`, `check_token_refresh_request`, `show_native_microphone_permission_dialog`, `check_native_microphone_permission`, `start_native_speech_recognition`, `stop_native_speech_recognition`

*Watcher*: `check_accessibility_permission`, `request_accessibility_permission`, `start_watcher`, `stop_watcher`, `get_watcher_status`, `get_detailed_activity`, `get_activity_timeline`, `get_sync_queue_count`, `get_pending_sync_items`, `mark_sync_item_complete`, `mark_sync_item_failed`, `get_daily_summary`, `get_focus_metrics`, `get_watcher_db_stats`, `cleanup_old_events`, `export_events`, `check_and_restart_watcher_if_hung`, `get_app_icon`, `get_app_icons_batch`, `save_watcher_config_cmd`, `clear_watcher_config_cmd`

*Recorder*: `check_screen_recording_permission`, `request_screen_recording_permission`, `check_ffmpeg_status`, `ensure_ffmpeg_installed`, `start_recorder`, `stop_recorder`, `get_recorder_status`, `get_available_monitors`, `get_recorder_storage_status`, `get_ocr_frames`, `search_ocr_text`, `get_video_chunks`, `run_recorder_maintenance`, `extract_frame_image`, `clear_frame_cache`, `get_frame_cache_stats`, `save_recorder_config_cmd`, `clear_recorder_config_cmd`

*Database*: `init_ritual_database`, `get_ritual_db_stats`, `init_embedding_service`, `get_embedding_stats`, `ensure_embedding_pipeline_ready`, `semantic_search`, `text_search`, `hybrid_search`, `process_embeddings`, `start_embedding_worker`, `stop_embedding_worker`, `is_embedding_worker_running`, `get_segments_in_range`, `get_segment_at_time`, `get_frames_for_segment`, `create_segments`, `get_segment_stats`, `check_migration_status`

*Voice*: `get_voice_hotkey`, `set_voice_hotkey`

#### Desktop: What Works Well

- **Sidecar architecture**: Watcher and recorder run as separate binaries, isolated from the main app.
- **ritual-db crate**: Unified database with vector search, FTS5, and semantic search is sophisticated and well-abstracted.
- **Frame deduplication**: Perceptual hashing avoids storing duplicate screenshots.
- **Storage management**: Tiered cleanup with configurable limits.
- **Sync queue**: Reliable queue pattern for backend sync with retry.
- **Watchdog**: Auto-restart for hung watcher process.

#### Desktop: Issues & Risks

| Severity | Issue | File(s) |
|----------|-------|---------|
| **HIGH** | Many `unwrap()` calls in `main.rs` that can panic and crash the app. | `src/main.rs` |
| **HIGH** | `eval()` used for navigation (potential code injection if URL is user-controlled). | `src/main.rs` |
| **MEDIUM** | `build.rs` compiles Swift files (`MicrophonePermission.swift`, `SpeechRecognition.swift`) that may not match the current native-timer structure. | `build.rs` |
| **MEDIUM** | Mutex-based state management has potential for deadlocks under contention. | `src/main.rs` |
| **MEDIUM** | Auth token written to `~/.ritual/auth_token.txt` as plain text without restrictive file permissions. | `src/native_widget.rs` |
| **MEDIUM** | No error recovery if watcher/recorder fails to start -- app continues silently. | `src/main.rs` |
| **LOW** | `println!` used instead of structured logging throughout Rust code. | All `.rs` files |
| **LOW** | No test coverage for Rust code (only `ritual-db` has tests). | `src/` |
| **LOW** | Hardcoded 3-second fallback timer is a magic number. | `src/main.rs` |

---

### 5.4 Native Timer Widget (Swift)

**Path**: `apps/desktop/src-tauri/native-timer/`

#### File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `TimerWidgetApp.swift` | ~120 | NSApplication delegate, parent process watchdog (terminates if parent dies), initializes NotchController + SpeechEngine |
| `Package.swift` | ~30 | SPM manifest -- depends on DynamicNotchKit |
| **Notch/** | | |
| `NotchController.swift` | ~637 | DynamicNotch UI state machine (hidden/compact/expanded/voiceActive), pointer hover detection, click handling, hotkey config, voice flow |
| `NotchTimerView.swift` | ~308 | Timer display SwiftUI view |
| `NotchHabitPicker.swift` | ~250 | Habit selection UI |
| `NotchVoiceViews.swift` | ~312 | Voice recognition UI with audio level bars |
| **Stores/** | | |
| `TimerSessionStore.swift` | ~740 | Observable state management (Combine), habit loading from API, timer session persistence, voice mode state machine, hotkey settings persistence, settings file watcher |
| **Speech/** | | |
| `SpeechEngine.swift` | ~164 | `SFSpeechRecognizer` + `AVAudioEngine`, real-time audio level visualization (32 bars), partial/final transcript |
| `VoicePermissions.swift` | ~80 | Microphone + Speech permission handling |
| **Hotkeys/** | | |
| `GlobalHotkey.swift` | ~138 | Global hotkey registration (CGEvent) |
| `ModifierEventTap.swift` | ~100 | Command key hold detection (requires Accessibility) |
| **Permissions/** | | |
| `AccessibilityPermission.swift` | ~60 | Accessibility permission check and prompt |
| **Legacy FFI** | | |
| `MicrophonePermission.swift` | ~30 | Microphone permission check (compiled by build.rs) |
| `SpeechRecognition.swift` | ~80 | Speech recognition C-callable FFI bindings (compiled by build.rs) |

**Communication with Tauri**: File-based IPC:
- `~/.ritual/auth_token.txt` -- Auth token (written by Rust, read by Swift)
- `~/.ritual/voice_settings.json` -- Hotkey configuration
- `~/.ritual/timer_updated.txt` -- Dashboard refresh trigger (timestamp)

**Build**: `build_widget.sh` compiles via SPM, creates `.app` bundle with `Info.plist` for permissions, copies to `target/release/NativeTimerWidget.app`.

#### Widget: What Works Well

- **DynamicNotch integration**: Creative use of macOS notch area for always-accessible timer.
- **State machine**: Clean state transitions for UI modes.
- **Voice recognition**: Real-time audio level visualization with smooth animations.
- **Parent watchdog**: Widget terminates cleanly when Tauri app exits.

#### Widget: Issues & Risks

| Severity | Issue | File(s) |
|----------|-------|---------|
| **MEDIUM** | File-based IPC is fragile -- race conditions on read/write, no file locking. | `TimerSessionStore.swift`, `native_widget.rs` |
| **MEDIUM** | No graceful shutdown mechanism -- just terminates. | `TimerWidgetApp.swift` |
| **MEDIUM** | Pointer hover detection uses 60ms polling (could be expensive on battery). | `NotchController.swift` |
| **LOW** | Settings file watcher may miss rapid changes. | `TimerSessionStore.swift` |
| **LOW** | No error UI for API failures during habit loading. | `TimerSessionStore.swift` |

---

### 5.5 iOS Companion (SwiftUI)

**Path**: `apps/ios-companion/`

#### File Inventory

**App** (`Sources/RitualCompanion/App/`):
| File | Purpose |
|------|---------|
| `RitualCompanionApp.swift` | SwiftUI App entry point, Clerk setup, background sync registration, foreground sync on active |
| `AppState.swift` | Central observable state: connection status, health access, sync status, tracked metrics, connect/disconnect, token refresh |

**Services** (`Sources/RitualCompanion/Services/`):
| File | Lines | Purpose |
|------|-------|---------|
| `HealthKitManagerV2.swift` | ~890 | Incremental sync via `HKAnchoredObjectQuery`, daily aggregation via `HKStatisticsCollectionQuery`, source preference (Apple Watch only/preferred/best available), 17+ metric types |
| `RitualAPIClient.swift` | ~525 | HMAC-SHA256 request signing, Clerk token refresh, V1 + V2 ingest endpoints, Keychain storage |
| `BackgroundSyncManagerV2.swift` | ~630 | Background task scheduling, HealthKit background delivery, daily aggregated sync (last 7 days), batching (400 items/batch), offline queue integration |
| `OfflineSyncQueue.swift` | ~278 | Persistent JSON queue, exponential backoff retry, max 10 attempts, 14-day retention |
| `AnchorStorage.swift` | ~128 | Per-metric-type anchor storage in UserDefaults for incremental sync |

**Models** (`Sources/RitualCompanion/Models/`):
| File | Purpose |
|------|---------|
| `NormalizedMetric.swift` | Cross-platform metric format (source, type, time window, value, unit, external_id) |
| `APIModels.swift` | Request/response types for device registration and ingest |

**Views** (`Sources/RitualCompanion/Views/`):
| File | Purpose |
|------|---------|
| `ContentView.swift` | Main container -- shows ConnectView or StatusView |
| `ConnectView.swift` | Auth flow with Clerk (Apple/Google/Email), connection status |
| `StatusView.swift` | Connected state UI -- sync controls, tracked habits list, auto-sync indicator |
| `Components/PermissionsView.swift` | HealthKit permissions sheet |
| `Components/StatusCard.swift` | Reusable status card component |

**Config**:
| File | Purpose |
|------|---------|
| `Config/AppConfig.swift` | Loads config from Info.plist/build settings, debug/prod API URLs |
| `Project.swift` | Tuist project config, iOS 17+, HealthKit entitlements |

#### iOS: What Works Well

- **V2 incremental sync**: Anchor-based queries only fetch new/changed data.
- **HMAC-SHA256 signing**: All API requests are cryptographically verified.
- **Offline queue**: Persistent queue with exponential backoff ensures no data loss.
- **Background delivery**: HealthKit background delivery for passive data collection.
- **Source preference**: Smart handling of multiple data sources (Watch vs iPhone).

#### iOS: Issues & Risks

| Severity | Issue | File(s) |
|----------|-------|---------|
| **HIGH** | Token expiry hardcoded to 55 minutes (should derive from Clerk token claims). May cause premature or late refresh. | `RitualAPIClient.swift` |
| **MEDIUM** | Daily sync only fetches last 7 days. If sync fails for >7 days, older data is lost. | `BackgroundSyncManagerV2.swift` |
| **MEDIUM** | Partial batch failure: if batch 3/10 fails, remaining batches continue but partial success is not tracked or retried. | `BackgroundSyncManagerV2.swift` |
| **MEDIUM** | `confirmAnchor()` exists but is not called after successful server ingest. Anchors update immediately, not after server confirmation. | `AnchorStorage.swift`, `HealthKitManagerV2.swift` |
| **LOW** | `appleWatchOnly` source preference filters out iPhone data -- users without Apple Watch get no data. | `HealthKitManagerV2.swift` |
| **LOW** | No compression for API payloads. Large batches sent uncompressed. | `RitualAPIClient.swift` |

---

### 5.6 Tinybird Analytics

**Path**: `apps/tinybird/`

#### File Inventory

**Datasources** (`datasources/`) -- 6 definitions:
| File | Purpose | TTL |
|------|---------|-----|
| `habit_logs.datasource` | Main analytics table -- partitioned by month, sorted by user_id/date/habit_id | 2 years |
| `whoop_sleep_data.datasource` | Sleep metrics (duration, efficiency, REM/SWS/light/awake) | Monthly partitions |
| `whoop_recovery_data.datasource` | Recovery metrics (score, HRV, resting HR, SpO2, skin temp) | Monthly partitions |
| `whoop_workout_data.datasource` | Workout/strain data (strain score, activity, duration, HR, distance) | Monthly partitions |
| `computer_activity_daily.datasource` | Desktop activity aggregates (privacy-preserving: title_hash, not raw titles) | 1 year |
| `weather_observations.datasource` | WeatherKit data (temp, humidity, wind, precipitation, cloud cover) | 2 years |

**Pipes** (`pipes/`) -- 14 analytics endpoints:
| Pipe | Purpose |
|------|---------|
| `analytics_summary.pipe` | Dashboard KPIs: active days (30d), avg entries/day, current streak, most consistent habit |
| `habit_streaks.pipe` | Current streak, longest streak, weekly/monthly counts |
| `habit_progress_since_start.pipe` | First 7 days vs last 7 days improvement percentage |
| `habit_health_scores.pipe` | Consistency, stability, momentum, recency scores; composite health/risk |
| `habit_logs_time_range.pipe` | Flexible time range query with deduplication |
| `recent_habit_logs.pipe` | Last N days (default 7) with deduplication |
| `habit_dual_period.pipe` | Current vs comparison period, daily data or summary output, percentage changes |
| `habit_trends.pipe` | Daily or weekly aggregation with custom date ranges |
| `habit_correlation.pipe` | Pearson correlation coefficient, min 7-day sample, strength classification |
| `habit_period_comparison.pipe` | First day to last day change within selected period |
| `habit_daily_values.pipe` | Canonical daily values with period summary (single source of truth for metric cards) |
| `user_habits_summary.pipe` | Completion stats, time-based comparisons, stability (coefficient of variation) |
| `whoop_analytics.pipe` | Sleep, recovery, workout stats -- cross-join of all three datasources |
| `computer_activity_summary.pipe` | Summary, daily totals, top apps, top domains, breakdown -- multiple output modes |

**Python Service** (`python-service/`):
| File | Purpose |
|------|---------|
| `tinybird_client.py` | Client for Tinybird Events API -- supports local/cloud, bulk NDJSON ingest |
| `requirements.txt` | requests, python-dotenv, supabase, psycopg2, pandas, tqdm |

#### Tinybird: What Works Well

- **ClickHouse-powered analytics**: Sub-second queries on large time-series datasets.
- **Comprehensive pipe library**: 14 pipes covering streaks, correlations, trends, health scores, anomalies.
- **Privacy-preserving**: Computer activity uses `title_hash` instead of raw window titles.
- **Period comparison**: Sophisticated dual-period analysis with percentage changes.

#### Tinybird: Issues & Risks

| Severity | Issue | File(s) |
|----------|-------|---------|
| **HIGH** | Tinybird pipe endpoints may not have per-user authentication. All queries should be proxied through the backend with user validation. | All pipes |
| **MEDIUM** | Deduplication uses `LIMIT 1 BY id` which scans all rows before deduplicating. Consider `ReplacingMergeTree` or materialized views. | Multiple pipes |
| **MEDIUM** | No rate limiting on pipe queries -- unlimited queries possible. | All pipes |
| **LOW** | Python client has debug `print()` statements. | `tinybird_client.py` |
| **LOW** | 1-year TTL for computer activity may be too short for year-over-year analysis. | `computer_activity_daily.datasource` |

---

### 5.7 Browser Extension

**Path**: `apps/browser-extension/`

#### File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `manifest.json` | ~30 | Manifest V3, service worker, permissions: tabs/alarms/storage/idle, host permissions for localhost:8766/8767 |
| `background.js` | ~512 | Service worker: active tab tracking, domain extraction, heartbeat sending, server failover, offline queue (max 50), idle detection, tab count tracking |
| `background-core.js` | ~70 | Pure helpers: `getServerCandidates()`, `isSameHeartbeat()`, `replayQueuedEvents()`, `shouldSendTabUpdateHeartbeat()` |
| `popup.html` | ~60 | Status display: connection, last heartbeat, idle state, current domain/title, stats |
| `popup.js` | ~80 | Popup logic: status updates every 2s, time formatting, server status check |
| `package.json` | ~10 | Minimal config, type: module |

#### Extension: What Works Well

- **Server failover**: Tries multiple localhost URLs (8766, 8767) for resilience.
- **Offline queue**: Queues events when watcher is unavailable, replays on reconnect.
- **Idle detection**: Pauses heartbeats when user is idle.

#### Extension: Issues & Risks

| Severity | Issue | File(s) |
|----------|-------|---------|
| **MEDIUM** | Server URLs are hardcoded -- no way to configure without code changes. | `background.js` |
| **MEDIUM** | No authentication on heartbeats -- any local process can send heartbeats to the watcher. | `background.js` |
| **LOW** | Offline queue has no size limit check before adding (check happens after). | `background.js` |
| **LOW** | Tab count caching may be inaccurate (misses tabs opened before extension loaded). | `background.js` |

---

### 5.8 Shared Packages

#### `packages/shared-contracts/`

| File | Purpose |
|------|---------|
| `index.ts` | Main exports -- re-exports all types and helpers |
| `normalized.ts` | Core types: `WearableSource` (whoop/apple_health/oura/garmin/fitbit), `MetricType` (sleep_session/hr/hrv/steps/active_energy/etc.), `Unit`, `NormalizedMetric`, `WearableDevice` |
| `apple_ingest.ts` | API contracts: `AppleIngestRequest`, `AppleIngestResponse`, `DeviceRegisterRequest/Response`, `buildCanonicalString()` |
| `computer-activity.ts` | Activity types: `ActivityEvent`, `SessionKind`, `SessionSegment`, `SparklinePoint`, `AttentionHeader`, `RankedBar`, `MicroMetrics`, `ComputerActivityViewModel`, `TimeRangePreset`, `KIND_COLORS` |

**Issues**: Missing V2 ingest types (`AppleIngestRequestV2` not exported). Incomplete `MetricType` enum (missing `sleep_rem`, `sleep_deep`, `sleep_core` used by iOS). No runtime validation schemas (Zod).

#### `packages/ui/`

| File | Purpose |
|------|---------|
| `index.ts` | Re-exports `cn` function |
| `cn.ts` | `clsx` + `tailwind-merge` utility |

Very minimal package -- only exports the `cn` helper.

---

## 6. Authentication & Security Model

### Authentication Flow

1. **Web/Desktop**: Clerk handles sign-in/sign-up (Google OAuth, Apple Sign-In, email). Clerk issues JWT tokens that are passed as `Authorization: Bearer <token>` to the Python backend.

2. **Backend JWT Validation**: `auth_service.py` fetches Clerk JWKS (cached 1 hour), validates signature, expiration, and extracts `user_id` (subject claim). `get_current_user()` FastAPI dependency injects the authenticated user into endpoints.

3. **iOS Companion**: Uses Clerk SDK for auth. API requests are signed with HMAC-SHA256 using a shared secret. Backend verifies signatures in `wearables_service.py`.

4. **Native Widget**: Auth token written to `~/.ritual/auth_token.txt` by Rust, read by Swift widget to make API calls.

5. **Watcher API**: Uses `X-User-ID` header as fallback when no JWT is present (for internal Next.js proxy calls).

### Security Concerns

| Area | Concern | Severity |
|------|---------|----------|
| Token storage | `~/.ritual/auth_token.txt` stored as plain text without restrictive permissions | HIGH |
| Token fallback | `python-api-client.ts` falls back to `localStorage` | HIGH |
| Watcher auth | `X-User-ID` header accepted without JWT -- allows impersonation from localhost | MEDIUM |
| Error leaks | `detail=str(e)` exposes stack traces in HTTP responses | MEDIUM |
| JWKS fallback | Hardcoded fallback URL if `CLERK_SIGN_IN_URL` not set | LOW |
| Email cache | In-memory, not invalidated on email changes | LOW |

---

## 7. Database Architecture

### Turso Cloud (Primary -- Backend)

**Engine**: libSQL (SQLite fork with cloud sync)
**Connection**: Async SQLAlchemy 2.0+, `NullPool`, embedded local replica

**Tables**:
| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `users` | id, clerk_id, email, name, onboarding_data | User profiles |
| `habits` | id, user_id, name, category, icon, unit, target_value | Habit definitions |
| `habit_logs` | id, habit_id, date, value, status, note, habit_name, habit_unit | Individual log entries (denormalized) |
| `habit_aliases` | id, habit_id, alias | NLP aliases for habit matching |
| `scheduled_blocks` | id, user_id, habit_id, day_of_week, start_time, end_time | Calendar blocks |
| `whoop_integrations` | id, user_id, access_token_encrypted, refresh_token_encrypted, sync_hour | Whoop OAuth tokens (Fernet-encrypted) |
| `integrations` | id, user_id, provider, status | Generic integration status |
| `wearable_devices` | id, user_id, device_name, platform, hmac_key, is_active | Registered wearable devices |
| `wearable_metrics` | id, device_id, metric_type, value, timestamp, external_id | Raw wearable data points |
| `wearable_ingest_events` | id, device_id, client_event_id, metric_count | Idempotency tracking |
| `watcher_devices` | id, user_id, device_name, os, status | Registered watcher devices |
| `watcher_state` | id, device_id, afk_timeout_seconds | Watcher configuration |
| `activity_events` | id, device_id, app_bundle_id, app_name, window_title, url, start_time, end_time | Computer activity events |
| `daily_activity_rollups` | id, device_id, date, app_bundle_id, total_seconds | Daily aggregates |
| `import_runs` | id, user_id, status, source_type, total_items, created_items | Import run tracking |
| `import_items` | id, run_id, status, habit_name, date, value, error | Individual import items |
| `ai_conversations` | id, user_id, title, response_mode | Chat conversations |
| `ai_messages` | id, conversation_id, role, content, tool_calls | Chat messages |
| `weather_observations` | id, user_id, timestamp, temperature, humidity, etc. | Hourly weather |
| `weather_daily` | id, user_id, date, temp_high, temp_low, etc. | Daily weather summary |

### ritual-db (Local -- Desktop)

**Engine**: libSQL with fastembed vector extension
**Location**: `~/.ritual/ritual.db`

**Tables**: `activity_events`, `ocr_frames` (FTS5), `video_chunks`, `embeddings`, `segments`

**Capabilities**: FTS5 text search, vector cosine similarity search, hybrid search (FTS + vector), activity classification.

---

## 8. API Endpoint Catalog

### Backend (FastAPI) -- `apps/backend/main.py` + `api/watcher.py`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | No | Root |
| GET | `/health` | No | Health check |
| GET | `/api/user/profile` | JWT | Get user profile |
| PUT | `/api/user/onboarding` | JWT | Update onboarding |
| POST | `/api/habits` | JWT | Create habit |
| GET | `/api/habits` | JWT | List habits |
| PUT | `/api/habits/{id}` | JWT | Update habit |
| DELETE | `/api/habits/{id}` | JWT | Delete habit |
| GET | `/api/habits/aliases` | JWT | Get all aliases |
| POST | `/api/habits/{id}/aliases` | JWT | Add alias |
| POST | `/api/habits/{id}/generate-aliases` | JWT | Auto-generate aliases |
| POST | `/api/habits/{id}/logs` | JWT | Log habit |
| GET | `/api/habits/{id}/logs` | JWT | Get habit logs |
| GET | `/api/habit-logs` | JWT | Get all logs |
| POST | `/api/logs/batch` | JWT | Batch log |
| GET | `/api/calendar/scheduled-blocks` | JWT | List blocks |
| POST | `/api/calendar/scheduled-blocks` | JWT | Create block |
| PUT | `/api/calendar/scheduled-blocks/{id}` | JWT | Update block |
| DELETE | `/api/calendar/scheduled-blocks/{id}` | JWT | Delete block |
| GET | `/api/analytics/habits/summary` | JWT | Habits summary |
| GET | `/api/analytics/habits/trends` | JWT | Habit trends |
| GET | `/api/analytics/habits/breakdown` | JWT | Category breakdown |
| GET | `/api/analytics/stats` | JWT | Comprehensive stats |
| GET | `/api/analytics/daily-breakdown` | JWT | Daily breakdown |
| POST | `/api/analytics/tinybird-backfill` | JWT | Backfill Tinybird |
| GET | `/api/analytics/correlation` | JWT | Habit correlation |
| GET | `/api/analytics/list-habits` | JWT | List habits for analytics |
| GET | `/api/analytics/trends` | JWT | Period trends |
| GET | `/api/analytics/anomalies` | JWT | Anomaly detection |
| WS | `/ws/{user_id}` | Token | WebSocket real-time updates |
| POST | `/api/integrations/whoop/callback` | JWT | Whoop OAuth callback |
| GET | `/api/integrations/whoop/status` | JWT | Whoop integration status |
| POST | `/api/integrations/whoop/sync` | JWT | Sync Whoop data |
| POST | `/api/integrations/whoop/sync-all` | Internal | Bulk sync all users |
| DELETE | `/api/integrations/whoop` | JWT | Disconnect Whoop |
| PUT | `/api/integrations/whoop/sync-hour` | JWT | Update sync hour |
| POST | `/api/screenshot/analyze` | JWT | Screenshot analyze & log |
| POST | `/api/screenshot/preview` | JWT | Preview screenshot analysis |
| POST | `/api/screenshot/confirm` | JWT | Confirm & log from screenshot |
| POST | `/api/conversations` | JWT | Create AI conversation |
| GET | `/api/conversations/latest` | JWT | Get latest conversation |
| GET | `/api/conversations/{id}` | JWT | Get conversation |
| POST | `/api/conversations/{id}/messages` | JWT | Add message |
| DELETE | `/api/conversations/{id}` | JWT | Delete conversation |
| GET | `/api/conversations` | JWT | List conversations |
| PATCH | `/api/conversations/{id}/response-mode` | JWT | Update response mode |
| POST | `/api/wearables/apple/register_device` | HMAC | Register iOS device |
| GET | `/api/wearables/apple/devices` | JWT | List devices |
| DELETE | `/api/wearables/apple/devices/{id}` | JWT | Deactivate device |
| GET | `/api/wearables/apple/tracked_metrics` | JWT | Get tracked metrics |
| POST | `/api/wearables/apple/ingest` | HMAC | V1 batch ingest |
| POST | `/api/wearables/apple/ingest/v2` | HMAC | V2 incremental ingest |
| GET | `/api/wearables/apple/devices/{id}/status` | JWT | Device status |
| GET | `/api/wearables/apple/sync-status` | JWT | All devices status |
| GET | `/api/wearables/metrics` | JWT | Query metrics |
| POST | `/api/import/runs` | JWT | Create import run |
| GET | `/api/import/runs/{id}` | JWT | Get import run |
| GET | `/api/import/runs` | JWT | List import runs |
| POST | `/api/import/preview` | JWT | Preview import |
| POST | `/api/import/runs/{id}/start` | JWT | Start import |
| POST | `/api/import/runs/{id}/cancel` | JWT | Cancel import |
| POST | `/api/import/runs/{id}/undo` | JWT | Undo import |
| POST | `/api/import/runs/{id}/auto-fix` | JWT | Auto-fix validation issues |
| GET | `/api/import/history` | JWT | Import history |
| GET | `/api/import/runs/{id}/export` | JWT | Export import data |
| POST | `/api/import/templates` | JWT | Create mapping template |
| GET | `/api/import/templates` | JWT | List templates |
| GET | `/api/import/templates/{id}` | JWT | Get template |
| DELETE | `/api/import/templates/{id}` | JWT | Delete template |
| GET | `/api/search` | JWT | Global federated search |
| GET | `/api/search/habits` | JWT | Search habits |
| GET | `/api/search/logs` | JWT | Search logs |
| POST | `/api/search/reindex` | JWT | Reindex user data |
| GET | `/api/suggestions` | JWT | Personalized suggestions |
| POST | `/api/search/index-phrase` | JWT | Index log phrase |
| GET | `/api/search/status` | JWT | Search service status |

### Watcher API (`api/watcher.py`) -- Mounted as sub-router:
Device management, activity event ingestion, daily rollups, app exclusions, screen search, computer time stats.

### Weather API (`integrations/weather/router.py`):
WeatherKit data fetch, historical weather, daily summaries.

---

## 9. Data Flow Diagrams

### Habit Logging Flow

```
User Action (Dashboard/Widget/Voice)
        |
        v
Next.js API Route (/api/habits/logs/batch)
        |
        v
Python Backend (POST /api/habits/{id}/logs)
        |
        +---> Turso Cloud (INSERT INTO habit_logs)  [source of truth]
        |
        +---> Tinybird (NDJSON ingest to habit_logs datasource)  [analytics]
        |
        +---> Typesense (index log phrase)  [search]
        |
        +---> WebSocket (notify connected clients)  [real-time]
```

### Computer Activity Flow

```
ritual-watcher (Rust sidecar)
  - Polls active window every 2s
  - Tracks app, title, URL
  - Detects AFK (15min idle)
        |
        v
ritual-db (local libSQL)
  - Stores activity_events
  - Merges heartbeats (same signature within pulsetime)
        |
        v
Sync Queue --> Backend API (POST activity events)
        |
        +---> Turso (activity_events table)
        |
        +---> Tinybird (computer_activity_daily)  [daily rollups]
        |
        v
Dashboard (Computer Activity Panel)
  - Session timeline, top apps, attention index
```

### Apple Health Sync Flow

```
iOS Companion (SwiftUI)
  - HKAnchoredObjectQuery (incremental)
  - HKStatisticsCollectionQuery (daily aggregation)
        |
        v
HMAC-SHA256 signed request
        |
        v
Backend (/api/wearables/apple/ingest/v2)
  - Verify HMAC signature
  - Deduplicate via client_event_id
  - Match metrics to habits
        |
        +---> Turso (wearable_metrics)
        |
        +---> Tinybird (batch queue)
        |
        +---> Auto-create habit logs for matched metrics
```

### Whoop Sync Flow

```
User connects Whoop (OAuth 2.0 flow)
        |
        v
Backend stores encrypted tokens (Fernet)
        |
        v
Sync trigger (manual or scheduled)
        |
        v
Fetch from Whoop API:
  - Recovery data (score, HRV, resting HR)
  - Sleep data (duration, efficiency, stages)
  - Workout data (strain, activity, HR)
        |
        +---> Turso (whoop_integrations, habit_logs)
        |
        +---> Tinybird (whoop_recovery_data, whoop_sleep_data, whoop_workout_data)
```

### Screen Recording Flow

```
ritual-recorder (Rust sidecar)
  - Captures screen every 1s (configurable)
  - Perceptual hash deduplication
  - Apple Vision OCR
  - Thumbnail generation (64x64)
        |
        v
ritual-db (local libSQL)
  - ocr_frames table (FTS5 indexed)
  - fastembed vector embeddings
        |
        v
Embedding Worker (background)
  - Processes new frames
  - Creates vector embeddings
        |
        v
Search (Dashboard)
  - Text search (FTS5)
  - Semantic search (vector cosine similarity)
  - Hybrid search (combined ranking)
```

---

## 10. What Is Working Well

### Architecture Strengths

1. **Clean multi-platform strategy**: Web, desktop, iOS, and browser extension all share a common backend and type contracts. The shared-contracts package ensures type consistency.

2. **Dual-write analytics pattern**: Writing to both Turso (source of truth) and Tinybird (analytics) is a sound pattern for keeping real-time analytics without compromising data integrity.

3. **Local-first desktop data**: The ritual-db crate with libSQL + vector search means the desktop app works offline and provides fast local search. Data syncs to the cloud when available.

4. **Sidecar binary architecture**: Running watcher and recorder as separate processes isolates failures -- a recorder crash does not take down the main app.

5. **React Query state management**: Consistent server state management with caching, optimistic updates, and background refetching throughout the dashboard.

6. **HMAC-signed wearable ingest**: The iOS companion's cryptographic request signing prevents unauthorized data injection.

7. **Sophisticated analytics pipes**: 14 Tinybird pipes provide streaks, correlations, trends, health scores, and anomaly detection -- all pre-computed as SQL.

8. **Import system**: Robust CSV/Apple Health import with preview, validation, auto-fix, undo, and mapping templates.

9. **shadcn/ui component library**: Consistent, accessible UI components with Tailwind CSS.

10. **Computer activity visualization**: Session timeline, attention index with sparklines, ranked bars, micro metrics -- well-designed data visualization.

### Feature Completeness

| Feature | Status | Notes |
|---------|--------|-------|
| Habit CRUD | Working | Create, update, delete, list |
| Habit logging | Working | Manual, screenshot, voice, batch |
| Analytics dashboard | Working | Streaks, trends, correlations, health scores |
| Whoop integration | Working | OAuth, sync recovery/sleep/workouts |
| Apple Health sync | Working | V2 incremental, background delivery |
| Computer tracking | Working | App usage, AFK, browser URLs |
| Screen recording | Working | OCR, semantic search, thumbnails |
| AI chat | Working | GPT-4o-mini with tool calling |
| Voice logging | Working | Speech recognition via native widget |
| Data import | Working | CSV, Apple Health, image OCR |
| Federated search | Working | Typesense (habits, logs, activity) |
| Calendar view | Working | Visual habit calendar |
| Weather integration | Working | Apple WeatherKit |

---

## 11. Known Issues & Bugs

### Critical (Must Fix Before Production)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| C1 | `main.py` is 3,928 lines with all 60+ endpoints. God object, impossible to maintain. | `apps/backend/main.py` | Maintainability, review difficulty |
| C2 | Error messages leak internal details via `detail=str(e)`. | `apps/backend/main.py`, services | Security: stack traces exposed to users |
| C3 | `unwrap()` calls throughout Rust code can panic and crash the desktop app. | `apps/desktop/src-tauri/src/main.rs` | App stability |
| C4 | Auth token stored as plain text at `~/.ritual/auth_token.txt`. | `native_widget.rs`, `TimerSessionStore.swift` | Security: token theft |
| C5 | `python-api-client.ts` falls back to `localStorage` for auth tokens. | `apps/dashboard/lib/python-api-client.ts` | Security: XSS token theft |
| C6 | No timeouts on external API calls (OpenAI, Tinybird, Whoop, Clerk). | Various backend services | Availability: hung requests |
| C7 | `watcher_service.py` is 3,163 lines -- god object. | `apps/backend/services/watcher_service.py` | Maintainability |

### High (Should Fix Before Production)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| H1 | `print()` statements used everywhere instead of structured logging. No log levels, no correlation IDs. | All backend services, Rust code | Debugging, observability |
| H2 | WebSocket auth accepts raw `X-User-ID` header without JWT validation. | `apps/backend/main.py` | Security: impersonation from localhost |
| H3 | `chat/stream/route.ts` is ~1,320 lines with no timeout on tool calls. | `apps/dashboard/app/api/chat/stream/route.ts` | Availability: hung chat |
| H4 | iOS token expiry hardcoded to 55 minutes. | `apps/ios-companion/.../RitualAPIClient.swift` | Auth: premature/late refresh |
| H5 | No retry logic in `python-api-client.ts`. | `apps/dashboard/lib/python-api-client.ts` | Reliability: single failure = error |
| H6 | Database migrations run on every startup; failures are swallowed. | `apps/backend/database/connection.py` | Data integrity |
| H7 | Batch logging has no transaction rollback on partial failures. | `apps/backend/main.py`, `habits_service.py` | Data consistency |
| H8 | Tinybird service can be `None` but some endpoints do not null-check. | `apps/backend/main.py` | Runtime errors |

### Medium

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| M1 | Auth service email cache is in-memory dict. | `auth_service.py` | Stale data after restart |
| M2 | `analytics-api.ts` returns empty results on failure instead of errors. | `lib/services/analytics-api.ts` | Silent failures |
| M3 | Dashboard layout polls for token refresh every 500ms. | `dashboard-layout.tsx` | Performance: unnecessary work |
| M4 | `build.rs` compiles Swift files that may not match current native-timer structure. | `build.rs` | Build: stale FFI bindings |
| M5 | File-based IPC (widget <-> Tauri) has no file locking. | `TimerSessionStore.swift`, `native_widget.rs` | Race conditions |
| M6 | iOS daily sync only fetches last 7 days. | `BackgroundSyncManagerV2.swift` | Data loss if offline >7 days |
| M7 | iOS anchor confirmation not called after server ingest. | `AnchorStorage.swift` | Potential duplicate ingest |
| M8 | Tinybird deduplication uses expensive `LIMIT 1 BY id`. | Multiple pipes | Query performance |
| M9 | Browser extension server URLs hardcoded. | `background.js` | Configuration inflexibility |
| M10 | Tinybird endpoint authentication unclear. | All pipes | Security: unauthorized access |
| M11 | `eval()` used for window navigation in Rust. | `src/main.rs` | Security: code injection risk |
| M12 | Pointer hover detection uses 60ms polling in Swift widget. | `NotchController.swift` | Battery: continuous polling |

### Low

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| L1 | Test coverage is minimal (7 backend test files, mostly smoke). | `apps/backend/tests/` | Quality: regressions undetected |
| L2 | No Rust test coverage outside `ritual-db`. | `apps/desktop/src-tauri/src/` | Quality |
| L3 | Deprecated `habits-service.ts` still imported for types. | `lib/habits-service.ts` | Tech debt |
| L4 | Missing V2 ingest types in shared-contracts. | `packages/shared-contracts/` | Type safety |
| L5 | Incomplete `MetricType` enum (missing sleep subtypes). | `packages/shared-contracts/normalized.ts` | Type accuracy |
| L6 | No compression for iOS API payloads. | `RitualAPIClient.swift` | Bandwidth |
| L7 | Offline queue size check order in extension. | `background.js` | Edge case |
| L8 | Health check does not verify DB/Tinybird connectivity. | `apps/backend/main.py` | Monitoring |
| L9 | Supabase migration endpoint is a placeholder. | `apps/backend/main.py` | Dead code |

---

## 12. Codex Audit Task: Full File-by-File Review

> **Instructions for Codex**: This section defines the complete audit scope. Review every file listed below. For each file, check for: (a) bugs and logic errors, (b) security vulnerabilities, (c) performance issues, (d) error handling gaps, (e) code quality and readability, (f) missing tests. Report findings grouped by severity (Critical/High/Medium/Low). Optimize for performance, simplicity, and good software development practices.

---

### 12.1 Backend Audit (`apps/backend/`)

#### 12.1.1 Core Application

**File**: `apps/backend/main.py` (~3,928 lines)
- Audit all 60+ endpoint definitions for: proper auth, input validation, error handling, rate limiting.
- Identify endpoints where `tinybird_service` is used without null-check.
- Find all `detail=str(e)` patterns and replace with sanitized error messages.
- Find all `print()` statements and catalog them for replacement with `logging`.
- Identify all endpoints that should be extracted into separate FastAPI `APIRouter` modules. Suggest a router extraction plan: `routers/habits.py`, `routers/analytics.py`, `routers/integrations.py`, `routers/import_.py`, `routers/conversations.py`, `routers/search.py`, `routers/wearables.py`, `routers/calendar.py`.
- Check that all endpoints that mutate data have proper transaction handling.
- Verify rate limiting is applied to all sensitive endpoints.
- Check WebSocket auth -- the `X-User-ID` fallback should require an internal API key.

**File**: `apps/backend/start.py`
- Verify environment validation is comprehensive.
- Check that startup fails clearly if required env vars are missing.

#### 12.1.2 Database Layer

**File**: `apps/backend/database/models.py`
- Audit all SQLAlchemy models for: proper column types, indexes, constraints, relationships.
- Check that `HabitLogDB` has indexes on `(habit_id, date)` for query performance.
- Verify all foreign key relationships are correctly defined.
- Check for missing `updated_at` columns (note in code says it was removed).

**File**: `apps/backend/database/connection.py`
- Audit async engine configuration for production readiness.
- Check that `NullPool` is correct for Turso/libSQL (it is, but verify).
- Audit the migration system: are all migrations idempotent? Are failures handled?
- Check session lifecycle: are sessions always properly closed, even on exceptions?
- Verify retry logic in `init_db()` is sufficient.

**File**: `apps/backend/database/helpers.py`
- Audit `parse_json_field()` for edge cases (malformed JSON, None values).
- Check all conversion functions handle missing/null fields gracefully.

#### 12.1.3 Models

**File**: `apps/backend/models/habit_models.py`
- Audit Pydantic models for: proper validation, optional vs required fields, serialization.
- Check that all API response models match actual database outputs.

**File**: `apps/backend/models/user_models.py`
- Same as above.

**File**: `apps/backend/models/import_models.py`
- Audit import models for completeness. Check V2 undo model.
- Verify validation rules are correct.

#### 12.1.4 Services (audit each file)

**File**: `apps/backend/services/habits_service.py` (~600 lines)
- Audit dual-write logic: what happens if Turso write succeeds but Tinybird fails?
- Check batch logging idempotency.
- Verify alias management.

**File**: `apps/backend/services/auth_service.py` (~200 lines)
- Audit JWT validation: algorithm restrictions, audience/issuer checks.
- Check JWKS cache invalidation (what if keys rotate?).
- Audit email cache for memory leaks (unbounded dict growth).
- Verify token extraction handles malformed headers.

**File**: `apps/backend/services/tinybird_service.py` (~300 lines)
- Audit NDJSON serialization for edge cases.
- Check error handling on failed ingestion.
- Verify delete-by-condition logic.
- Check for request timeouts.

**File**: `apps/backend/services/whoop_service.py` (~1,000 lines)
- Audit OAuth token handling: encryption, refresh, storage.
- Check incremental sync logic for data gaps.
- Verify retry logic and error handling.
- Check for token refresh race conditions.

**File**: `apps/backend/services/watcher_service.py` (~3,163 lines)
- This is the highest-priority refactoring target. Audit and propose a split into sub-modules.
- Check for N+1 database queries in loops.
- Audit local SQLite3 access for blocking issues.
- Check sync cache consistency.
- Verify rollup computation correctness.

**File**: `apps/backend/services/wearables_service.py` (~600 lines)
- Audit HMAC signature verification for timing attacks (constant-time comparison).
- Check V2 incremental ingest idempotency.
- Verify metric-to-habit matching logic.
- Audit Tinybird batch queue for failures.

**File**: `apps/backend/services/screenshot_analyzer.py` (~250 lines)
- Check AI model fallback logic (Gemini -> OpenAI).
- Verify image size/format validation.
- Audit confidence scoring.

**File**: `apps/backend/services/analytics_service.py` (~400 lines)
- Verify statistical calculations (Pearson correlation, z-score).
- Check for division-by-zero edge cases.
- Audit query performance.

**File**: `apps/backend/services/import_service.py` (~500 lines)
- Audit CSV parsing for injection attacks (formula injection).
- Check date parsing edge cases.
- Verify duplicate detection accuracy.
- Audit undo functionality.

**File**: `apps/backend/services/import_validator.py` (~300 lines)
- Check outlier detection thresholds.
- Verify auto-fix does not corrupt data.
- Audit semantic duplicate detection.

**File**: `apps/backend/services/search_service.py` (~400 lines)
- Audit Typesense query construction for injection.
- Check fallback search when Typesense is unavailable.
- Verify indexing consistency.

**File**: `apps/backend/services/conversation_service.py` (~200 lines)
- Check message ordering.
- Verify conversation cleanup.

**File**: `apps/backend/services/user_service.py` (~150 lines)
- Audit user profile handling.

**File**: `apps/backend/services/token_crypto.py` (~100 lines)
- Verify Fernet encryption implementation.
- Check key management.

**File**: `apps/backend/services/websocket_manager.py` (~80 lines)
- Audit connection lifecycle.
- Check for memory leaks from abandoned connections.

**File**: `apps/backend/services/habit_resolver.py` (~150 lines)
- Audit NLP matching accuracy.
- Check for false positive matches.

#### 12.1.5 API Routes

**File**: `apps/backend/api/watcher.py`
- Audit all watcher endpoints for auth, validation, error handling.
- Check that device ownership is verified on all operations.

#### 12.1.6 Integrations

**Files**: `apps/backend/integrations/weather/router.py`, `service.py`, `storage.py`, `schemas.py`
- Audit WeatherKit JWT auth implementation.
- Check rate limiting.
- Verify data storage.

#### 12.1.7 Tests

**Files**: All 7 test files in `apps/backend/tests/`
- Audit existing tests for correctness.
- Identify critical paths that lack test coverage.
- Recommend additional tests needed.

#### 12.1.8 Scripts

**Files**: All 20 scripts in `apps/backend/scripts/`
- Check for destructive operations without confirmation.
- Verify migration scripts are idempotent.
- Check for hardcoded credentials.

---

### 12.2 Dashboard Audit (`apps/dashboard/`)

#### 12.2.1 API Routes (50 files)

**Priority files**:
- `app/api/chat/stream/route.ts` (~1,320 lines) -- Audit streaming, tool calling, timeouts, error handling. This needs to be split into smaller modules.
- `app/api/analytics/habits/summary/route.ts` -- Verify data aggregation logic.
- `app/api/integrations/whoop/callback/route.ts` -- Audit OAuth callback security.
- `app/api/import/import/route.ts` -- Audit import execution.
- `app/api/watcher/sync-to-habit/route.ts` -- Audit sync logic.
- `app/api/whisper/route.ts` -- Audit voice transcription.

**For all 50 route files**: Check auth (Clerk token extraction), error handling (user-friendly messages), input validation, proper HTTP status codes, and that backend proxy calls include timeouts.

#### 12.2.2 Core Components

**File**: `components/dashboard-layout.tsx`
- Audit token refresh polling (500ms is too frequent).
- Check for memory leaks from intervals/timeouts.
- Verify error handling in try/catch blocks (silent failures).

**File**: `components/sidebar.tsx`
- Check navigation logic.
- Verify active route highlighting.

**File**: `components/settings-modal.tsx`
- Audit settings persistence.
- Check form validation.

**File**: `components/ai-habit-chat.tsx`
- Audit AI chat state management.
- Check streaming message handling.

**File**: `components/command-palette.tsx`
- Audit search logic.
- Check keyboard shortcuts.

**File**: `components/data-import-modal.tsx`
- Audit file upload handling.
- Check validation.

#### 12.2.3 Analytics Components

**Files**: All files in `components/analytics/`
- Verify data transformation logic.
- Check for rendering performance with large datasets.
- Audit chart configurations.

#### 12.2.4 Computer Activity Components

**Files**: All files in `components/computer-activity/`
- Verify timeline rendering logic.
- Check attention index calculation.
- Audit ranked bars sorting.

#### 12.2.5 Lib & Services

**File**: `lib/python-api-client.ts`
- Remove `localStorage` fallback for tokens.
- Add retry logic with exponential backoff.
- Add request timeouts.
- Add proper error types.

**File**: `lib/tinybird-service.ts`
- Audit ingestion logic.
- Check query construction.

**File**: `lib/services/analytics-api.ts`
- Fix: return proper errors instead of empty results on failure.
- Add retry logic.

**File**: `lib/query-client.ts`
- Verify cache configuration is appropriate (5min stale, 10min gc).

**File**: `lib/tauri-utils.ts`
- Audit Tauri bridge calls.
- Check error handling.

**File**: `lib/ai/agents/`
- Audit AI agent implementations.
- Check tool call safety.

#### 12.2.6 Hooks

**Files**: All 8 hook files in `hooks/`
- Verify React Query hook configurations.
- Check for stale closure issues.
- Audit cleanup in useEffect hooks.

#### 12.2.7 Contexts

**Files**: All 3 context files
- Check for unnecessary re-renders.
- Verify state management correctness.

---

### 12.3 Desktop Audit (`apps/desktop/src-tauri/`)

#### 12.3.1 Main Application

**File**: `src/main.rs` (~946 lines)
- Replace all `unwrap()` calls with proper error handling (`match`, `if let`, `?` operator).
- Audit `eval()` usage for security.
- Check Mutex usage for deadlock potential.
- Verify window management logic.
- Audit system tray behavior.
- Check auto-start logic for watcher/recorder/widget.

**File**: `src/native_widget.rs` (~450 lines)
- Audit token file creation (should set restrictive permissions: 0600).
- Check FFI bindings for memory safety.
- Verify widget lifecycle management.

**File**: `src/watcher.rs` (~1,214 lines)
- Audit sidecar process management.
- Check watchdog logic (hung process detection).
- Verify sync queue operations.
- Check app icon extraction for errors.

**File**: `src/recorder.rs` (~1,482 lines)
- Audit frame cache (LRU eviction, TTL).
- Check OCR query construction.
- Verify storage management.
- Audit permission check logic.

**File**: `src/ritual_database.rs` (~850 lines)
- Audit database initialization.
- Check embedding worker lifecycle.
- Verify search result ranking.

**File**: `src/local_search_bridge.rs` (~388 lines)
- Audit token-based authentication.
- Check HTTP server error handling.
- Verify search query sanitization.

#### 12.3.2 Build Configuration

**File**: `build.rs`
- Verify Swift compilation targets match current native-timer structure.
- Check that fallback logic works when Swift compilation fails.

**File**: `Cargo.toml`
- Audit dependency versions for known vulnerabilities.
- Check feature flags.

**File**: `tauri.conf.json`
- Audit CSP policy.
- Check file system scope.
- Verify window configuration.

#### 12.3.3 Sidecar: ritual-watcher

**Files**: All 14 files in `bin/ritual-watcher/src/`
- `main.rs` -- Audit polling loop, state machine, heartbeat merging.
- `window_observer.rs` -- Check macOS API usage, error handling.
- `browser_heartbeat_server.rs` -- Audit HTTP server security (localhost only).
- `browser_tracker.rs` -- Check URL extraction accuracy.
- `afk.rs` -- Verify idle timeout logic.
- `screen_events.rs` -- Check lock/unlock detection.
- `sync_queue.rs` -- Audit queue reliability, retry logic.
- `database.rs` -- Check SQL queries, parameterization.
- `config.rs` -- Verify config persistence.
- `icons.rs` -- Check icon caching.
- `macos.rs` -- Audit macOS-specific APIs.
- `applescript_ffi.rs` -- Check AppleScript injection.
- `browser.rs` -- Verify browser detection.
- `notifications.rs` -- Check notification logic.

#### 12.3.4 Sidecar: ritual-recorder

**Files**: All 12 files in `bin/ritual-recorder/src/`
- `main.rs` -- Audit capture loop, error recovery.
- `capture.rs` -- Check screen capture permissions.
- `ocr.rs` -- Verify OCR accuracy handling.
- `vision_ffi.rs` -- Audit Swift FFI memory management.
- `thumbnail.rs` -- Check image processing.
- `dedup.rs` -- Verify perceptual hash accuracy.
- `database.rs` -- Check FTS5 indexing.
- `video.rs` -- Audit video chunk management.
- `ffmpeg.rs` -- Check auto-download security (verify checksums).
- `storage.rs` -- Audit tiered cleanup logic.
- `config.rs` -- Verify config handling.
- `metrics.rs` -- Check metric collection.

#### 12.3.5 Library: ritual-db

**Files**: All 15 files in `crates/ritual-db/`
- `lib.rs` -- Audit public API.
- `schema.rs` -- Check schema definitions, migrations.
- `activity.rs` -- Audit activity storage, queries.
- `recorder.rs` -- Check OCR frame storage.
- `vector.rs` -- Audit vector operations, embedding pipeline, cosine similarity.
- `segments.rs` -- Check segmentation logic.
- `sync.rs` -- Audit sync operations.
- `blocking.rs` -- Check blocking wrapper correctness.
- `text_processing.rs` -- Audit text processing.
- `activity_classifier.rs` -- Verify classification accuracy.
- `types.rs` -- Check type definitions.
- `error.rs` -- Audit error types.
- `migration.rs` -- Check migration safety.
- `tests/integration_tests.rs` -- Verify test coverage.
- `tests/retrieval_quality_benchmark.rs` -- Check benchmark validity.

#### 12.3.6 Native Timer Widget (Swift)

**Files**: All 14 Swift files in `native-timer/`
- `TimerWidgetApp.swift` -- Audit parent watchdog, initialization.
- `NotchController.swift` (~637 lines) -- Audit state machine, hover detection, hotkey handling.
- `NotchTimerView.swift` (~308 lines) -- Check timer display logic.
- `NotchHabitPicker.swift` -- Audit habit selection.
- `NotchVoiceViews.swift` (~312 lines) -- Check voice UI.
- `TimerSessionStore.swift` (~740 lines) -- Audit state management, API calls, file watching.
- `SpeechEngine.swift` (~164 lines) -- Audit speech recognition lifecycle, audio buffer handling.
- `VoicePermissions.swift` -- Check permission flow.
- `GlobalHotkey.swift` (~138 lines) -- Audit hotkey registration.
- `ModifierEventTap.swift` -- Check event tap handling.
- `AccessibilityPermission.swift` -- Verify permission checking.
- `MicrophonePermission.swift` -- Check legacy FFI binding.
- `SpeechRecognition.swift` -- Check legacy FFI binding.
- `Package.swift` -- Verify dependency versions.

---

### 12.4 iOS Companion Audit (`apps/ios-companion/`)

**Files**: All 15 Swift files

- `RitualCompanionApp.swift` -- Audit app lifecycle, background sync registration.
- `AppState.swift` -- Check state management, token refresh.
- `HealthKitManagerV2.swift` (~890 lines) -- Audit anchor queries, daily aggregation, source preference logic, metric type coverage.
- `RitualAPIClient.swift` (~525 lines) -- Fix hardcoded 55-minute token expiry. Audit HMAC implementation (constant-time comparison). Check Keychain usage. Add request timeouts.
- `BackgroundSyncManagerV2.swift` (~630 lines) -- Audit 7-day window limitation. Check batch failure handling. Verify background task scheduling.
- `OfflineSyncQueue.swift` (~278 lines) -- Audit queue persistence. Check retry logic. Verify cleanup.
- `AnchorStorage.swift` (~128 lines) -- Fix: call `confirmAnchor()` after successful server ingest.
- `NormalizedMetric.swift` -- Verify metric types match server expectations.
- `APIModels.swift` -- Check request/response types.
- `ContentView.swift` -- Audit view logic.
- `ConnectView.swift` -- Audit auth flow.
- `StatusView.swift` -- Check sync status display.
- `PermissionsView.swift` -- Verify permission flow.
- `StatusCard.swift` -- Check component.
- `AppConfig.swift` -- Verify config loading.
- `Project.swift` -- Check Tuist configuration, entitlements.

---

### 12.5 Tinybird Audit (`apps/tinybird/`)

**Datasources** (6 files):
- Verify schema definitions match backend data models.
- Check partition strategies.
- Review TTL policies.
- Verify sort keys optimize common queries.

**Pipes** (14 files):
- Audit all SQL for correctness.
- Check deduplication strategy (`LIMIT 1 BY id` is expensive -- recommend `ReplacingMergeTree` or pre-deduplicated materialized views).
- Verify date range filtering uses partition pruning.
- Check Pearson correlation implementation in `habit_correlation.pipe`.
- Verify health score calculations in `habit_health_scores.pipe`.
- Audit `computer_activity_summary.pipe` for all output modes.
- Check that all pipes filter by `user_id` (multi-tenant security).

**Python Service**:
- `tinybird_client.py` -- Remove debug prints. Add error handling. Add request timeouts.

---

### 12.6 Browser Extension Audit (`apps/browser-extension/`)

**Files**: All 5 files
- `manifest.json` -- Verify permissions are minimal.
- `background.js` (~512 lines) -- Make server URLs configurable (via `chrome.storage`). Add authentication to heartbeats. Fix offline queue size check ordering. Add exponential backoff for server reconnection.
- `background-core.js` (~70 lines) -- Audit helper functions.
- `popup.html` -- Check UI.
- `popup.js` (~80 lines) -- Audit status display.

---

### 12.7 Shared Packages Audit (`packages/`)

**shared-contracts** (`packages/shared-contracts/`):
- `normalized.ts` -- Add missing `MetricType` values (sleep_rem, sleep_deep, sleep_core). Verify types match iOS and backend.
- `apple_ingest.ts` -- Add V2 ingest types (`AppleIngestRequestV2`). Verify HMAC canonical string construction.
- `computer-activity.ts` -- Verify types match watcher output.
- `index.ts` -- Check all exports.

**ui** (`packages/ui/`):
- `cn.ts` -- Verify function. This is fine.
- `index.ts` -- Check exports.

---

### 12.8 Documentation Audit (`docs/`)

Review these docs for accuracy against the current codebase:
- `production_audit.md` (January 2026) -- Check if findings have been addressed.
- `release_checklist.md` -- Verify steps are current.
- `test_plan.md` -- Check test coverage gaps.
- `ARCHITECTURE-ANALYSIS.md` (February 2026) -- Verify accuracy.
- `notch-implementation.md` -- Verify against current Swift code.
- `guides/start-here.md`, `guides/environment-setup.md` -- Verify setup instructions.
- `analysis/optimization-summary.md`, `analysis/analytics-implementation-guide.md` -- Check relevance.

---

### 12.9 CI/CD Audit (`.github/`)

**File**: `.github/workflows/ci.yml`
- Verify CI runs all necessary checks.
- Check that Python backend tests are included (currently only runs TypeScript checks).
- Recommend adding: Python pytest, Rust cargo test, Rust cargo clippy.

---

### 12.10 Configuration Files Audit

**Files to review**:
- `package.json` -- Verify workspace configuration, scripts.
- `apps/dashboard/next.config.mjs` -- Audit Sentry, CORS, bundle analyzer config.
- `apps/dashboard/tailwind.config.js` -- Check custom theme.
- `apps/dashboard/middleware.ts` -- Audit Clerk middleware routes.
- `apps/dashboard/components.json` -- Check shadcn config.
- `apps/desktop/src-tauri/tauri.conf.json` -- Audit CSP, permissions, file scope.
- `apps/desktop/src-tauri/entitlements.plist` -- Verify entitlements are minimal.
- `.env.example`, `apps/backend/.env.example`, `apps/dashboard/.env.example` -- Verify all required env vars are documented.

---

## Summary of Audit Priorities

### Priority 1: Security & Stability (Fix before production)
1. Sanitize all error messages (`detail=str(e)` -> safe messages)
2. Replace `unwrap()` calls in Rust with proper error handling
3. Fix auth token storage (file permissions, remove localStorage fallback)
4. Add timeouts to all external API calls
5. Fix WebSocket `X-User-ID` fallback to require internal API key

### Priority 2: Architecture & Maintainability
1. Extract `main.py` endpoints into FastAPI routers
2. Split `watcher_service.py` into sub-modules
3. Split `chat/stream/route.ts` into smaller modules
4. Replace `print()` with structured `logging` throughout backend

### Priority 3: Reliability
1. Add retry logic to `python-api-client.ts`
2. Fix batch logging transaction rollback
3. Fix iOS token expiry (derive from Clerk claims)
4. Fix iOS anchor confirmation (call after server ingest)
5. Handle Tinybird service `None` state in all endpoints
6. Fix dashboard token refresh polling frequency (500ms -> event-driven)

### Priority 4: Data Integrity
1. Audit Tinybird pipe deduplication strategy
2. Fix iOS 7-day sync window limitation
3. Verify all database migrations are idempotent
4. Add health check that verifies DB + Tinybird connectivity

### Priority 5: Testing & Observability
1. Add structured logging with correlation IDs
2. Expand backend test coverage (currently 7 files, mostly smoke tests)
3. Add Rust test coverage for Tauri commands
4. Add CI steps for Python tests and Rust tests
5. Add error monitoring (Sentry for backend)
