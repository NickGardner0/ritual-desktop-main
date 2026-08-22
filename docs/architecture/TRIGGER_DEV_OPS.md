# Trigger.dev cloud project disable

Ritual no longer ships Trigger.dev code. FastAPI is the only repository scheduler. External project `proj_hctghowrtnzbnyrgoecx` remains an explicit release blocker until directly verified inactive.

Current evidence state (2026-08-22): implementation SHA `23308ee6` is live in Railway deployment `405e4218-a90e-4976-b025-d50f29689fc0`. All 13 jobs are healthy; fresh 10:15 and 10:30 UTC 15-minute cadences completed with no stale jobs, errors, or overlapping leases. The hourly owner has one observed 10:00 UTC occurrence; the required second hourly cadence is still pending. Trigger inspection is blocked on an authenticated Trigger/GitHub browser session. No schedule has been paused or deleted and no credential has been revoked.

Closeout sequence:

1. Confirm the reviewed scheduler deployment SHA/digest and migration predeploy remain current.
2. Run `railway run --service backend-api --environment production npm run ops:scheduler:health` after at least two production cadences and retain its 13-job JSON output.
3. Verify the duplicate-effect query is empty and the health response has no overlapping lease.
4. Open `proj_hctghowrtnzbnyrgoecx` and pause/delete `whoop-sync-hour-0..23`, `oura-sync-hour-0..23`, `garmin-sync-hour-0..23`, `plaid-sync-hour-0..23`, `tesla-sync-hour-0..23`, and `proactive-sms-hourly`—121 schedules total.
5. Retain a screenshot/export of schedule state and run history proving no later invocation.
6. Revoke Trigger credentials only after Railway remains healthy.

Rollback is ordered: disable FastAPI scheduling before re-enabling any Trigger schedules. Never run both owners as redundancy. Repository work does not complete this external operation.
