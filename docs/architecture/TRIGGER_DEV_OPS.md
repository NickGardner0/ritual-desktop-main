# Trigger.dev cloud project disable

Ritual no longer ships Trigger.dev code. FastAPI is the only repository scheduler. External project `proj_hctghowrtnzbnyrgoecx` remains an explicit release blocker until directly verified inactive.

Current evidence state (2026-08-22): implementation SHA `bdc34ecf` is live in Railway deployment `2043bae3-91b0-428b-8f47-151831e29b4f`. All 13 jobs are healthy; all six hourly owners completed distinct 10:00 and 11:00 UTC occurrences, and the schema-v2 integrity response has empty duplicate-identity and overlapping-lease lists. Trigger inspection is blocked on an authenticated Trigger/GitHub browser session. No schedule has been paused or deleted and no credential has been revoked.

Closeout sequence:

1. Confirm the reviewed scheduler deployment SHA/digest and migration predeploy remain current.
2. Run `railway run --service backend-api --environment production npm run ops:scheduler:health` after at least two production cadences and retain its 13-job JSON output.
3. Verify the schema-v2 health response has an empty `duplicateOccurrenceIdentities` integrity query and no overlapping lease. This proves the occurrence fence has no duplicate identity rows; the shared-entrypoint tests separately prove retained external deliveries enter that same fence.
4. Open `proj_hctghowrtnzbnyrgoecx` and pause/delete `whoop-sync-hour-0..23`, `oura-sync-hour-0..23`, `garmin-sync-hour-0..23`, `plaid-sync-hour-0..23`, `tesla-sync-hour-0..23`, and `proactive-sms-hourly`—121 schedules total.
5. Retain a screenshot/export of schedule state and run history proving no later invocation.
6. Revoke Trigger credentials only after Railway remains healthy.

Rollback is ordered: disable FastAPI scheduling before re-enabling any Trigger schedules. Never run both owners as redundancy. Repository work does not complete this external operation.
