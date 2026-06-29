# Current Architecture Audit

Date: 2026-06-23

Branch: `privacy/local-first-e2ee-vault`

## Scope

This is Pass 1 analysis only. No application source, schema, config, package, migration, or test files were changed.

I reviewed the monorepo shape, app entrypoints, storage models, network clients, sync workers, telemetry providers, AI routes, Tinybird resources, desktop and iOS local stores, browser-extension capture paths, and existing operational docs. The repo has 1,373 tracked files visible to `rg --files` outside ignored dependency/build directories, and 420 app files in the main app languages within `apps/` at shallow depth. I focused full reads on the high-sensitivity paths rather than generated files and build artifacts.

The worktree already had unrelated dirty changes before this audit:

- `.gitignore`
- `apps/desktop/src-tauri/binaries/ritual-watcher-aarch64-apple-darwin`
- `apps/desktop/src-tauri/src/desktop_runtime/biome_outbox.rs`
- `apps/ios-companion/Project.swift`
- untracked `apps/ios-companion/Derived/`
- untracked `outputs/`

These were not modified.

## Executive Finding

Ritual is currently cloud-first for most user data and mixed local/cloud for desktop activity. The app already has some local-first pieces, but they are not the source of truth for habits, logs, analytics, AI memory, reports, or wearable imports.

The highest-risk privacy issue is not a single database. It is fan-out:

- primary records are stored in backend Turso/libSQL tables;
- secondary copies are sent to Tinybird, Typesense, Sentry, OpenPanel, Trigger.dev jobs, reports/artifacts, AI conversations, and provider-specific raw payload tables;
- desktop local activity can be uploaded through a plaintext cloud sync outbox;
- AI and voice/screenshot flows send sensitive content to external model/transcription providers.

A simple switch from remote Turso to local Turso would break important product behavior and would still leave secondary copies unless the fan-out paths are controlled first.

## System Map

### Main Surfaces

- `apps/dashboard`: Next 16/React app. Uses Clerk auth, OpenPanel, Sentry, AI SDK/OpenAI, Deepgram, Trigger.dev, Tinybird route calls, backend proxy routes, and Tauri commands.
- `apps/backend`: FastAPI backend. Uses SQLAlchemy over Turso/libSQL, Tinybird, Typesense, OpenAI, Gemini, provider APIs, Sendblue, Sentry, and background workers.
- `apps/desktop`: Tauri v2 shell plus Rust `ritual-db` and `ritual-watcher`. Stores rich local activity/context data and has cloud sync paths.
- `apps/ios-companion`: Swift/Tuist app. Reads HealthKit, Screen Time, location, BLE Whoop, exports local markdown/JSON/CSV, and uploads selected data to backend.
- `apps/browser-extension`: MV3 extension. Captures browser tab and page context and posts to local watcher heartbeat endpoints.
- `apps/tinybird`: Tinybird datasources/pipes for habit, computer activity, heart-rate, weather, and wearable analytics.
- `packages/chat-runtime`: OpenAI-backed chat/tool orchestration shared by dashboard/chat API/SMS paths.

## Current Storage Inventory

