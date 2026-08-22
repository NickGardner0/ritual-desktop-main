# Trigger.dev cloud project disable

Ritual no longer ships Trigger.dev code. FastAPI is the only repository scheduler. External project `proj_hctghowrtnzbnyrgoecx` remains an explicit release blocker until directly verified inactive.

After the next production deploy from `codex/release-0.1.1-prep`:

1. Deploy the scheduler migration and code from `codex/release-0.1.1-prep`.
2. Run `railway run --service backend-api --environment production npm run ops:scheduler:health` after at least two production cadences and retain its 13-job JSON output.
3. Verify the duplicate-effect query is empty and the health response has no overlapping lease.
4. Open `proj_hctghowrtnzbnyrgoecx` and pause/delete `whoop-sync-hour-0..23`, `oura-sync-hour-0..23`, `garmin-sync-hour-0..23`, `plaid-sync-hour-0..23`, `tesla-sync-hour-0..23`, and `proactive-sms-hourly`—121 schedules total.
5. Retain a screenshot/export of schedule state and run history proving no later invocation.
6. Revoke Trigger credentials only after Railway remains healthy.

Rollback is ordered: disable FastAPI scheduling before re-enabling any Trigger schedules. Never run both owners as redundancy. Repository work does not complete this external operation.
