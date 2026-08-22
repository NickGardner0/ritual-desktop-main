# Trigger.dev cloud project disable

Ritual no longer ships Trigger.dev code. FastAPI is the only repository scheduler. On 2026-08-22 the owner confirmed the former Trigger workspace/project, including project `proj_hctghowrtnzbnyrgoecx`, was deleted and can no longer deliver schedules.

Current evidence state (2026-08-22): implementation SHA `bdc34ecf` is live in Railway deployment `2043bae3-91b0-428b-8f47-151831e29b4f`. All 13 jobs are healthy; all six hourly owners completed distinct 10:00 and 11:00 UTC occurrences, and the schema-v2 integrity response has empty duplicate-identity and overlapping-lease lists. Railway exposes no Trigger credentials, repository Trigger source is deleted, and the owner attests the cloud workspace/project was deleted.

Historical closeout procedure retained for rollback/audit context:

1. Confirm the reviewed scheduler deployment SHA/digest and migration predeploy remain current.
2. Run `railway run --service backend-api --environment production npm run ops:scheduler:health` after at least two production cadences and retain its 13-job JSON output.
3. Verify the schema-v2 health response has an empty `duplicateOccurrenceIdentities` integrity query and no overlapping lease. This proves the occurrence fence has no duplicate identity rows; the shared-entrypoint tests separately prove retained external deliveries enter that same fence.
4. Open `proj_hctghowrtnzbnyrgoecx` and pause/delete `whoop-sync-hour-0..23`, `oura-sync-hour-0..23`, `garmin-sync-hour-0..23`, `plaid-sync-hour-0..23`, `tesla-sync-hour-0..23`, and `proactive-sms-hourly`—121 schedules total.
5. Retain a screenshot/export of schedule state and run history proving no later invocation.
6. Revoke Trigger credentials only after Railway remains healthy.

The owner-confirmed workspace deletion supersedes the individual schedule-deletion steps. If Trigger is ever reintroduced, disable FastAPI scheduling before enabling any Trigger schedule. Never run both owners as redundancy.