| Data class | Current primary storage | Secondary copies/fan-out | Sensitivity | Notes |
|---|---|---|---|---|
| Account profile | `users`, Clerk, backend auth context | Sentry user context, OpenPanel identify | High | `users` stores email, phone, timezone, onboarding demographics, tracking interests, Turso DB metadata. |
| Habit definitions | `habits` in backend Turso/libSQL | Tinybird `habit_logs` references, Typesense `habits`, OpenPanel events | High | Habit names/categories may reveal health, medication, religion, addiction, finances, etc. |
| Habit logs | `habit_logs` in backend Turso/libSQL | Tinybird `habit_logs`, Typesense `habit_logs`, metric facts, reports/artifacts, AI tools | Very high | Logs include notes, amounts, durations, dates, source metadata, location fields, import provenance. |
| Scheduled blocks and aliases | `scheduled_blocks`, `habit_aliases`, projection policies | AI/context/report use | High | Behavioral schedule and natural-language aliases are user-specific. |
| Imports and staged import rows | `import_runs`, `import_items`, mapping presets | possible screenshot extraction, undo packages, logs | Very high | Stores file metadata, raw rows, validation messages, mapping config, undo package. |
| Wearable OAuth connections | `whoop_integrations`, `wearable_connections`, `financial_connections` | provider APIs, sync jobs, Sentry errors | Critical | Tokens may be encrypted only when `TOKEN_ENCRYPTION_KEY` is configured. Legacy/plaintext rows are supported. |
| Wearable raw payloads | `wearable_raw_payloads`, `wearable_metrics`, `wearable_samples`, `wearable_events` | Tinybird, projected habit logs, metric facts, raw replay jobs | Critical | Includes HealthKit/provider payload JSON, events, samples, sleep/workout/body metrics. |
| Apple Health device registration | `wearable_devices`, iOS Keychain device secret | backend ingest events | High | Comment says device secret hash is "stored plaintext for now, can encrypt later". |
| Screen Time | `screen_time_rollups` backend; iOS App Group JSON | dashboard analytics, AI context | Very high | App and website daily usage uploaded from iPhone. |
| Live biometrics | backend heart-rate sessions/samples/rollups/state; iOS local SQLite | Tinybird heart-rate rollups, projected logs | Critical | iOS live biometrics upload is currently partly disabled, but backend schema and sync paths exist. |
| Location | `user_location_pings`, `user_location_state`; desktop/iOS JSON outboxes | habit/activity log enrichment, reverse geocode labels | Critical | Raw lat/lon, BSSID/SSID, raw payload JSON. |
| Desktop app/window activity | desktop `~/.ritual/ritual.db`; backend watcher tables | Tinybird `computer_activity_daily`, Typesense `computer_activity`, project-time summaries | Critical | Includes app names, window titles, browser URLs/domains, incognito flags, local context snapshots. |
| Screen recording/OCR/context memory | desktop local `ritual-db` tables | some cloud triggers disabled; local summaries still feed project-time | Critical | `ocr_frames` and context snapshots can contain visible text and selected/focused text. |
| Desktop cloud sync outbox | desktop `cloud_sync_outbox` | remote per-user Turso via `cloud_sync.rs` | Critical | Outbox payloads are plaintext JSON for activity/project-time rows. |
| Browser extension capture | local extension storage and local heartbeat endpoint | watcher local DB, then possible desktop cloud sync/analytics | Critical | Captures URLs, domains, titles, selected text, visible text, headings, semantic blocks. |
| AI conversations | `ai_conversations`, `ai_messages`, queue items | Typesense `ai_messages`, OpenAI prompts, SMS flows, artifacts | Very high | User messages and tool payloads are stored plaintext in backend DB. |
| AI facts/memory | `ai_facts`, `ai_fact_events` | Typesense `ai_facts`, prompts | Very high | Stores semantic memories: goals, preferences, constraints, routines, profile. |
| Artifacts/reports | `artifacts`, revisions, report runs/notifications | email/send provider, Typesense | Very high | Generated summaries, body JSON, report HTML, recipients, delivery payloads. |
| Workflows/actions | workflow definitions/runs, approvals, receipts, ambient signals | Trigger.dev, OpenAI, artifacts, Sentry | Very high | Stores plans, proposed actions, policy decisions, fact suggestions, ambient signal payloads. |
| SMS/copilot | SMS preferences, copilot events, Sendblue webhooks | Sendblue, OpenAI SMS runtime, conversations | Very high | Stores outgoing/incoming assistant content, delivery IDs, metrics JSON. |
| Search index | Typesense collections | Typesense cloud/service | Very high | Indexes habit names, notes, AI content, artifacts, workflow config, facts, activity fields. |
| Product analytics | OpenPanel | OpenPanel cloud | Medium to high | Current event props include habit names, IDs, integration names, command-palette selections, user profile email/name/avatar. |
| Reliability telemetry | Sentry client/server/native | Sentry cloud | Medium to high | User IDs/emails, route/query context, device IDs, tags, breadcrumbs, replay with text masked and media blocked. |
| Tinybird analytics | Tinybird datasources and pipes | Tinybird cloud | High to critical | Habit logs, Whoop, computer activity daily, heart-rate rollups, weather observations. |

## Primary Storage Paths

### Backend Turso/libSQL

`apps/backend/database/connection.py` is the backend database boundary. It requires `DATABASE_URL` and defaults to a Turso Cloud embedded-replica setup. A `RITUAL_DB_LOCAL_ONLY` env path exists, but it is an environment deployment mode, not an end-user privacy mode. Local replica encryption is optional through `TURSO_LOCAL_ENCRYPTION_KEY`.

