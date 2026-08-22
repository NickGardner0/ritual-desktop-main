# Scheduler job table

The registry and durable occurrence owner is `apps/backend/services/scheduler_service.py`; domain execution remains in `apps/backend/background_tasks.py`. `apps/backend/lifespan.py` starts all eight loops whenever `ENABLE_INTERNAL_SCHEDULER=1`, independently of `ENABLE_STARTUP_MAINTENANCE_TASK`.

Clock jobs use `scheduler_occurrence_claims` with unique `(job_key, scope_key, scheduled_for)` identity and a fenced lease. Queue jobs retain their domain row identity and claim it with an atomic `status = queued` compare-and-set. Authenticated evidence is exposed at `GET /api/internal/scheduler/health`; `npm run ops:scheduler:health` fails until all 13 owners have succeeded recently and no overlapping live lease exists.

| Job key | Loop | Cadence | Claim owner | Domain owner |
|---|---|---|---|---|
| `proactive_sms` | `hourly_domain` | 1h | occurrence claim; retained proactive adapter uses the same claim | `proactive_sms_service` + per-user send guards |
| `whoop_auto_sync` | `hourly_domain` | 1h, filtered by user `sync_hour` | occurrence claim shared by both retained Whoop bulk adapters | `whoop_service` |
| `oura_garmin_auto_sync` | `hourly_domain` | 1h, filtered by user `sync_hour` | provider-scoped occurrence claims shared by the retained bulk adapter | Oura/Garmin services |
| `tesla_odometer_sync` | `hourly_domain` | 1h, filtered by user `sync_hour` | occurrence claim shared by the retained Tesla bulk adapter | `tesla_service` |
| `financial_sync` | `hourly_domain` | 1h | occurrence claim shared by the retained financial bulk adapter | `financial_sync_service.sync_all_active` |
| `location_ping_retention` | `hourly_domain` | 1h | occurrence claim | `location.retention.cleanup_old_pings` |
| `habit_reports` | `habit_reports` | 15m | occurrence claim | report run rows/services |
| `workflow_runs` | `workflow_runs` | 5m | occurrence claim | workflow run idempotency/services |
| `ambient_signals` | `ambient_signals` | 15m | occurrence claim | workflow suppression/run identities |
| `sms_copilot` | `sms_copilot` | 5m | occurrence claim | copilot event state |
| `wearable_ingest` | `wearable_ingest` | 15s | atomic `WearableIngestJobDB.status` claim | ingest job id/idempotency key |
| `wearable_maintenance` | `wearable_maintenance` | 24h | occurrence claim | wearable sync run |
| `wearable_event_outbox` | `wearable_event_outbox` | 15s | atomic `WearableOutboxEventDB.status` claim | outbox event id/dedupe key |

Trigger.dev source is deleted. The external project `proj_hctghowrtnzbnyrgoecx` is not yet directly proven inactive; do not call scheduling externally complete until the steps in `TRIGGER_DEV_OPS.md` have artifacts.

Production evidence cut 2026-08-22: Railway deployment `405e4218-a90e-4976-b025-d50f29689fc0` at implementation SHA `23308ee6` started all 13 owners with `ENABLE_INTERNAL_SCHEDULER=1` and startup maintenance disabled. Health reached `healthy` with no missing/stale jobs, errors, active leases, or overlapping leases. The restart sweep classified existing completed occurrences as `duplicate_completed` without re-running domain work; fresh 10:15 and 10:30 UTC 15-minute cadences completed successfully. Trigger remains active/unverified until its cloud state is inspected and changed directly.

The internal-auth compatibility routes `/api/integrations/whoop/sync-all`, `/api/wearables/connections/{provider}/sync-all`, `/api/integrations/tesla/sync-all`, `/api/financial/sync-all`, and `/api/sms/proactive/trigger` all enter these same claim functions. A late cloud delivery can therefore observe `duplicate`; it cannot execute a parallel clock mutation.
