# Scheduler job table

Owner for every recurring server job is FastAPI `apps/backend/background_tasks.py`, started from `apps/backend/lifespan.py` when `ENABLE_INTERNAL_SCHEDULER` is on (default on Railway).

| Job | Loop | Cadence | Enablement | Lease / idempotency | Retry | Alert |
|---|---|---|---|---|---|---|
| Proactive SMS sweep | `internal_scheduler_loop` | 1h | `ENABLE_INTERNAL_SCHEDULER` | per-user send guards in `proactive_sms_service` | log + continue | uvicorn error log |
| Whoop auto-sync | `internal_scheduler_loop` | 1h, user `sync_hour` | scheduler + connection `auto_sync_enabled` | connection-scoped sync | per-user catch | uvicorn error log |
| Oura/Garmin auto-sync | `internal_scheduler_loop` | 1h, user `sync_hour` | scheduler + active connection | connection-scoped sync | per-user catch | uvicorn error log |
| Tesla odometer sync | `internal_scheduler_loop` | 1h, user `sync_hour` | scheduler + active Tesla connection | connection-scoped sync | per-user catch | uvicorn error log |
| Financial sync | `internal_scheduler_loop` | 1h | scheduler | `financial_sync_service.sync_all_active` | log + continue | uvicorn error log |
| Location ping retention | `internal_scheduler_loop` | 1h | scheduler | delete-old-pings | log + continue | uvicorn error log |
| Habit reports | `report_scheduler_loop` | 15m | scheduler | report run rows | log + continue | uvicorn error log |
| Workflow runs | `workflow_scheduler_loop` | 5m | scheduler | `WorkflowRunDB.idempotency_key` | log + continue | uvicorn error log |
| Ambient signals | `ambient_scheduler_loop` | 15m | scheduler | workflow suppression + run ids | log + continue | uvicorn error log |
| SMS copilot | `sms_copilot_loop` | 5m | scheduler | copilot event status | log + continue | uvicorn error log |
| Wearable ingest jobs | `wearable_ingest_job_loop` | 15s | scheduler | `WearableIngestJobDB.idempotency_key` | log + continue | uvicorn error log |
| Wearable maintenance | `wearable_maintenance_loop` | 24h | scheduler | sync run id | log + continue | uvicorn error log |
| Wearable event outbox | `wearable_event_outbox_loop` | 15s | scheduler | outbox event id | log + continue | uvicorn error log |

Trigger.dev is deleted. Do not add a second production scheduler.