Key backend models include:

- `database/models/user.py`: user account profile, activation state, UI prefs, location pings/state.
- `database/models/habits.py`: habits, logs, scheduled blocks, aliases, projection policies.
- `database/models/imports.py`: import runs, staged import items, mapping presets.
- `database/models/wearables.py`: provider connections, tokens, raw payloads, samples/events, ingest jobs/outbox, screen time, biometrics.
- `database/models/watcher.py`: desktop watcher devices/state, activity events, daily/domain rollups, sync outbox, exclusions.
- `database/models/conversations.py`: AI conversations/messages/queue.
- `database/models/facts.py`: AI semantic memory facts and events.
- `database/models/artifacts.py`: generated artifact bodies/revisions/links.
- `database/models/reports.py`: schedules, generated reports, notifications.
- `database/models/workflows.py`: workflow definitions/runs, approvals, action receipts, ambient signals.
- `database/models/financial.py`: Plaid connections/accounts/transactions/cursors/runs.
- `database/models/sms.py`: SMS preferences, copilot events, behavioral baselines.

### Desktop Local Database

`apps/desktop/src-tauri/crates/ritual-db` opens a local libSQL database by default at `~/.ritual/ritual.db`. It stores:

- `activity_events`, AFK events, app/window/browser metadata.
- screen recording and OCR metadata, including OCR text.
- context sessions/snapshots, visible text, selected text, UI elements, raw text normalization.
- project-time sessions, daily rollups, classification rules, evidence.
- `cloud_sync_outbox`, currently plaintext JSON.

The crate depends on `libsql = { version = "0.9", features = ["sync"] }` and does not currently configure local database encryption. `apps/desktop/src-tauri/src/cloud_sync.rs` uploads selected outbox rows to remote per-user Turso using config fetched from the backend.

### iOS Local Storage

The iOS app uses:

- Keychain for auth/device tokens in `RitualAPIClient.swift`.
- plaintext JSON offline queue at `offline_sync_queue.json`.
- plaintext SQLite biometrics store under Application Support.
- Screen Time App Group files such as `screen-time-snapshot.json`.
- `location_outbox.json` for pending location pings.
- local export destination bookmarks in UserDefaults.

The local export system already writes HealthKit-oriented markdown/JSON/CSV, but it is not a full Ritual Vault for habits, AI, desktop activity, or all sensitive data.

### Browser Extension Storage

The extension captures web activity locally and posts heartbeats to localhost watcher endpoints. Captured fields include URL, domain, title, document title, visible text, selected text, focused element text, headings, semantic blocks, audible/incognito/browser focus/idle state, and tab counts. This is extremely sensitive even if the first hop is local because watcher/cloud sync can later move derived records.

## Sync Paths

### Backend Turso Remote Sync

The backend uses Turso Cloud as the current operational source for most user data. `services/turso_user_service.py` provisions per-user Turso DBs, creates/deletes DBs via Turso Platform API, mints database tokens, creates local replica directories, migrates activity data, and provides desktop sync config.

`services/turso_activity_remote.py` performs direct remote activity reads/writes using `libsql_client.create_client`.

### Desktop Cloud Sync

`apps/desktop/src-tauri/src/desktop_runtime/turso_sync.rs` fetches `/api/user/turso-sync-config` with a bearer token, then applies sync config.

`apps/desktop/src-tauri/src/cloud_sync.rs` runs a worker, reads `cloud_sync_outbox`, opens remote Turso via `Builder::new_remote(sync_url, auth_token)`, and uploads rows. Current payloads are plaintext domain rows, not encrypted envelopes. It handles `activity_event`, `afk_event`, `project_time_session`, `project_time_daily_rollup`, and classification rules.

Local DB triggers in `schema/sync.rs` enqueue plaintext JSON. Raw memory triggers appear intentionally disabled/dead-lettered, but activity and project-time summaries still carry sensitive app/window/domain/project/task data.

### iOS Upload Sync

`RitualAPIClient.swift` uploads:

- Apple Health device registration and metrics.
- Apple sync telemetry.
- Screen Time device registration and rollups.
- location pings.
- habit logs.
- some heart-rate session/sample endpoints, though live biometrics sync is currently no-op in `BiometricsSyncService.swift`.

Offline queues are plaintext JSON unless protected by iOS file protection.

### Provider/Background Sync

Backend scheduled/manual syncs run through:

