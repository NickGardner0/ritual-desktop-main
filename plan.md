# Ritual Wearables Architecture Cleanup Plan

## Summary

Ritual should keep FastAPI, Turso, the existing wearable tables, and `wearables_unified`, but make `wearables_unified` the only canonical write/projection path.

The review found that Ritual already has good pieces, but they are layered on top of older provider services instead of replacing them. The main hotspots are:

- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/wearable_provider_pipeline.py` defines the right contracts, but `/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/wearable_provider_service_pipeline.py` wraps legacy services with an `AlreadyPersistedProviderSink`, so the pipeline is not yet the real persistence boundary.
- `/Users/nickgardner/Desktop/ritual-desktop-main/apps/backend/services/whoop_service.py`, `oura_service.py`, and `garmin_service.py` still mix auth, fetch, transform, persistence, projection, checkpoint/status, and fact rebuild behavior.
- `whoop_service.py` rebuilds metric facts itself, while other providers rely more on `wearables_unified`; this inconsistency can cause “sync succeeded, but Sleep Duration did not increase” bugs.
- Projection currently happens inline during sample/event persistence in `sync_persistence.py`; this is slower and makes failures harder to retry cleanly.
- Dashboard Trigger jobs, backend ingest jobs, manual endpoints, and raw replay jobs all exist as orchestration surfaces. They need one backend-owned sync/job registry.

External comparison:

- **Midday** has cleaner provider/package boundaries, shared job clients, scheduler registries, and dedupe-first job IDs. Ritual should adopt these principles, not Midday’s tRPC stack.
- **Workbench** is not a wearable app, but its queue/run observability model is useful: visible run states, retry actions, terminal failures, readonly/destructive action separation, and lightweight status endpoints.
- **Open Wearables** is heavier than Ritual needs, but its provider strategy/capabilities, raw payload replay, explicit sync runs, and checkpoint discipline are the right patterns to steal.

## Key Changes

### Provider Strategy Boundary

- Introduce one canonical `WearableProviderStrategy` interface with explicit capabilities: auth type, pull/webhook support, backfill support, supported metrics, checkpoint type, retry policy, and raw replay support.
- Move Whoop, Oura, and Garmin into provider modules that only handle:
  - OAuth/token refresh and provider auth errors
  - API fetching or webhook verification
  - pagination/date-window selection
  - transformation into canonical wearable samples/events/raw payloads
- Provider modules must not write habit logs, rebuild metric facts, update dashboard read models, write Tinybird as source of truth, or advance checkpoints directly.
- Remove the service-backed fake pipeline once each provider has a real strategy implementation.

### Canonical Ingest And Post-Ingest

- Make `wearables_unified` the only persistence path for wearable raw payloads, samples, events, sources, sync runs, and cursors.
- Add one shared post-ingest service that runs after any provider batch is accepted:
  - project affected samples/events into habit logs
  - rebuild metric facts for affected dates
  - refresh read-model metadata
  - emit durable wearable outbox events
  - update connection sync state
- Run projection/fact rebuild once per batch/date range, not once per sample/event.
- Advance provider checkpoints and `last_sync_at` only after canonical ingest and post-ingest both succeed.
- Treat Tinybird as analytics-only. It must not be required for habit totals or read-model correctness.

### Sync Runs, Jobs, And Retries

- Make the backend sync/job registry the only owner of wearable sync orchestration.
- Dashboard Trigger jobs should become thin callers of one backend enqueue endpoint during migration, then be removed once backend scheduling is stable.
- Every sync run should record provider, user, trigger, date window, checkpoint before/after, fetched count, accepted count, duplicate count, rejected count, projected count, fact rebuild result, attempts, status, and error.
- Supported run statuses: `queued`, `running`, `succeeded`, `partial`, `retryable_failed`, `terminal_failed`.
- Use idempotency keys per `user/provider/window/trigger` so repeated manual syncs or scheduled syncs do not duplicate work.

### Raw Payload Capture And Replay

- Capture raw provider payloads for every OAuth pull and webhook with provider, direction, user, external id, date window, digest, schema version, and received time.
- Add replay jobs that re-run transform -> canonical ingest -> post-ingest from stored raw payloads.
- Quarantine malformed or unsupported payloads with reason metadata.
- Provide an admin/dev replay path for debugging failed sleep/workout/steps syncs without refetching from providers.

### Projection And Source Priority

- Move source-priority rules into explicit configuration, not hot-path policy mutation.
- Keep sleep-provider priority visible and testable. Sleep Duration should accept sleep from Whoop, Apple Health, Oura, Garmin, and Fitbit but metric facts must choose one winning provider per day.
- Preserve manual logs unless a provider projection is explicitly higher priority for the same canonical metric/date.
- Overview, Metrics, Logs, and Calendar should read wearable-derived totals only from metric facts/read models.

### API And UI

- Split the oversized wearable API surface into thin endpoint groups: connections, sync runs/jobs, raw payloads, provider status, and provider callbacks/webhooks.
- Integration cards should read one provider status object with last success, last failure, latest upstream record date, latest projected fact date, queued jobs, and latest sync run.
- `Sync Now` should enqueue a canonical sync run, poll status, and invalidate Overview/Metrics/Logs/Calendar only after post-ingest succeeds.
- Provider details should show whether data was fetched, stored, projected, and reflected in metric facts. This directly addresses “Whoop synced but Sleep Duration did not move.”

## Implementation Order

1. **Stabilize Whoop Sleep First**
   - Add a Whoop regression test proving a new sleep payload increases Sleep Duration in habit logs, metric facts, Overview, and Metrics.
   - Change Whoop checkpoint/`last_sync_at` updates so they only advance after canonical ingest plus post-ingest success.
   - Move Whoop metric-fact rebuild out of `whoop_service.py` into the shared post-ingest service.

2. **Make Provider Strategies Real**
   - Implement real Whoop, Oura, and Garmin strategy classes.
   - Replace `ServiceBackedProviderClient` and `AlreadyPersistedProviderSink` with provider fetch/transform output written by the canonical ingest service.
   - Keep old service methods as compatibility wrappers temporarily, but they should call the new strategy pipeline.

3. **Centralize Post-Ingest**
   - Move projection, habit-log writes, metric-fact rebuild, read-model refresh metadata, and outbox emit into one shared post-ingest service.
   - Remove inline per-row projection from the hot persistence path after parity tests pass.

4. **Consolidate Orchestration**
   - Make backend sync jobs the canonical scheduler/queue path.
   - Convert dashboard Trigger jobs to call backend enqueue endpoints, then delete duplicate scheduler code after production parity.
   - Add run-status endpoints and Integrations UI status display.

5. **Raw Replay And Cleanup**
   - Add replay tooling for raw payloads.
   - Add provider fixture payloads and replay tests.
   - Delete service-backed pipeline adapters and obsolete legacy write paths after stable production runs.

## Test Plan

- **Whoop sleep regression:** syncing a new Whoop sleep record increases Sleep Duration all-time and daily totals, and the result appears in Overview/Metrics without manual rebuild.
- **Checkpoint safety:** API fetch success followed by canonical ingest or post-ingest failure does not advance checkpoint, `last_sync_at`, or “last successful sync.”
- **Idempotency:** replaying the same Whoop/Oura/Garmin payload twice does not duplicate sleep, steps, workouts, recovery, or metric facts.
- **Provider contracts:** fixture payloads for Whoop, Oura, and Garmin transform into canonical samples/events with correct dates, units, external ids, and source metadata.
- **Post-ingest:** raw payload -> canonical sample/event -> habit log -> metric fact -> read model works through one shared path for all providers.
- **Retries:** retryable provider failures keep jobs queued/retryable; auth revocation/rate-limit terminal cases are marked correctly.
- **Raw replay:** stored raw payload replay can rebuild missing projections/facts without refetching from the provider.
- **UI status:** Integrations shows fetched/stored/projected/fact status and does not report success based only on provider API fetch.
- **Performance:** batch ingest should rebuild facts once per affected date range and avoid per-sample DB sessions where possible.

## Assumptions

- Do not migrate Ritual to Midday’s tRPC architecture or Open Wearables’ Celery/Postgres shape.
- `wearables_unified` remains the canonical storage foundation.
- Tinybird remains optional analytics infrastructure, not the source of truth for wearable habit totals.
- Existing provider data should be preserved; cleanup must be migration-compatible.
- Dashboard Trigger jobs can remain temporarily during migration, but backend-owned scheduling is the final state.
- The root plan document target is `/Users/nickgardner/Desktop/ritual-desktop-main/plan.md`.
