# Scheduler job table

The registry and durable occurrence owner is `apps/backend/services/scheduler_service.py`; domain execution remains in `apps/backend/background_tasks.py`. `apps/backend/lifespan.py` starts the scheduler loops whenever `ENABLE_INTERNAL_SCHEDULER=1`, independently of `ENABLE_STARTUP_MAINTENANCE_TASK`.

Clock jobs use `scheduler_occurrence_claims` with unique `(job_key, scope_key, scheduled_for)` identity and a fenced lease. Queue jobs retain their domain row identity and claim it with an atomic `status = queued` compare-and-set. Authenticated evidence is exposed at `GET /api/internal/scheduler/health`; schema v2 reports duplicate occurrence identities and `npm run ops:scheduler:health` fails unless the schema is current, all 11 owners have succeeded recently, and both the duplicate-identity and overlapping-live-lease lists are empty.

| Job key | Loop | Cadence | Claim owner | Domain owner |
|---|---|---|---|---|
| `whoop_auto_sync` | `hourly_domain` | 1h, filtered by user `sync_hour` | occurrence claim shared by both retained Whoop bulk adapters | `whoop_service` |
| `oura_garmin_auto_sync` | `hourly_domain` | 1h, filtered by user `sync_hour` | provider-scoped occurrence claims shared by the retained bulk adapter | Oura/Garmin services |
| `tesla_odometer_sync` | `hourly_domain` | 1h, filtered by user `sync_hour` | occurrence claim shared by the retained Tesla bulk adapter | `tesla_service` |
| `financial_sync` | `hourly_domain` | 1h | occurrence claim shared by the retained financial bulk adapter | `financial_sync_service.sync_all_active` |
| `location_ping_retention` | `hourly_domain` | 1h | occurrence claim | `location.retention.cleanup_old_pings` |
| `habit_reports` | `habit_reports` | 15m | occurrence claim | report run rows/services |
| `workflow_runs` | `workflow_runs` | 5m | occurrence claim | workflow run idempotency/services |
| `ambient_signals` | `ambient_signals` | 15m | occurrence claim | workflow suppression/run identities |
| `wearable_ingest` | `wearable_ingest` | 15s | atomic `WearableIngestJobDB.status` claim | ingest job id/idempotency key |
| `wearable_maintenance` | `wearable_maintenance` | 24h | occurrence claim | wearable sync run |
| `wearable_event_outbox` | `wearable_event_outbox` | 15s | atomic `WearableOutboxEventDB.status` claim | outbox event id/dedupe key |

Trigger.dev source is deleted. On 2026-08-22 the owner confirmed the former Trigger workspace/project was deleted; Railway has no Trigger credentials. See `TRIGGER_DEV_OPS.md` for the retained rollback rule.

Production evidence cut 2026-08-22: Railway deployment `2043bae3-91b0-428b-8f47-151831e29b4f` / image `sha256:3085f255cd64c97eb78649c7305b597e3773abd1b8c18bd8f1f4f3f5e4074b0d` at implementation SHA `bdc34ecf` started all 13 owners with `ENABLE_INTERNAL_SCHEDULER=1` and startup maintenance disabled. Schema-v2 health reached `healthy` with no missing/stale jobs, errors, active or overlapping leases, or duplicate occurrence identities. The restart sweep classified the previously completed 10:00 UTC occurrences as `duplicate_completed` without re-running domain work; all six hourly owners then completed distinct 11:00 UTC occurrences, alongside the coincident 5/15-minute owners. The owner subsequently confirmed the former Trigger workspace/project was deleted.

The internal-auth compatibility routes `/api/integrations/whoop/sync-all`, `/api/wearables/connections/{provider}/sync-all`, `/api/integrations/tesla/sync-all`, and `/api/financial/sync-all` all enter these same claim functions. A late cloud delivery can therefore observe `duplicate`; it cannot execute a parallel clock mutation.