- Trigger.dev schedules in `apps/dashboard/src/trigger/*` for Whoop, Oura, Garmin, Plaid, Tesla, and proactive SMS.
- FastAPI background worker `wearable_ingest_job_loop`.
- provider services that call Whoop, Oura, Garmin, Plaid, Tesla APIs over `httpx`.

These paths assume cloud-hosted backend storage and cannot operate in strict Local Only mode without a local provider agent or user-mediated imports.

## Analytics, Telemetry, and Indexing Paths

### Tinybird

Tinybird receives sensitive analytics data from multiple services:

- habit logs via `TinybirdService.ingest_habit_log(s)` and batch syncs.
- Whoop recovery/sleep/workout via `whoop_tinybird_sink.py`.
- desktop computer activity daily rollups via `services/computer_activity/sync.py`.
- heart-rate rollups and projected logs via `biometrics_service.py`.
- wearable projection payloads via `wearables_unified/projection.py`.

Dashboard routes also call Tinybird pipes directly for habit correlations, logs, daily values, trends, and heart-rate summaries/series. Tinybird therefore contains independent copies that must be deleted or avoided, not just ignored.

### Typesense

`services/search_service.py` indexes:

- habits and aliases;
- habit logs and notes;
- AI messages;
- artifacts;
- workflows;
- AI facts;
- computer activity.

This is a secondary plaintext search copy of sensitive content.

### OpenPanel

`apps/dashboard/lib/analytics.ts` and `components/openpanel-provider.tsx` identify users with Clerk profile data and track user behavior. Event props include habit IDs/names, categories, values/units, log IDs, integration names, AI message length, settings changes, and command-palette selections. `trackAttributes` and outgoing-link tracking are enabled.

### Sentry

Sentry is initialized in:

- dashboard client/server/edge configs;
- backend FastAPI;
- desktop Tauri native shell;
- desktop watcher native process.

Client replay masks text and blocks media, but routing, user ID/email, device IDs, tags, breadcrumbs, error messages, and selected query params can still leak sensitive context. Backend helper filtering removes common tokens but allows context tags such as provider, sync run, habit ID, connection ID, device ID, and run ID.

### Trigger.dev

Trigger.dev runs scheduled provider syncs and proactive SMS sweeps. It can contain job payload metadata and logs about sync results, total users, errors, and backend responses.

## AI and Cloud Processing Paths

AI/cloud paths are not isolated to chat:

- `packages/chat-runtime` sends conversation history, tool schemas, tool results, activity summaries, biometrics, screen time, calendar, facts, and other context to OpenAI.
- `packages/chat-runtime/src/persistence.ts` stores chat messages and facts in backend.
- `apps/dashboard/app/api/chat/habits/route.ts` uses AI SDK/OpenAI to parse free-form habit logs and then writes logs/search phrases.
- `apps/backend/services/screenshot_analyzer.py` sends screenshot bytes/base64 and habit context to Gemini or OpenAI and logs raw model responses.
- `apps/backend/api/screenshot.py` handles screenshot preview/confirm flows.
- `apps/dashboard/app/api/import/extract-from-image/route.ts` sends image data to OpenAI Vision.
- `apps/dashboard/app/api/whisper/route.ts` sends audio to Groq Whisper or OpenAI Whisper.
- `apps/dashboard/lib/voice/use-deepgram-dictation.ts` streams audio to Deepgram via WebSocket after fetching a token.
- `apps/dashboard/app/api/calendar/summary/route.ts` uses OpenAI to summarize activity/calendar-like context.
- `apps/dashboard/lib/workflows/executor.ts` uses OpenAI to synthesize workflow artifacts.
- SMS/proactive flows in `packages/chat-runtime/src/sms.ts` use OpenAI with tool loops.

Current consent is feature-level at best. There is no central privacy policy engine that prevents AI calls from receiving newly local-only sensitive categories.

## External Network Paths

Confirmed external providers and hosts include:

- Clerk for authentication.
- Turso Platform API and Turso Cloud/libSQL remotes.
- Tinybird API/pipes.
- Typesense search service.
- OpenAI.
- Google Gemini.
- Groq Whisper.
- Deepgram.
- Whoop, Oura, Garmin.
- Plaid.
- Tesla.
- Sendblue.
- Sentry.
- OpenPanel.
- hosting/runtime providers such as Vercel/Railway through deployed routes.
- local desktop `127.0.0.1`/localhost bridge and watcher endpoints.

`apps/desktop/src-tauri/tauri.conf.json` CSP allows the hosted dashboard/backend, Tinybird, Clerk, Google/Apple auth, Deepgram, localhost, and WebSocket connections.

## Feature Impact of Local-First, E2EE Sync, and File-over-App Export

### Features that continue with mostly local changes

- Desktop activity capture can continue locally, but cloud sync must default off and outbox payloads need encryption or removal.
- Local dashboard views can read from Tauri/local DB for recent desktop activity and eventually habits/logs.
- iOS HealthKit local export already has a useful foundation for File-over-App style export.
- Manual import/export can work locally if import staging is moved to a vault-local store.

### Features that break or degrade in strict Local Only mode

- Web-only access from a browser without the desktop/iOS local vault.
- Cross-device history across Mac/iPhone/web.
- Cloud provider OAuth syncs for Whoop/Oura/Garmin/Plaid/Tesla.
- Trigger.dev scheduled syncs and proactive SMS.
- Remote reports/emails and server-generated artifacts.
- Typesense global search unless replaced with local search.
- Tinybird-backed analytics and heart-rate charts.
- OpenAI/Gemini/Groq/Deepgram features unless explicitly allowed per action.
- SMS assistant/copilot flows.
- Shared cloud AI facts and conversation history.

### Features that need an E2EE sync redesign

- Multi-device habits/logs.
- iOS-to-desktop HealthKit and Screen Time sync.
- desktop activity/project-time sync.
- AI memory/conversation sync.
- artifacts/reports sync.
- search across encrypted data.
- conflict handling for local edits.

The current Turso sync path replicates SQL rows. That is useful as transport, but it is not zero-knowledge unless the rows being synced are already ciphertext envelopes.

### Features that need File-over-App export design

- Habit definitions and logs.
- daily notes/reflections/generated artifacts.
- provider import manifests and non-secret connection metadata.
- AI conversations and facts, if user opts in.
- desktop activity summaries, with raw titles/URLs/OCR excluded by default.
- attachments/screenshots/OCR/raw payloads only under explicit sensitive-export options.

## Current Guardrails That Help

- Backend token encryption helper exists for integration tokens when `TOKEN_ENCRYPTION_KEY` is configured.
- Backend local replica encryption can be enabled with `TURSO_LOCAL_ENCRYPTION_KEY`.
- Desktop watcher disables some raw memory cloud-sync triggers and contains redaction/sensitive-window logic.
- Sentry replay masks text and blocks media.
- iOS stores auth/device secrets in Keychain.
- iOS local export code already produces Markdown/JSON/CSV for HealthKit.
- Screen Time backend model claims aggregate rollups only, not raw URLs, though website domains still count as sensitive.

## Gaps

- No end-user privacy mode controls storage/sync/AI/analytics globally.
- No central data-classification policy enforced across backend, dashboard, desktop, iOS, and extension.
- No E2EE envelope sync for sensitive records.
- No migration wizard from cloud data to local vault.
- No comprehensive cloud behavioral deletion flow across Turso, Tinybird, Typesense, Sentry/OpenPanel where possible, Trigger logs, and generated secondary records.
- Desktop `cloud_sync_outbox` is plaintext.
- iOS offline queues/local biometrics/location files are plaintext.
- Tinybird and Typesense contain secondary sensitive copies.
- OpenPanel event properties include user profile and habit names.
- AI paths can receive private context without a single explicit-consent gate.
- Raw provider payload/debug tables preserve high-risk JSON.
- Current local stores are fragmented: desktop `ritual-db`, iOS local stores, backend Turso, browser extension storage.

## Proceed Recommendation

No-proceed on a single all-at-once Pass 2 that tries to flip Ritual directly to full local-first plus E2EE sync plus vault export. It would break important current features and leave secondary copies unless the fan-out paths are handled first.

Proceed only with the staged implementation described in `02-local-first-e2ee-vault-implementation-plan.md`:

1. add privacy mode settings and enforce guardrails first;
2. stop sensitive fan-out by default;
3. build a local encrypted sensitive vault source of truth;
4. migrate/import current cloud behavioral data to the vault;
5. add comprehensive cloud deletion controls;
6. add File-over-App Ritual Vault export/import;
7. add optional E2EE envelope sync;
8. re-enable cloud intelligence and analytics only through explicit user consent.
